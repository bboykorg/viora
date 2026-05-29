/**
 * flow-enhancements.js — слой расширений поверх flow.js.
 *
 * Добавляет (без изменения базовой логики):
 *  • Undo / Redo
 *  • Экспорт JSON / Markdown / импорт JSON
 *  • Горячие клавиши
 *  • Тёмная / светлая тема
 *  • Тосты и health-чек
 */
(() => {
  'use strict';
  if (!window.Viora) { console.error('Viora common.js не загружен'); return; }
  const { Toast, Confirm, Theme, Exporter, Shortcuts, Help, debounce } = window.Viora;
  Theme.init();

  const STORAGE_KEY = 'viora_flow_state';
  const $ = (sel) => document.querySelector(sel);

  function snapshotState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch { return null; }
  }

  // ── Undo / Redo (снимки localStorage) ────────────────────────────
  const history = {
    past: [], future: [], last: localStorage.getItem(STORAGE_KEY),
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
  const _setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    _setItem.call(this, key, value);
    if (key === STORAGE_KEY) history.capture();
  };

  // ── Сериализация ─────────────────────────────────────────────────
  function exportSnapshot() {
    const state = snapshotState() || {};
    const nodes = state.nodes || [];
    return {
      viora: { version: 1, tool: 'flow' },
      exportedAt: new Date().toISOString(),
      title: nodes.find((n) => n.id === 'root')?.title || '',
      nodes, edges: state.edges || [], raw: state,
    };
  }

  function toMarkdown() {
    const state = snapshotState() || {};
    const nodes = state.nodes || [];
    const edges = state.edges || [];
    const root = nodes.find((n) => n.id === 'root');
    const byId = (id) => nodes.find((n) => n.id === id);

    const lines = [];
    lines.push(`# Сценарий: ${root?.title || 'Поток кадров'}`);
    lines.push('');
    lines.push(`_Экспортировано ${new Date().toLocaleString('ru-RU')}_`);
    lines.push('');

    // Идём по дереву кадров в порядке создания.
    const visited = new Set(['root']);
    function walk(id, depth = 0) {
      const node = byId(id);
      if (!node) return;
      if (id !== 'root') {
        const indent = '  '.repeat(Math.max(0, depth - 1));
        lines.push(`${indent}- **${node.title || 'Без названия'}**`);
      } else {
        lines.push(`## Старт`);
        lines.push(`> ${node.title || 'Начальный кадр'}`);
        lines.push('');
      }
      const kids = edges.filter((e) => e.from === id).map((e) => e.to);
      kids.forEach((kid) => { if (!visited.has(kid)) { visited.add(kid); walk(kid, depth + 1); } });
    }
    walk('root');
    return lines.join('\n');
  }

  // ── Toolbar ──────────────────────────────────────────────────────
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
    const title = (data.title || 'viora-flow').toLowerCase().replace(/[^\w\u0400-\u04FF\-]+/g, '-').slice(0, 40);
    Exporter.json(`${title || 'viora-flow'}.json`, data);
    Toast.show('Сценарий экспортирован', 'success');
  });
  btnImport?.addEventListener('click', async () => {
    const ok = await Confirm.show('Импортировать сценарий?',
      'Текущий сценарий будет заменён. Сначала рекомендую экспортировать его на всякий случай.',
      { confirmText: 'Импортировать', cancelText: 'Отмена', danger: true });
    if (!ok) return;
    const data = await Exporter.importJson();
    if (!data) return;
    const state = data.raw && data.raw.nodes ? data.raw : data;
    if (!state.nodes || !Array.isArray(state.nodes)) {
      Toast.show('Файл не похож на сценарий Viora', 'error');
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    Toast.show('Сценарий импортирован, перезагрузка…', 'success', 1500);
    setTimeout(() => location.reload(), 800);
  });
  btnMd?.addEventListener('click', () => {
    const md = toMarkdown();
    const state = snapshotState() || {};
    const title = (state.nodes?.find((n) => n.id === 'root')?.title || 'viora-flow')
      .toLowerCase().replace(/[^\w\u0400-\u04FF\-]+/g, '-').slice(0, 40);
    Exporter.markdown(`${title || 'viora-flow'}.md`, md);
    Toast.show('Markdown экспортирован', 'success');
  });
  btnTheme?.addEventListener('click', () => {
    Theme.toggle();
    btnTheme.textContent = Theme.get() === 'dark' ? '☾' : '☀';
  });
  btnTheme && (btnTheme.textContent = Theme.get() === 'dark' ? '☾' : '☀');

  const shortcutItems = [
    ['Ctrl+Z', 'Отменить'],
    ['Ctrl+Shift+Z', 'Повторить'],
    ['Ctrl+S', 'Экспорт в JSON'],
    ['Ctrl+E', 'Экспорт в Markdown'],
    ['Delete', 'Удалить выбранный кадр'],
    ['Esc', 'Закрыть модалки'],
    ['?', 'Эта справка'],
    ['+ / -', 'Зум холста'],
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
      const modal = $('#frameAnalysisModal');
      if (modal?.classList.contains('active')) modal.classList.remove('active');
    },
    'shift+?': () => Help.show(shortcutItems),
    '+': () => $('#zoomIn')?.click(),
    '-': () => $('#zoomOut')?.click(),
  });

  // Замена нативного alert на тост
  window.alert = (msg) => Toast.show(String(msg), 'info', 3000);

  // Health-проверка
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

  console.info('[Viora] flow-enhancements активированы');
})();
