/**
 * Viora — общий модуль для всех страниц.
 *
 * Предоставляет:
 *  - Toast.show(message, type, ms)      — неблокирующие уведомления
 *  - Confirm.show(title, text)          — Promise<boolean> вместо confirm()/alert()
 *  - Theme.toggle()/Theme.set(name)     — переключение dark/light
 *  - Exporter.json/png/markdown(...)    — экспорт состояния
 *  - History.snapshot()/undo()/redo()   — undo/redo стек состояний (с дебаунсом)
 *  - Shortcuts.bind(map)                — горячие клавиши с авто-помощью
 *  - tryFetch(url, opts)                — fetch с понятными ошибками
 *  - escapeHtml(s)                      — безопасный текст в HTML
 */
(function (global) {
  'use strict';

  // ════════════════════════ Toasts ════════════════════════
  const Toast = {
    _root: null,
    _ensureRoot() {
      if (this._root) return this._root;
      const root = document.createElement('div');
      root.id = 'viora-toasts';
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
      Object.assign(root.style, {
        position: 'fixed', top: '16px', left: '50%',
        transform: 'translateX(-50%)', zIndex: 99999,
        display: 'flex', flexDirection: 'column', gap: '8px',
        pointerEvents: 'none', maxWidth: '92vw',
      });
      document.body.appendChild(root);
      this._root = root;
      return root;
    },
    show(message, type = 'info', ms = 3200) {
      const root = this._ensureRoot();
      const el = document.createElement('div');
      const colors = {
        info:    { bg: 'rgba(10,10,15,0.92)',  border: 'rgba(0,217,255,0.4)',  icon: 'ℹ' },
        success: { bg: 'rgba(16,185,129,0.18)', border: 'rgba(16,185,129,0.6)', icon: '✓' },
        error:   { bg: 'rgba(239,68,68,0.18)',  border: 'rgba(239,68,68,0.6)',  icon: '✕' },
        warning: { bg: 'rgba(245,158,11,0.18)', border: 'rgba(245,158,11,0.6)', icon: '!' },
      };
      const c = colors[type] || colors.info;
      Object.assign(el.style, {
        background: c.bg, color: '#fff', padding: '10px 16px',
        borderRadius: '10px', border: `1px solid ${c.border}`,
        backdropFilter: 'blur(10px)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        fontFamily: 'Inter, sans-serif', fontSize: '14px',
        display: 'flex', alignItems: 'center', gap: '10px',
        pointerEvents: 'auto', cursor: 'pointer',
        opacity: '0', transform: 'translateY(-12px)',
        transition: 'all 0.25s ease',
      });
      el.innerHTML = `<span style="font-weight:700">${c.icon}</span><span>${escapeHtml(String(message))}</span>`;
      el.addEventListener('click', () => dismiss());
      root.appendChild(el);
      requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      });
      let timeout;
      const dismiss = () => {
        if (timeout) clearTimeout(timeout);
        el.style.opacity = '0';
        el.style.transform = 'translateY(-12px)';
        setTimeout(() => el.remove(), 300);
      };
      timeout = setTimeout(dismiss, ms);
      return { dismiss };
    },
  };

  // ════════════════════════ Confirm (модалка) ════════════════════════
  const Confirm = {
    show(title, text, { confirmText = 'OK', cancelText = 'Отмена', danger = false } = {}) {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)',
          opacity: '0', transition: 'opacity 0.2s ease',
        });
        const box = document.createElement('div');
        Object.assign(box.style, {
          background: 'rgba(10,10,15,0.92)', color: '#fff',
          padding: '20px 24px', borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.1)',
          maxWidth: '420px', width: '90vw',
          fontFamily: 'Inter, sans-serif',
          transform: 'scale(0.95)', transition: 'transform 0.2s ease',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
        });
        box.innerHTML = `
          <div style="font-size:17px;font-weight:600;margin-bottom:10px;color:#7dd3fc">${escapeHtml(title)}</div>
          <div style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.75);margin-bottom:20px">${escapeHtml(text)}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button data-act="cancel" style="padding:9px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#fff;cursor:pointer;font-size:14px">${escapeHtml(cancelText)}</button>
            <button data-act="ok" style="padding:9px 16px;border-radius:8px;border:none;background:${danger ? '#ef4444' : '#00d9ff'};color:#0a0a0f;font-weight:600;cursor:pointer;font-size:14px">${escapeHtml(confirmText)}</button>
          </div>`;
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
          overlay.style.opacity = '1';
          box.style.transform = 'scale(1)';
        });
        const close = (answer) => {
          overlay.style.opacity = '0';
          box.style.transform = 'scale(0.95)';
          setTimeout(() => overlay.remove(), 200);
          resolve(answer);
        };
        box.querySelector('[data-act="ok"]').focus();
        box.querySelector('[data-act="ok"]').addEventListener('click', () => close(true));
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
        document.addEventListener('keydown', function onKey(e) {
          if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(false); }
          if (e.key === 'Enter')  { document.removeEventListener('keydown', onKey); close(true); }
        });
      });
    },
  };

  // ════════════════════════ Theme ════════════════════════
  const Theme = {
    _key: 'viora_theme',
    get() { return localStorage.getItem(this._key) || 'dark'; },
    set(name) {
      localStorage.setItem(this._key, name);
      document.documentElement.dataset.theme = name;
      document.dispatchEvent(new CustomEvent('viora:theme', { detail: { theme: name } }));
    },
    toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
    init() { this.set(this.get()); },
  };

  // ════════════════════════ Exporter ════════════════════════
  const Exporter = {
    json(filename, data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      this._download(blob, filename.endsWith('.json') ? filename : `${filename}.json`);
    },
    markdown(filename, content) {
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      this._download(blob, filename.endsWith('.md') ? filename : `${filename}.md`);
    },
    async png(filename, svgOrCanvasNode, { background = '#09090b', padding = 20 } = {}) {
      // Базовый экспорт canvas → PNG. Для сложного экспорта (SVG+узлы) — html-to-image.
      let canvas;
      if (svgOrCanvasNode instanceof HTMLCanvasElement) {
        canvas = svgOrCanvasNode;
      } else {
        // Делаем простой скриншот через html2canvas-стиль обхода: пользователь увидит инструкцию.
        Toast.show('PNG-экспорт пока не реализован для произвольного DOM. Используйте JSON.', 'warning');
        return;
      }
      canvas.toBlob((blob) => {
        if (blob) this._download(blob, filename.endsWith('.png') ? filename : `${filename}.png`);
      });
    },
    _download(blob, name) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
    },
    importJson() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'application/json';
        input.onchange = async (e) => {
          const file = e.target.files?.[0];
          if (!file) { resolve(null); return; }
          try {
            const text = await file.text();
            resolve(JSON.parse(text));
          } catch (err) {
            Toast.show('Не удалось прочитать JSON: ' + err.message, 'error');
            resolve(null);
          }
        };
        input.click();
      });
    },
  };

  // ════════════════════════ Undo / Redo ════════════════════════
  function createHistory({ capture, restore, capacity = 50, debounceMs = 600 }) {
    const past = [], future = [];
    let timer = null, lastSnapshot = null;

    function snapshot(force = false) {
      const take = () => {
        const snap = JSON.stringify(capture());
        if (snap === lastSnapshot) return;
        if (lastSnapshot !== null) past.push(lastSnapshot);
        lastSnapshot = snap;
        future.length = 0;
        while (past.length > capacity) past.shift();
      };
      if (force) {
        if (timer) clearTimeout(timer);
        take();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(take, debounceMs);
    }
    function undo() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (past.length === 0) return false;
      if (lastSnapshot !== null) future.push(lastSnapshot);
      lastSnapshot = past.pop();
      restore(JSON.parse(lastSnapshot));
      return true;
    }
    function redo() {
      if (future.length === 0) return false;
      if (lastSnapshot !== null) past.push(lastSnapshot);
      lastSnapshot = future.pop();
      restore(JSON.parse(lastSnapshot));
      return true;
    }
    function reset() {
      past.length = 0; future.length = 0;
      lastSnapshot = JSON.stringify(capture());
    }
    return { snapshot, undo, redo, reset,
      get canUndo() { return past.length > 0; },
      get canRedo() { return future.length > 0; } };
  }

  // ════════════════════════ Shortcuts ════════════════════════
  const Shortcuts = {
    _binds: [],
    bind(map) {
      // map: { 'ctrl+z': fn, 'delete': fn, 'esc': fn, ... }
      Object.entries(map).forEach(([combo, fn]) => {
        this._binds.push({ combo: this._parse(combo), fn, label: combo });
      });
      if (!this._attached) {
        document.addEventListener('keydown', (e) => this._handle(e));
        this._attached = true;
      }
    },
    _parse(combo) {
      const parts = combo.toLowerCase().split('+').map((p) => p.trim());
      return {
        ctrl:  parts.includes('ctrl') || parts.includes('cmd'),
        shift: parts.includes('shift'),
        alt:   parts.includes('alt'),
        key:   parts.filter((p) => !['ctrl','cmd','shift','alt'].includes(p))[0],
      };
    },
    _handle(e) {
      // не перехватываем шорткаты при печати в input/contenteditable
      const t = e.target;
      const editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const keyName = e.key.toLowerCase();
      for (const { combo, fn } of this._binds) {
        const ctrlMatch = combo.ctrl === (e.ctrlKey || e.metaKey);
        const shiftMatch = combo.shift === e.shiftKey;
        const altMatch = combo.alt === e.altKey;
        const keyMatch = combo.key === keyName ||
          (combo.key === 'esc' && keyName === 'escape') ||
          (combo.key === 'del' && keyName === 'delete');
        if (ctrlMatch && shiftMatch && altMatch && keyMatch) {
          // разрешаем Esc и Ctrl+S всегда; остальное — не при печати
          const alwaysAllowed = combo.key === 'esc' || (combo.ctrl && combo.key === 's');
          if (editing && !alwaysAllowed) continue;
          e.preventDefault();
          fn(e);
          return;
        }
      }
    },
  };

  // ════════════════════════ fetch helper ════════════════════════
  async function tryFetch(url, opts = {}) {
    try {
      const r = await fetch(url, opts);
      const ct = r.headers.get('content-type') || '';
      const isJson = ct.includes('application/json');
      const body = isJson ? await r.json() : await r.text();
      if (!r.ok) {
        const msg = (isJson && body && body.error) ? body.error : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      return body;
    } catch (e) {
      throw new Error(e.message || 'Сетевая ошибка');
    }
  }

  // ════════════════════════ utils ════════════════════════
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function debounce(fn, ms = 200) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ════════════════════════ Help overlay ════════════════════════
  const Help = {
    show(items) {
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100000, backdropFilter: 'blur(8px)',
      });
      const box = document.createElement('div');
      Object.assign(box.style, {
        background: 'rgba(10,10,15,0.95)', color: '#fff',
        padding: '24px 28px', borderRadius: '14px',
        border: '1px solid rgba(255,255,255,0.1)',
        maxWidth: '520px', width: '92vw',
        fontFamily: 'Inter, sans-serif',
        boxShadow: '0 30px 80px rgba(0,0,0,0.8)',
      });
      const rows = items.map(([combo, desc]) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
          <span style="color:rgba(255,255,255,0.75);font-size:14px">${escapeHtml(desc)}</span>
          <kbd style="font-family:inherit;background:rgba(255,255,255,0.06);padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);font-size:12px;color:#7dd3fc">${escapeHtml(combo)}</kbd>
        </div>`).join('');
      box.innerHTML = `
        <div style="font-size:18px;font-weight:600;margin-bottom:14px;color:#7dd3fc">Горячие клавиши</div>
        ${rows}
        <div style="margin-top:18px;text-align:right">
          <button style="padding:8px 16px;border-radius:8px;border:none;background:#00d9ff;color:#0a0a0f;font-weight:600;cursor:pointer">Закрыть</button>
        </div>`;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      box.querySelector('button').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(); }
      });
    },
  };

  // ════════════════════════ Export ════════════════════════
  global.Viora = {
    Toast, Confirm, Theme, Exporter, Shortcuts, Help,
    createHistory, tryFetch, escapeHtml, debounce,
  };
})(window);
