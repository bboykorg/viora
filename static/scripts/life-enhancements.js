/**
 * life-enhancements.js — слой расширений поверх life.js.
 *
 * Не трогает базовую логику; навешивает:
 *  • Undo / Redo (Ctrl+Z, Ctrl+Shift+Z)
 *  • Экспорт в JSON и Markdown
 *  • Импорт из JSON
 *  • Тосты + замена window.confirm
 *  • Горячие клавиши (Delete, Esc, ?, Ctrl+S, Ctrl+E…)
 *  • Streaming-вариант анализа исходов (SSE) с прогрессом
 *  • Тёмная/светлая тема
 *
 * Используется глобальный объект Viora из common.js.
 */
(() => {
  'use strict';
  if (!window.Viora) { console.error('Viora common.js не загружен'); return; }
  const { Toast, Confirm, Theme, Exporter, Shortcuts, Help, debounce } = window.Viora;
  Theme.init();

  const STORAGE_KEY = 'viora_state';
  const $ = (sel) => document.querySelector(sel);

  // ── Helpers поверх глобалов life.js ─────────────────────────────────
  function snapshotState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch { return null; }
  }
  function restoreState(state) {
    if (!state) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    location.reload(); // самый надёжный способ применить состояние
  }

  // ── Undo / Redo ─────────────────────────────────────────────────────
  // Простой стек снимков localStorage. При каждом изменении (debounced) — снимок.
  const history = {
    past: [], future: [], last: null,
    capture: debounce(() => {
      const cur = localStorage.getItem(STORAGE_KEY);
      if (cur === history.last) return;
      if (history.last !== null) {
        history.past.push(history.last);
        if (history.past.length > 50) history.past.shift();
      }
      history.last = cur;
      history.future.length = 0;
      updateToolbarState();
    }, 800),
    undo() {
      if (this.past.length === 0) { Toast.show('Нечего отменять', 'info', 1200); return; }
      const prev = this.past.pop();
      if (this.last !== null) this.future.push(this.last);
      this.last = prev;
      localStorage.setItem(STORAGE_KEY, prev);
      location.reload();
    },
    redo() {
      if (this.future.length === 0) { Toast.show('Нечего повторять', 'info', 1200); return; }
      const next = this.future.pop();
      if (this.last !== null) this.past.push(this.last);
      this.last = next;
      localStorage.setItem(STORAGE_KEY, next);
      location.reload();
    },
  };
  history.last = localStorage.getItem(STORAGE_KEY);

  // Перехватываем все изменения localStorage чтобы успевать снимать снимки.
  const _setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    _setItem.call(this, key, value);
    if (key === STORAGE_KEY) history.capture();
  };

  // ── Сериализация в нейтральный формат ───────────────────────────────
  function exportSnapshot() {
    const state = snapshotState() || {};
    const nodes = state.nodes || [];
    const edges = state.edges || [];
    return {
      viora: { version: 1, tool: 'life' },
      exportedAt: new Date().toISOString(),
      title: nodes.find((n) => n.id === 'root')?.title || '',
      nodes, edges,
      raw: state,
    };
  }

  function toMarkdown() {
    const state = snapshotState() || {};
    const nodes = state.nodes || [];
    const edges = state.edges || [];
    const root = nodes.find((n) => n.id === 'root');
    const byId = (id) => nodes.find((n) => n.id === id);
    const childrenOf = (id) => edges.filter((e) => e.from === id).map((e) => byId(e.to)).filter(Boolean);

    const lines = [];
    lines.push(`# ${root?.title || 'Дерево решений'}`);
    lines.push('');
    lines.push(`_Экспортировано ${new Date().toLocaleString('ru-RU')}_`);
    lines.push('');

    // Группируем: исход → пункт «Плюсы» (контейнер) → детали; то же для минусов
    const outcomes = childrenOf('root').filter((n) => !n.type || (n.type !== 'pro' && n.type !== 'con' && n.type !== 'pros-container' && n.type !== 'cons-container'));
    outcomes.forEach((outcome, i) => {
      lines.push(`## ${i + 1}. ${outcome.title}`);
      const kids = childrenOf(outcome.id);
      const prosContainer = kids.find((k) => k.type === 'pros-container');
      const consContainer = kids.find((k) => k.type === 'cons-container');
      if (prosContainer) {
        const items = childrenOf(prosContainer.id);
        if (items.length) {
          lines.push('### ✅ Плюсы');
          items.forEach((p) => lines.push(`- ${p.title}`));
        }
      }
      if (consContainer) {
        const items = childrenOf(consContainer.id);
        if (items.length) {
          lines.push('### ❌ Минусы');
          items.forEach((c) => lines.push(`- ${c.title}`));
        }
      }
      lines.push('');
    });
    return lines.join('\n');
  }

  // ── Toolbar ────────────────────────────────────────────────────────
  const btnUndo = $('#vToolUndo');
  const btnRedo = $('#vToolRedo');
  const btnExport = $('#vToolExport');
  const btnImport = $('#vToolImport');
  const btnMd = $('#vToolMarkdown');
  const btnTheme = $('#vToolTheme');
  const btnHelp = $('#vToolHelp');

  function updateToolbarState() {
    if (btnUndo) btnUndo.disabled = history.past.length === 0;
    if (btnRedo) btnRedo.disabled = history.future.length === 0;
  }
  updateToolbarState();

  btnUndo?.addEventListener('click', () => history.undo());
  btnRedo?.addEventListener('click', () => history.redo());
  btnExport?.addEventListener('click', () => {
    const data = exportSnapshot();
    const title = (data.title || 'viora-life').toLowerCase().replace(/[^\w\u0400-\u04FF\-]+/g, '-').slice(0, 40);
    Exporter.json(`${title || 'viora-life'}.json`, data);
    Toast.show('Дерево экспортировано', 'success');
  });
  btnImport?.addEventListener('click', async () => {
    const ok = await Confirm.show('Импортировать дерево?',
      'Текущее дерево будет заменено. Сначала рекомендую экспортировать его на всякий случай.',
      { confirmText: 'Импортировать', cancelText: 'Отмена', danger: true });
    if (!ok) return;
    const data = await Exporter.importJson();
    if (!data) return;
    const state = data.raw && data.raw.nodes ? data.raw : data;
    if (!state.nodes || !Array.isArray(state.nodes)) {
      Toast.show('Файл не похож на дерево Viora', 'error');
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    Toast.show('Дерево импортировано, перезагрузка…', 'success', 1500);
    setTimeout(() => location.reload(), 800);
  });
  btnMd?.addEventListener('click', () => {
    const md = toMarkdown();
    const state = snapshotState() || {};
    const title = (state.nodes?.find((n) => n.id === 'root')?.title || 'viora-life')
      .toLowerCase().replace(/[^\w\u0400-\u04FF\-]+/g, '-').slice(0, 40);
    Exporter.markdown(`${title || 'viora-life'}.md`, md);
    Toast.show('Markdown экспортирован', 'success');
  });
  btnTheme?.addEventListener('click', () => {
    Theme.toggle();
    btnTheme.textContent = Theme.get() === 'dark' ? '☾' : '☀';
  });
  btnTheme && (btnTheme.textContent = Theme.get() === 'dark' ? '☾' : '☀');

  // ── Помощь / шорткаты ──────────────────────────────────────────────
  const shortcutItems = [
    ['Ctrl+Z', 'Отменить'],
    ['Ctrl+Shift+Z', 'Повторить'],
    ['Ctrl+S', 'Экспорт в JSON'],
    ['Ctrl+E', 'Экспорт в Markdown'],
    ['Delete', 'Удалить выбранный узел'],
    ['Esc', 'Закрыть панели и модалки'],
    ['?', 'Эта справка'],
    ['+ / -', 'Зум холста'],
    ['0', 'Центрировать на корне'],
  ];
  btnHelp?.addEventListener('click', () => Help.show(shortcutItems));

  Shortcuts.bind({
    'ctrl+z': () => history.undo(),
    'ctrl+shift+z': () => history.redo(),
    'ctrl+y': () => history.redo(),
    'ctrl+s': () => btnExport?.click(),
    'ctrl+e': () => btnMd?.click(),
    'del': () => {
      const focused = document.activeElement?.closest('.node');
      if (!focused || focused.dataset.id === 'root') return;
      if (typeof window.removeNode === 'function') window.removeNode(focused.dataset.id);
    },
    'esc': () => {
      const modal = $('#modalOverlay');
      if (modal?.classList.contains('active')) modal.classList.remove('active');
      const sidePanel = $('#sidePanel');
      if (sidePanel && sidePanel.style.display !== 'none') {
        // не закрываем панель Esc'ом — слишком разрушительно; просто игнорируем
      }
    },
    'shift+?': () => Help.show(shortcutItems),
    '+': () => $('#zoomIn')?.click(),
    '-': () => $('#zoomOut')?.click(),
    '0': () => $('#centerRoot')?.click(),
  });

  // ── Streaming-режим анализа исходов ────────────────────────────────
  const aiAnalyzeBtn = $('#ai-analyze');
  const aiOutput = $('#ai-output');

  if (aiAnalyzeBtn) {
    const clone = aiAnalyzeBtn.cloneNode(true);
    aiAnalyzeBtn.parentNode.replaceChild(clone, aiAnalyzeBtn);
    clone.id = 'ai-analyze';
    clone.addEventListener('click', runWithStream);
  }

  function collectAnalysisInput() {
    if (typeof window.collectFormData === 'function') return window.collectFormData();
    if (typeof window.collectTreeText === 'function') return window.collectTreeText();
    return { title: '', outcomes: [] };
  }

  async function runWithStream() {
    const btn = $('#ai-analyze');
    if (!btn) return;
    if (typeof window.collectTreeText !== 'function') {
      Toast.show('Инициализация ещё не завершена', 'warning');
      return;
    }
    const { title, outcomes } = collectAnalysisInput();
    if (!title) {
      aiOutput.textContent = 'Опишите вопрос в форме выше и нажмите «Создать дерево».';
      Toast.show('Сначала опишите проблему', 'warning');
      return;
    }
    if (!outcomes.length) {
      aiOutput.textContent = 'Добавьте варианты и нажмите «Создать дерево».';
      Toast.show('Добавьте варианты решения', 'warning');
      return;
    }
    const canvasOutcomes = typeof window.getOutcomeNodes === 'function'
      ? window.getOutcomeNodes().length
      : document.querySelectorAll('.node[data-id]:not([data-id="root"])').length;
    if (!canvasOutcomes && typeof window.buildTreeFromForm === 'function') {
      const built = window.buildTreeFromForm();
      if (!built) return;
      await new Promise((r) => setTimeout(r, 400));
    }
    // Проверяем блокировку через DOM (life.js хранит таймер в #ai-timer)
    const timerText = document.getElementById('ai-timer')?.textContent || '';
    if (/\d/.test(timerText)) { Toast.show('Подождите окончания таймера', 'info'); return; }

    btn.disabled = true;
    btn.style.opacity = '0.6';

    aiOutput.innerHTML = `
      <div class="ai-response">
        <div class="meta"><b>Анализ ${outcomes.length} исхода(ов) — в реальном времени</b></div>
        <div id="stream-progress" style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.6);" aria-live="polite">Подключение к ИИ…</div>
        <div id="stream-results" style="margin-top:8px;"></div>
      </div>`;
    const progressEl = $('#stream-progress');
    const resultsEl = $('#stream-results');
    let done = 0;

    try {
      const resp = await fetch('/run-ai-life/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, outcomes }),
      });
      if (!resp.ok || !resp.body) {
        throw new Error('HTTP ' + resp.status);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { done: rdone, value } = await reader.read();
        if (rdone) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE-парсер: разделитель — пустая строка
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const block of parts) {
          const lines = block.split('\n');
          let event = 'message', dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr += line.slice(6);
          }
          if (!dataStr) continue;
          let data;
          try { data = JSON.parse(dataStr); } catch { continue; }
          if (event === 'result') {
            done++;
            progressEl.textContent = `Получено ${done} из ${outcomes.length}`;
            renderStreamResult(resultsEl, data, outcomes.length);
            // дозаписываем секции анализа (плюсы, минусы, риски, рекомендации, вердикт) как узлы
            if (typeof window.createProConNodesForOutcome === 'function') {
              const parsed = (window.lifeAnalysisFromItem || window.parseProsConsFromText)(data);
              const hasAny = (parsed.pros?.length || parsed.cons?.length ||
                parsed.risks?.length || parsed.recommendations?.length ||
                (parsed.verdict && parsed.verdict.trim()));
              if (hasAny) {
                window.createProConNodesForOutcome(data.outcome, parsed.pros, parsed.cons, data.index, {
                  risks: parsed.risks || [],
                  recommendations: parsed.recommendations || [],
                  verdict: parsed.verdict || ''
                });
              }
            }
          } else if (event === 'done') {
            progressEl.textContent = `Готово (${done} из ${outcomes.length})`;
            if (typeof window.scheduleFinalAiLayout === 'function') {
              window.scheduleFinalAiLayout(150);
            } else if (typeof window.relayoutAllProConTrees === 'function') {
              window.relayoutAllProConTrees();
            }
            Toast.show(`Анализ завершён: ${done} исход(ов)`, 'success');
          }
        }
      }

      if (typeof window.setLock === 'function') window.setLock(60);
    } catch (e) {
      console.error(e);
      Toast.show('Ошибка: ' + e.message, 'error', 5000);
      progressEl.textContent = 'Ошибка: ' + e.message;
    } finally {
      btn.disabled = false;
      btn.style.opacity = '';
    }
  }

  function renderStreamResult(container, data, total) {
    const parsed = (window.lifeAnalysisFromItem || window.parseProsConsFromText || (() => ({ description: data.result, pros: [], cons: [] })))(data);
    const ratingMatch = (parsed.rating || '').match(/(\d+(?:[.,]\d+)?)\s*\/\s*10/);
    const ratingNum = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;
    const ratingPct = ratingNum != null ? Math.max(0, Math.min(100, ratingNum * 10)) : null;
    const ratingHue = ratingNum != null ? Math.round((ratingNum / 10) * 120) : 0;
    const div = document.createElement('div');
    div.className = 'ai-response result-highlight';
    div.style.animation = 'fadeIn 0.4s ease';
    const ok = data.ok !== false;
    div.innerHTML = `
      <div class="meta">
        <b>Исход ${data.index + 1} из ${total}:</b>
        ${escapeHtml(data.outcome || '')}
        ${ok ? '' : '<span style="color:#ef4444;margin-left:6px">⚠ ошибка</span>'}
      </div>
      ${parsed.description ? `
        <div class="ai-section">
          <div class="ai-section-title">📝 Анализ</div>
          <div class="ai-section-body">${escapeHtml(parsed.description)}</div>
        </div>` : ''}
      ${parsed.pros?.length ? `
        <div class="ai-section">
          <div class="ai-section-title" style="color: var(--pro-color);">✅ Плюсы</div>
          <ul class="pros-list">${parsed.pros.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
        </div>` : ''}
      ${parsed.cons?.length ? `
        <div class="ai-section">
          <div class="ai-section-title" style="color: var(--con-color);">❌ Минусы</div>
          <ul class="cons-list">${parsed.cons.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
        </div>` : ''}
      ${parsed.risks?.length ? `
        <div class="ai-section">
          <div class="ai-section-title" style="color: #f59e0b;">⚠️ Риски</div>
          <ul class="risks-list">${parsed.risks.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        </div>` : ''}
      ${parsed.recommendations?.length ? `
        <div class="ai-section">
          <div class="ai-section-title" style="color: #60a5fa;">💡 Рекомендации</div>
          <ul class="recs-list">${parsed.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        </div>` : ''}
      ${parsed.rating ? `
        <div class="ai-section ai-rating">
          <div class="ai-section-title">📊 Оценка</div>
          <div class="ai-rating-row">
            <div class="ai-rating-value" style="color: hsl(${ratingHue}, 70%, 60%);">${escapeHtml(parsed.rating)}</div>
            ${ratingPct != null ? `<div class="ai-rating-bar"><div class="ai-rating-fill" style="width:${ratingPct}%; background: hsl(${ratingHue}, 70%, 55%);"></div></div>` : ''}
          </div>
        </div>` : ''}
      ${parsed.verdict ? `
        <div class="ai-section ai-verdict">
          <div class="ai-section-title">🎯 Вердикт</div>
          <div class="ai-section-body verdict-body">${escapeHtml(parsed.verdict)}</div>
        </div>` : ''}`;
    container.appendChild(div);
  }
  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  // Замена нативного confirm() оригинального скрипта на красивый
  // (life.js использует свою функцию showModal — её не трогаем,
  // но любой `alert`/`confirm` если возникнет — обернётся в тост)
  const _alert = window.alert;
  window.alert = (msg) => Toast.show(String(msg), 'info', 3000);

  // Health-проверка backend (молча в фоне)
  (async () => {
    try {
      const r = await fetch('/healthz');
      if (r.ok) return;
      const data = await r.json().catch(() => ({}));
      if (data.status === 'degraded') {
        Toast.show('Ollama недоступна — ИИ не будет отвечать. Проверьте локальный сервер.', 'warning', 6000);
      }
    } catch { /* ignore */ }
  })();

  // Добавим простую CSS-анимацию для появления стримовых блоков
  const style = document.createElement('style');
  style.textContent = `@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`;
  document.head.appendChild(style);

  console.info('[Viora] life-enhancements активированы');
})();
