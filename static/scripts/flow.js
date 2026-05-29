// ========== КОНФИГУРАЦИЯ ==========
const STORAGE_KEY = 'viora_flow_state';
const canvas = document.getElementById('canvasArea');
const canvasContainer = document.getElementById('canvasContainer');
const canvasTransform = document.getElementById('canvasTransform');
const canvasContent = document.getElementById('canvasContent');
const connectorsSvg = document.getElementById('connectors');
const sidePanel = document.getElementById('sidePanel');
const sideHeader = document.getElementById('sideHeader');
const panelCloseBtn = document.getElementById('panelCloseBtn');
const openPanelBtn = document.getElementById('openPanelBtn');
const frameAnalysisModal = document.getElementById('frameAnalysisModal');
const frameList = document.getElementById('frameList');
const modalCancel = document.getElementById('modalCancel');
const modalAnalyze = document.getElementById('modalAnalyze');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const resetZoomBtn = document.getElementById('resetZoom');
const zoomLevelDisplay = document.getElementById('zoomLevel');
const aiNextFrameBtn = document.getElementById('ai-next-frame');
const aiAnalyzeFramesBtn = document.getElementById('ai-analyze-frames');
const aiResetFramesBtn = document.getElementById('ai-reset-frames');

let edges = [];
let nodeCounter = 1;
const MAX_RETRIES = 4;
let isLockedUntil = 0;
let timerInterval = null;
let _saveTimeout = null;
let selectedFramesForAnalysis = new Set();

// ПЕРЕМЕННЫЕ ДЛЯ МАСШТАБИРОВАНИЯ
let scale = 1;
let translateX = 0;
let translateY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let startTranslate = { x: 0, y: 0 };

const ZOOM_CONFIG = {
    min: 0.1,
    max: 3.0,
    step: 0.1,
    default: 1.0
};

// КОНФИГУРАЦИЯ РАСПОЛОЖЕНИЯ И ГРАНИЦ
const LAYOUT_CONFIG = {
  NODE_WIDTH: 300,
  NODE_HEIGHT: 80,
  COLUMN_SPACING: 220,
  ROW_SPACING: 90,
  CANVAS_WIDTH: 5000,
  CANVAS_HEIGHT: 5000
};

// Границы перемещения блоков (уменьшены для комфортной работы)
const BOUNDARIES = {
  minX: 50,
  minY: 50,
  maxX: LAYOUT_CONFIG.CANVAS_WIDTH - LAYOUT_CONFIG.NODE_WIDTH - 50,
  maxY: LAYOUT_CONFIG.CANVAS_HEIGHT - LAYOUT_CONFIG.NODE_HEIGHT - 50
};

// ========== ФУНКЦИИ МАСШТАБИРОВАНИЯ ==========
function updateTransform() {
    canvasTransform.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    zoomLevelDisplay.textContent = `${Math.round(scale * 100)}%`;
    renderConnections();
    saveState();
}

function zoomToPoint(zoomFactor, clientX, clientY) {
    const rect = canvasContainer.getBoundingClientRect();
    const pointX = clientX - rect.left;
    const pointY = clientY - rect.top;

    const worldX = (pointX - translateX) / scale;
    const worldY = (pointY - translateY) / scale;

    scale = Math.max(ZOOM_CONFIG.min, Math.min(ZOOM_CONFIG.max, zoomFactor));

    translateX = pointX - worldX * scale;
    translateY = pointY - worldY * scale;

    updateTransform();
}

function zoomIn() {
    const newScale = Math.min(ZOOM_CONFIG.max, scale + ZOOM_CONFIG.step);
    const rect = canvasContainer.getBoundingClientRect();
    zoomToPoint(newScale, rect.width / 2, rect.height / 2);
}

function zoomOut() {
    const newScale = Math.max(ZOOM_CONFIG.min, scale - ZOOM_CONFIG.step);
    const rect = canvasContainer.getBoundingClientRect();
    zoomToPoint(newScale, rect.width / 2, rect.height / 2);
}

function resetZoom() {
    scale = ZOOM_CONFIG.default;
    translateX = 0;
    translateY = 0;
    updateTransform();
}

function centerOnRoot() {
    const root = byId('root');
    if(!root) return;

    const rootX = parseFloat(root.style.left) || LAYOUT_CONFIG.CANVAS_WIDTH / 2;
    const rootY = parseFloat(root.style.top) || LAYOUT_CONFIG.CANVAS_HEIGHT / 2;

    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;

    translateX = -rootX * scale + containerWidth / 2;
    translateY = -rootY * scale + containerHeight / 2;

    updateTransform();
}

// ОБРАБОТЧИКИ МАСШТАБИРОВАНИЯ
zoomInBtn.addEventListener('click', zoomIn);
zoomOutBtn.addEventListener('click', zoomOut);
resetZoomBtn.addEventListener('click', resetZoom);

// Добавляем кнопку центрирования в zoom-контролы
const zoomControls = document.querySelector('.zoom-controls');
const centerBtn = document.createElement('button');
centerBtn.className = 'zoom-btn';
centerBtn.id = 'centerRoot';
centerBtn.title = 'Центрировать на главном блоке';
centerBtn.textContent = '⌖';
zoomControls.appendChild(centerBtn);
centerBtn.addEventListener('click', centerOnRoot);

canvasContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? scale - ZOOM_CONFIG.step : scale + ZOOM_CONFIG.step;
    zoomToPoint(zoomFactor, e.clientX, e.clientY);
});

// ПАННОРАМИРОВАНИЕ
canvasContainer.addEventListener('mousedown', (e) => {
    const target = e.target;
    if (target.closest('.node') || target.closest('.add-btn') || target.closest('.remove-btn') || target.closest('.title')) return;
    if (e.button !== 0) return;

    isPanning = true;
    panStart.x = e.clientX;
    panStart.y = e.clientY;
    startTranslate.x = translateX;
    startTranslate.y = translateY;

    canvasContainer.classList.add('canvas-panning');
    document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    translateX = startTranslate.x + dx;
    translateY = startTranslate.y + dy;
    updateTransform();
});

document.addEventListener('mouseup', () => {
    if (!isPanning) return;
    isPanning = false;
    canvasContainer.classList.remove('canvas-panning');
    document.body.style.userSelect = '';
    saveState();
});

// ========== УПРАВЛЕНИЕ ПОЗИЦИЯМИ С ГРАНИЦАМИ ==========
// ── Карта прямоугольников: nodeId → {x, y, w, h} (источник правды) ──
let occupiedRectangles = new Map();

function resetOccupiedPositions() {
  occupiedPositions = new Map(); // оставляем для обратной совместимости с saveState
  occupiedRectangles = new Map();
}

function registerPosition(nodeId, x, y, width, height) {
  const node = byId(nodeId);
  const w = width  || (node ? node.offsetWidth  : 0) || LAYOUT_CONFIG.NODE_WIDTH;
  const h = height || (node ? node.offsetHeight : 0) || LAYOUT_CONFIG.NODE_HEIGHT;
  occupiedRectangles.set(nodeId, { x, y, w, h });
  // ОБ совместимость с прежним кодом, читающим occupiedPositions:
  const gridX = Math.floor(x / 30), gridY = Math.floor(y / 30);
  occupiedPositions.set(`${gridX}_${gridY}`, { nodeId, x, y });
}

function unregisterPosition(nodeId) {
  occupiedRectangles.delete(nodeId);
  for (const [key, val] of occupiedPositions) {
    if (val.nodeId === nodeId) occupiedPositions.delete(key);
  }
}

function rectsOverlap(a, b, pad = 10) {
  return !(a.x + a.w + pad <= b.x ||
           b.x + b.w + pad <= a.x ||
           a.y + a.h + pad <= b.y ||
           b.y + b.h + pad <= a.y);
}

function isPositionFree(x, y, width = LAYOUT_CONFIG.NODE_WIDTH, height = LAYOUT_CONFIG.NODE_HEIGHT, excludeId = null) {
  if (x < BOUNDARIES.minX || y < BOUNDARIES.minY) return false;
  if (x + width > BOUNDARIES.maxX || y + height > BOUNDARIES.maxY) return false;
  const candidate = { x, y, w: width, h: height };
  for (const [id, rect] of occupiedRectangles) {
    if (id === excludeId) continue;
    if (rectsOverlap(candidate, rect)) return false;
  }
  return true;
}

function getViewportCenter() {
  // Получаем центр видимой области
  const containerWidth = canvasContainer.clientWidth;
  const containerHeight = canvasContainer.clientHeight;

  // Преобразуем экранные координаты в мировые
  const worldX = (-translateX + containerWidth / 2) / scale;
  const worldY = (-translateY + containerHeight / 2) / scale;

  return {
    x: worldX - LAYOUT_CONFIG.NODE_WIDTH / 2,
    y: worldY - LAYOUT_CONFIG.NODE_HEIGHT / 2
  };
}

// ── Поиск свободного места: компактная "решётка-спираль" с шагом узла ──
function findFreePosition(nearX, nearY) {
  let targetX = nearX, targetY = nearY;
  if ((!targetX && targetX !== 0) || (!targetY && targetY !== 0)) {
    const c = getViewportCenter();
    targetX = c.x;
    targetY = c.y;
  }

  const W = LAYOUT_CONFIG.NODE_WIDTH;
  const H = LAYOUT_CONFIG.NODE_HEIGHT;
  const stepX = W + 40;   // шаг по горизонтали с зазором
  const stepY = H + 30;   // шаг по вертикали с зазором

  if (isPositionFree(targetX, targetY)) {
    return clampToBoundaries(targetX, targetY);
  }

  // 1) сначала пробуем горизонтальные смещения (типичная цепочка кадров идёт вправо)
  for (let dx = 1; dx <= 8; dx++) {
    for (const sign of [1, -1]) {
      const x = targetX + sign * dx * stepX;
      if (isPositionFree(x, targetY)) return clampToBoundaries(x, targetY);
    }
  }

  // 2) вертикальные смещения
  for (let dy = 1; dy <= 8; dy++) {
    for (const sign of [1, -1]) {
      const y = targetY + sign * dy * stepY;
      if (isPositionFree(targetX, y)) return clampToBoundaries(targetX, y);
    }
  }

  // 3) диагональная спираль в качестве фолбэка
  for (let r = 1; r <= 12; r++) {
    const samples = 12;
    for (let i = 0; i < samples; i++) {
      const angle = (i * 2 * Math.PI) / samples;
      const x = targetX + Math.cos(angle) * r * stepX * 0.7;
      const y = targetY + Math.sin(angle) * r * stepY * 0.9;
      if (isPositionFree(x, y)) return clampToBoundaries(x, y);
    }
  }

  return clampToBoundaries(targetX, targetY);
}

function clampToBoundaries(x, y, width = LAYOUT_CONFIG.NODE_WIDTH, height = LAYOUT_CONFIG.NODE_HEIGHT) {
  const clampedX = Math.max(BOUNDARIES.minX, Math.min(BOUNDARIES.maxX - width, x));
  const clampedY = Math.max(BOUNDARIES.minY, Math.min(BOUNDARIES.maxY - height, y));
  return { x: clampedX, y: clampedY };
}

// ========== СОХРАНЕНИЕ И ЗАГРУЗКА ==========
function saveState(debounceMs = 200){
  if(_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(()=> {
    try {
      const state = serializeState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch(e){ console.error('saveState', e); }
  }, debounceMs);
}

function serializeState(){
  const nodes = Array.from(document.querySelectorAll('.node[data-id]')).map(n => ({
    id: n.dataset.id,
    left: parseFloat(n.style.left) || 0,
    top: parseFloat(n.style.top) || 0,
    title: n.querySelector('.title')?.innerText || '',
    type: n.dataset.type || '',
    collapsed: n.dataset.collapsed === 'true'
  }));

  const panelRect = sidePanel.getBoundingClientRect();
  const editorRect = document.getElementById('editorPage').getBoundingClientRect();
  const panelState = {
    left: panelRect.left - editorRect.left,
    top: panelRect.top - editorRect.top,
    width: panelRect.width,
    height: panelRect.height,
    hidden: sidePanel.style.display === 'none',
    collapsed: sidePanel.dataset.collapsed === '1'
  };

  const viewState = { scale, translateX, translateY };

  return {
    version: 3,
    nodes,
    edges,
    nodeCounter,
    aiOutput: document.getElementById('ai-output')?.innerHTML || '',
    isLockedUntil,
    viewState,
    panelState
  };
}

function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    // Всегда центрируем на корневом блоке при загрузке
    if(raw) {
      const s = JSON.parse(raw);
      if(s) {
        if(typeof s.nodeCounter === 'number') nodeCounter = s.nodeCounter;

        resetOccupiedPositions();

        if (s.viewState && s.version >= 3) {
          scale = s.viewState.scale || ZOOM_CONFIG.default;
          translateX = s.viewState.translateX || 0;
          translateY = s.viewState.translateY || 0;
        }

        const root = document.querySelector('[data-id="root"]');
        if(root){
          const savedRoot = (s.nodes || []).find(n=>n.id === 'root');
          if(savedRoot){
            // Восстанавливаем корневой блок
            const clampedPos = clampToBoundaries(savedRoot.left||0, savedRoot.top||0);
            root.style.left = clampedPos.x + 'px';
            root.style.top = clampedPos.y + 'px';
            const t = root.querySelector('.title');
            if(t) t.innerText = savedRoot.title || '';
            registerPosition('root', clampedPos.x, clampedPos.y);
          }
        }

        document.querySelectorAll('.node').forEach(n => { if(n.dataset.id !== 'root') n.remove(); });
        edges = [];

        if(Array.isArray(s.nodes)){
          s.nodes.forEach(n => {
            if(n.id === 'root') return;
            const clampedPos = clampToBoundaries(n.left || 100, n.top || 100);
            const node = recreateNode(n.id, clampedPos.x, clampedPos.y, n.title || 'Новый кадр');
            if(n.type) node.dataset.type = n.type;
            registerPosition(n.id, clampedPos.x, clampedPos.y);
          });
        }

        if(Array.isArray(s.edges)) edges = s.edges.slice();
        if(s.aiOutput !== undefined) document.getElementById('ai-output').innerHTML = s.aiOutput || '';

        if(s.panelState){
          // Восстанавливаем позицию панели
          sidePanel.style.left = (s.panelState.left || 0) + 'px';
          sidePanel.style.top = (s.panelState.top || 0) + 'px';
          sidePanel.style.right = 'auto';

          // Панель ВСЕГДА стартует раскрытой — иначе при перезагрузке
          // пользователь видит просто полоску-шапку, что неудобно.
          // Свернуть можно вручную кнопкой ↔ в любой момент.
          if(s.panelState.width) sidePanel.style.width = s.panelState.width + 'px';
          if(s.panelState.height) sidePanel.style.height = s.panelState.height + 'px';

          if(s.panelState.hidden) {
            sidePanel.style.display = 'none';
            openPanelBtn.classList.add('visible');
          }
        }

        if(s.isLockedUntil){
          isLockedUntil = s.isLockedUntil;
          updateTimerUI();
          if(isLockedUntil > Date.now()){
            timerInterval && clearInterval(timerInterval);
            timerInterval = setInterval(updateTimerUI, 250);
          }
        }
      }
    } else {
      // Первый запуск - создаем корневой блок в центре
      const root = document.querySelector('[data-id="root"]');
      if(root) {
        const centerX = LAYOUT_CONFIG.CANVAS_WIDTH / 2 - LAYOUT_CONFIG.NODE_WIDTH / 2;
        const centerY = LAYOUT_CONFIG.CANVAS_HEIGHT / 2 - LAYOUT_CONFIG.NODE_HEIGHT / 2;

        root.style.left = centerX + 'px';
        root.style.top = centerY + 'px';
        registerPosition('root', centerX, centerY);
      }
    }

    // ВСЕГДА центрируем на корневом блоке после загрузки
    centerOnRoot();

    renderConnections();
    updateAIPreview();
  } catch(e){ console.error('loadState', e); }
}

// ========== ТАЙМЕР ==========
function setLock(seconds){
  isLockedUntil = Date.now() + seconds*1000;
  updateTimerUI();
  timerInterval && clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerUI, 250);
  saveState();
}

function updateTimerUI(){
  const el = document.getElementById('ai-timer');
  const runBtn = document.getElementById('ai-next-frame');
  const analyzeBtn = document.getElementById('ai-analyze-frames');
  const remaining = Math.max(0, Math.ceil((isLockedUntil - Date.now()) / 1000));
  if(remaining > 0){
    el.innerText = `${remaining}s`;
    runBtn.disabled = true;
    analyzeBtn.disabled = true;
    runBtn.style.opacity='0.6';
    analyzeBtn.style.opacity='0.6';
  } else {
    el.innerText = '—';
    runBtn.disabled = false;
    analyzeBtn.disabled = false;
    runBtn.style.opacity='';
    analyzeBtn.style.opacity='';
    if(timerInterval){
      clearInterval(timerInterval);
      timerInterval=null;
    }
    if(isLockedUntil !== 0){
      isLockedUntil = 0;
      saveState();
    }
  }
}

// ========== УЗЛЫ И ИНТЕРФЕЙС ==========
function byId(id){ return document.querySelector(`[data-id="${id}"]`); }
function genId(){ nodeCounter = (nodeCounter||0) + 1; saveState(); return 'node-' + nodeCounter; }

function recreateNode(id, x=100, y=200, text='Новый кадр'){
  const div = document.createElement('div');
  div.className = 'node';

  const clampedPos = clampToBoundaries(x, y);
  div.style.left = clampedPos.x + 'px';
  div.style.top = clampedPos.y + 'px';

  div.dataset.id = id;
  div.dataset.type = 'frame';
  div.innerHTML = `
    <div contenteditable class="title">${text}</div>
    <div class="controls">
      <div class="small-muted">Кадр</div>
      <div class="buttons-container">
        <div class="add-btn" title="Добавить кадр" data-add>+</div>
        <div class="next-frame-btn" title="Следующий кадр (ИИ)" data-next-frame>→</div>
        ${id==='root' ? '' : '<div class="remove-btn" title="Удалить кадр">✕</div>'}
      </div>
    </div>
  `;
  canvasContent.appendChild(div);
  makeDraggable(div);
  setupNodeButtons(div);
  const t = div.querySelector('.title');
  if(t) t.addEventListener('input', ()=>{ updateAIPreview(); saveState(); });
  return div;
}

function createNode(x=100, y=200, text='Новый кадр', parentId=null, type='frame'){
  const id = genId();
  const freePos = findFreePosition(x, y);
  const node = recreateNode(id, freePos.x, freePos.y, text);
  if(type) node.dataset.type = type;
  if(parentId) addEdge(parentId, id);

  registerPosition(id, freePos.x, freePos.y);
  updateAIPreview();
  renderConnections();
  saveState();
  return id;
}

function makeDraggable(elem){
  let dragging=false, startX=0, startY=0, origLeft=0, origTop=0;

  elem.addEventListener('mousedown', e=>{
    if(e.target.closest('.add-btn, .remove-btn, .next-frame-btn, .analyze-btn')) return;
    if(e.target.closest('.title')) return;
    dragging=true;
    startX=e.clientX;
    startY=e.clientY;
    origLeft=parseFloat(elem.style.left)||0;
    origTop=parseFloat(elem.style.top)||0;
    e.preventDefault();
    elem.style.zIndex = '1000';
  });

  document.addEventListener('mousemove', e=>{
    if(!dragging) return;
    const dx=e.clientX-startX;
    const dy=e.clientY-startY;

    let newLeft = origLeft+dx;
    let newTop = origTop+dy;

    // Применяем границы при перемещении
    const clampedPos = clampToBoundaries(newLeft, newTop);
    newLeft = clampedPos.x;
    newTop = clampedPos.y;

    elem.style.left=newLeft+'px';
    elem.style.top=newTop+'px';
    renderConnections();
  });

  document.addEventListener('mouseup', ()=>{
    if(!dragging) return;
    dragging=false;
    elem.style.zIndex='';

    const finalLeft = parseFloat(elem.style.left)||0;
    const finalTop = parseFloat(elem.style.top)||0;

    registerPosition(elem.dataset.id, finalLeft, finalTop);
    saveState();
    renderConnections();
  });
}

function setupNodeButtons(node){
  const addBtn = node.querySelector('[data-add]');
  const nextFrameBtn = node.querySelector('[data-next-frame]');
  const removeBtn = node.querySelector('.remove-btn');

  if(addBtn) addBtn.addEventListener('click', e=>{
    e.stopPropagation();
    const rect = node.getBoundingClientRect();
    const canvasRect = canvasContent.getBoundingClientRect();

    let newX = rect.left - canvasRect.left + 400;
    let newY = rect.top - canvasRect.top;

    // Корректируем позицию, чтобы не выходить за границы
    const clampedX = Math.min(newX, BOUNDARIES.maxX - LAYOUT_CONFIG.NODE_WIDTH);

    createNode(clampedX, newY, 'Новый кадр', node.dataset.id, 'frame');
  });

  if(nextFrameBtn) nextFrameBtn.addEventListener('click', e=>{
    e.stopPropagation();
    generateNextFrame(node);
  });

  if(removeBtn) removeBtn.addEventListener('click', e=>{
    e.stopPropagation();
    removeNode(node.dataset.id);
  });
}

function removeNode(id){
  const node = byId(id);
  if(!node) return;
  const childEdges = edges.filter(e => e.from === id);
  childEdges.forEach(e => removeNode(e.to));
  edges = edges.filter(e => e.from !== id && e.to !== id);
  unregisterPosition(id);
  node.remove();
  updateAIPreview();
  renderConnections();
  saveState();
}

function addEdge(fromId, toId){
  edges.push({from: fromId, to: toId});
  renderConnections();
}

// ========== ОТРИСОВКА СОЕДИНЕНИЙ ==========
function renderConnections(){
  const svg = connectorsSvg;
  svg.innerHTML = '';
  edges.forEach(e => {
    const fromNode = byId(e.from);
    const toNode = byId(e.to);
    if(!fromNode || !toNode) return;

    const fromX = parseFloat(fromNode.style.left) + fromNode.offsetWidth / 2;
    const fromY = parseFloat(fromNode.style.top) + fromNode.offsetHeight;
    const toX = parseFloat(toNode.style.left) + toNode.offsetWidth / 2;
    const toY = parseFloat(toNode.style.top);

    const midY = (fromY + toY) / 2;
    const controlOffset = Math.min(Math.abs(toX - fromX) * 0.3, 55);

    const pathData = `M ${fromX} ${fromY}
                     C ${fromX} ${fromY + controlOffset},
                       ${toX} ${toY - controlOffset},
                       ${toX} ${toY}`;

    // Глоу эффект
    const glow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    glow.setAttribute('d', pathData);
    glow.setAttribute('stroke', 'rgba(0,217,255,0.15)');
    glow.setAttribute('stroke-width', '8');
    glow.setAttribute('fill', 'none');
    glow.setAttribute('stroke-linecap', 'round');
    glow.style.filter = 'blur(8px)';
    svg.appendChild(glow);

    // Основная линия
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', 'var(--neon)');
    path.setAttribute('stroke-width', '3');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.style.filter = 'drop-shadow(0 0 6px rgba(0,217,255,0.3))';
    svg.appendChild(path);

    // Стрелка
    const arrowSize = 8;
    const angle = Math.atan2(toY - (fromY + controlOffset), toX - fromX);

    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const points = `
      ${toX},${toY}
      ${toX - arrowSize * Math.cos(angle - Math.PI/6)},${toY - arrowSize * Math.sin(angle - Math.PI/6)}
      ${toX - arrowSize * Math.cos(angle + Math.PI/6)},${toY - arrowSize * Math.sin(angle + Math.PI/6)}
    `;
    arrow.setAttribute('points', points);
    arrow.setAttribute('fill', 'var(--neon)');
    arrow.style.filter = 'drop-shadow(0 0 4px rgba(0,217,255,0.5))';
    svg.appendChild(arrow);
  });
}

// ========== AI ФУНКЦИИ ==========
function collectTreeText(){
  const root = byId('root');
  const title = root ? root.querySelector('.title').innerText.trim() : '';
  const outcomes = Array.from(document.querySelectorAll('.node[data-type="frame"]'))
                    .map(n => n.querySelector('.title').innerText.trim())
                    .filter(Boolean);
  return { title, outcomes };
}

function updateAIPreview(){
  const {title,outcomes} = collectTreeText();
  document.getElementById('ai-title').innerText = title || '—';
  document.getElementById('ai-outcomes').innerText = outcomes.length ? ('• ' + outcomes.join('\n• ')) : '—';
}

function flowNextFrameFromResponse(data) {
  if (!data) return parseNextFrameResponse('');
  const hasStructured = data.next_frame != null || Array.isArray(data.visual_elements) ||
    Array.isArray(data.emotional_impact);
  if (!hasStructured) return parseNextFrameResponse(data.result || '');
  return {
    nextFrame: data.next_frame || '',
    visualElements: data.visual_elements || [],
    emotionalImpact: data.emotional_impact || [],
    composition: data.composition || [],
    soundRhythm: data.sound_rhythm || [],
    transition: data.transition || '',
  };
}

function flowAnalysisFromResponse(data) {
  if (!data) return parseFrameAnalysisResponse('');
  const hasStructured = data.best_frame != null || Array.isArray(data.composition) ||
    Array.isArray(data.strengths);
  if (!hasStructured) return parseFrameAnalysisResponse(data.result || '');
  return {
    bestFrame: data.best_frame || '',
    explanation: data.explanation || '',
    composition: data.composition || [],
    atmosphere: data.atmosphere || [],
    dramaturgy: data.dramaturgy || [],
    strengths: data.strengths || [],
    improvements: data.improvements || [],
    nextSteps: data.next_steps || [],
    score: data.score || '',
    verdict: data.verdict || '',
  };
}

function parseNextFrameResponse(text){
  if(!text) return { nextFrame: '', visualElements: [], emotionalImpact: [], composition: [], soundRhythm: [], transition: '' };

  const m = (re) => {
    const x = text.match(re);
    return x ? x[1].trim() : '';
  };
  const list = (s) => s ? s.split(/[;\n]/).map(x => x.replace(/^[\-\*\•]\s*/, '').trim()).filter(Boolean) : [];

  return {
    nextFrame: m(/СЛЕДУЮЩИЙ КАДР:\s*([^\n]+)/i),
    visualElements: list(m(/ВИЗУАЛЬНЫЕ ЭЛЕМЕНТЫ:\s*([^\n]+)/i)),
    emotionalImpact: list(m(/ЭМОЦИОНАЛЬНОЕ ВОЗДЕЙСТВИЕ:\s*([^\n]+)/i)),
    composition: list(m(/КОМПОЗИЦИЯ:\s*([^\n]+)/i)),
    soundRhythm: list(m(/ЗВУК\s+И\s+РИТМ:\s*([^\n]+)/i)),
    transition: m(/ПЕРЕХОД:\s*([^\n]+)/i),
  };
}

function parseFrameAnalysisResponse(text){
  const empty = {
    bestFrame: '', explanation: '',
    composition: [], atmosphere: [], dramaturgy: [],
    strengths: [], improvements: [], nextSteps: [],
    score: '', verdict: '',
  };
  if(!text) return empty;

  const m = (re) => {
    const x = text.match(re);
    return x ? x[1].trim() : '';
  };
  // Многострочный матч для развёрнутых полей (обоснование, вердикт) — берём всё до следующего заголовка.
  const block = (label) => {
    const re = new RegExp(label + '[\\s\\S]*?:\\s*([\\s\\S]*?)(?=\\n\\s*(?:КОМПОЗИЦИЯ|АТМОСФЕРА|ДРАМАТУРГИЯ|СИЛЬНЫЕ\\s+СТОРОНЫ|ВОЗМОЖНЫЕ\\s+УЛУЧШЕНИЯ|СЛЕДУЮЩИЙ\\s+ШАГ|ОЦЕНКА|ВЕРДИКТ|ПОЧЕМУ\\s+ЭТОТ\\s+КАДР|ЛУЧШИЙ\\s+КАДР)\\s*:|$)', 'i');
    const x = text.match(re);
    return x ? x[1].trim().replace(/\s+/g, ' ') : '';
  };
  const list = (s) => s ? s.split(/[;\n]/).map(x => x.replace(/^[\-\*\•]\s*/, '').trim()).filter(Boolean) : [];

  return {
    bestFrame: m(/ЛУЧШИЙ КАДР:\s*([^\n]+)/i),
    explanation: block('ПОЧЕМУ\\s+ЭТОТ\\s+КАДР') || m(/ПОЧЕМУ ЭТОТ КАДР:\s*([^\n]+)/i),
    composition: list(m(/КОМПОЗИЦИЯ:\s*([^\n]+)/i)),
    atmosphere: list(m(/АТМОСФЕРА:\s*([^\n]+)/i)),
    dramaturgy: list(m(/ДРАМАТУРГИЯ:\s*([^\n]+)/i)),
    strengths: list(m(/СИЛЬНЫЕ СТОРОНЫ:\s*([^\n]+)/i)),
    improvements: list(m(/ВОЗМОЖНЫЕ УЛУЧШЕНИЯ:\s*([^\n]+)/i)),
    nextSteps: list(m(/СЛЕДУЮЩИЙ ШАГ:\s*([^\n]+)/i)),
    score: m(/ОЦЕНКА:\s*([^\n]+)/i),
    verdict: block('ВЕРДИКТ') || m(/ВЕРДИКТ:\s*([^\n]+)/i),
  };
}

// Маленький помощник: секция с цветным заголовком и списком пунктов.
function renderListSection(title, color, items){
  if(!items || !items.length) return '';
  return `
    <div style="margin-top: 8px;">
      <div style="color: ${color}; font-weight: 600; font-size: 12px;">${title}</div>
      <ul style="color: var(--text-muted); font-size: 12px; margin: 4px 0; padding-left: 16px;">
        ${items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderTextSection(title, color, text){
  if(!text) return '';
  return `
    <div style="margin-top: 8px;">
      <div style="color: ${color}; font-weight: 600; font-size: 12px;">${title}</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(text)}</div>
    </div>
  `;
}

// ========== ГЕНЕРАЦИЯ СЛЕДУЮЩЕГО КАДРА ==========
async function generateNextFrame(parentNode){
  if(isLockedUntil > Date.now()) return;

  const { title } = collectTreeText();
  const currentFrame = parentNode.querySelector('.title').innerText.trim();
  const outBox = document.getElementById('ai-output');

  if(!title){
    outBox.innerText = 'Пожалуйста, опишите тему сцены в начальном кадре.';
    return;
  }

  if(!currentFrame){
    outBox.innerText = 'Кадр не может быть пустым.';
    return;
  }

  outBox.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'ai-response';
  loading.innerHTML = `<div class="meta"><b>Генерируем следующий кадр...</b></div>`;
  outBox.appendChild(loading);
  outBox.scrollTop = outBox.scrollHeight;

  aiNextFrameBtn.disabled = true;
  aiNextFrameBtn.style.opacity = '0.6';

  try {
    const response = await fetch('/run-ai-flow-next-frame', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ title, current_frame: currentFrame })
    });

    if(!response.ok) throw new Error('HTTP ' + response.status);

    const data = await response.json();
    const result = data.result || '';

    if(outBox.lastElementChild === loading) outBox.removeChild(loading);

    const { nextFrame, visualElements, emotionalImpact, composition, soundRhythm, transition } = flowNextFrameFromResponse(data);

    if(nextFrame) {
      const rect = parentNode.getBoundingClientRect();
      const canvasRect = canvasContent.getBoundingClientRect();

      let newX = rect.left - canvasRect.left + 220;
      let newY = rect.top - canvasRect.top;

      // Корректируем позицию, чтобы не выходить за границы
      newX = Math.min(newX, BOUNDARIES.maxX - LAYOUT_CONFIG.NODE_WIDTH);
      newY = Math.min(newY, BOUNDARIES.maxY - LAYOUT_CONFIG.NODE_HEIGHT);

      createNode(newX, newY, nextFrame, parentNode.dataset.id, 'frame');

      // Показываем анализ в панели
      const analysisHTML = `
        <div class="ai-response result-highlight">
          <div class="meta"><b>Сгенерирован следующий кадр:</b> ${escapeHtml(nextFrame)}</div>
          ${renderListSection('🎬 Визуальные элементы:', 'var(--visual-color)', visualElements)}
          ${renderListSection('💫 Эмоциональное воздействие:', 'var(--emotional-color)', emotionalImpact)}
          ${renderListSection('🎞️ Композиция:', 'var(--frame-color)', composition)}
          ${renderListSection('🎵 Звук и ритм:', 'var(--accent)', soundRhythm)}
          ${renderTextSection('🔗 Переход от предыдущего кадра:', 'var(--accent)', transition)}
        </div>
      `;

      outBox.innerHTML = analysisHTML;
    } else {
      outBox.innerHTML = `<div class="ai-response">Не удалось сгенерировать следующий кадр. Попробуйте еще раз.</div>`;
    }

    setLock(30);
  } catch(error) {
    console.error('AI request failed:', error);
    if(outBox.lastElementChild === loading) {
      loading.innerHTML = `<div class="meta"><b>Ошибка при генерации кадра.</b></div>`;
    } else {
      outBox.innerHTML = `<div class="ai-response">Ошибка при генерации кадра. Попробуйте позже.</div>`;
    }
  }

  aiNextFrameBtn.disabled = false;
  aiNextFrameBtn.style.opacity = '';
}

// ========== АНАЛИЗ КАДРОВ ==========
function showFrameAnalysisModal(){
  const frames = Array.from(document.querySelectorAll('.node[data-type="frame"]'));

  if(frames.length < 2) {
    document.getElementById('ai-output').innerHTML = '<div class="ai-response">Для анализа нужно как минимум 2 кадра.</div>';
    return;
  }

  frameList.innerHTML = '';
  selectedFramesForAnalysis.clear();

  frames.forEach((frame, index) => {
    const frameText = frame.querySelector('.title').innerText.trim();
    const frameItem = document.createElement('div');
    frameItem.className = 'frame-item';
    frameItem.innerHTML = `
      <div style="font-weight: 600; font-size: 12px;">Кадр ${index + 1}</div>
      <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${frameText}</div>
    `;

    frameItem.addEventListener('click', () => {
      frameItem.classList.toggle('selected');
      if(frameItem.classList.contains('selected')) {
        selectedFramesForAnalysis.add(frameText);
      } else {
        selectedFramesForAnalysis.delete(frameText);
      }
    });

    frameList.appendChild(frameItem);
  });

  frameAnalysisModal.classList.add('active');
}

async function analyzeSelectedFrames(){
  if(selectedFramesForAnalysis.size < 2) {
    (window.Viora ? window.Viora.Toast.show("Выберите минимум 2 кадра для анализа", "warning") : alert("Выберите минимум 2 кадра для анализа"));
    return;
  }

  const { title } = collectTreeText();
  const frames = Array.from(selectedFramesForAnalysis);
  const outBox = document.getElementById('ai-output');

  outBox.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'ai-response';
  loading.innerHTML = `<div class="meta"><b>Анализируем выбранные кадры...</b></div>`;
  outBox.appendChild(loading);

  aiAnalyzeFramesBtn.disabled = true;
  aiAnalyzeFramesBtn.style.opacity = '0.6';
  frameAnalysisModal.classList.remove('active');

  try {
    const response = await fetch('/run-ai-flow-analyze-frames', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ title, frames })
    });

    if(!response.ok) throw new Error('HTTP ' + response.status);

    const data = await response.json();
    const result = data.result || '';

    if(outBox.lastElementChild === loading) outBox.removeChild(loading);

    const { bestFrame, explanation, composition, atmosphere, dramaturgy, strengths, improvements, nextSteps, score, verdict } = flowAnalysisFromResponse(data);

    const analysisHTML = `
      <div class="ai-response result-highlight">
        <div class="meta"><b>Анализ кадров:</b></div>
        ${renderTextSection('🏆 Лучший кадр:', 'var(--frame-color)', bestFrame)}
        ${renderTextSection('📝 Обоснование:', 'var(--accent)', explanation)}
        ${renderListSection('🎞️ Композиция и приёмы:', 'var(--visual-color)', composition)}
        ${renderListSection('🌫️ Атмосфера:', 'var(--emotional-color)', atmosphere)}
        ${renderListSection('🎭 Драматургия:', 'var(--frame-color)', dramaturgy)}
        ${renderListSection('✅ Сильные стороны:', 'var(--pro-color)', strengths)}
        ${renderListSection('💡 Возможные улучшения:', 'var(--con-color)', improvements)}
        ${renderListSection('➡️ Следующий шаг:', 'var(--accent)', nextSteps)}
        ${renderTextSection('⭐ Оценка:', 'var(--frame-color)', score)}
        ${renderTextSection('🎬 Вердикт:', 'var(--accent)', verdict)}
      </div>
    `;

    outBox.innerHTML = analysisHTML;
    setLock(30);
  } catch(error) {
    console.error('Analysis request failed:', error);
    if(outBox.lastElementChild === loading) {
      loading.innerHTML = `<div class="meta"><b>Ошибка при анализе кадров.</b></div>`;
    } else {
      outBox.innerHTML = `<div class="ai-response">Ошибка при анализе кадров. Попробуйте позже.</div>`;
    }
  }

  aiAnalyzeFramesBtn.disabled = false;
  aiAnalyzeFramesBtn.style.opacity = '';
}

// ========== СБРОС КАДРОВ ==========
function resetAllFrames() {
  const frameIds = Array.from(document.querySelectorAll('.node[data-id]'))
    .filter(n => n.dataset.id !== 'root')
    .map(n => n.dataset.id);

  const outBox = document.getElementById('ai-output');
  const defaultAiText = 'Используйте кнопки для добавления кадров или анализа сцены.';
  const hasAiOutput = outBox && outBox.textContent.trim() && outBox.textContent.trim() !== defaultAiText;

  if (frameIds.length === 0 && !hasAiOutput) {
    if (window.Viora && window.Viora.Toast) {
      window.Viora.Toast.show('Нечего сбрасывать', 'info');
    }
    return;
  }

  const confirmed = window.confirm(
    'Удалить все кадры, кроме начального? Текст начального кадра и положение на холсте сохранятся.'
  );
  if (!confirmed) return;

  frameIds.forEach(id => {
    if (byId(id)) removeNode(id);
  });

  edges = edges.filter(e => e.from === 'root' || e.to === 'root');
  selectedFramesForAnalysis.clear();
  if (frameAnalysisModal) frameAnalysisModal.classList.remove('active');

  if (outBox) outBox.innerHTML = defaultAiText;

  isLockedUntil = 0;
  updateTimerUI();
  updateAIPreview();
  renderConnections();
  saveState();

  if (window.Viora && window.Viora.Toast) {
    window.Viora.Toast.show('Кадры сброшены', 'success');
  }
}

// ========== ОБРАБОТЧИКИ КНОПОК ==========
if (aiResetFramesBtn) {
  aiResetFramesBtn.addEventListener('click', resetAllFrames);
}

aiNextFrameBtn.addEventListener('click', () => {
  const frames = Array.from(document.querySelectorAll('.node[data-type="frame"]'));
  const lastFrame = frames[frames.length - 1];
  if(lastFrame) {
    generateNextFrame(lastFrame);
  }
});

aiAnalyzeFramesBtn.addEventListener('click', showFrameAnalysisModal);

modalAnalyze.addEventListener('click', analyzeSelectedFrames);
modalCancel.addEventListener('click', () => {
  frameAnalysisModal.classList.remove('active');
});

// Сброс выбора кадров в модалке
const modalReset = document.getElementById('modalReset');
if (modalReset) {
  modalReset.addEventListener('click', () => {
    const boxes = frameList.querySelectorAll('input[type="checkbox"]');
    let unchecked = 0;
    boxes.forEach(cb => { if (cb.checked) { cb.checked = false; unchecked++; } });
    if (window.Viora && window.Viora.Toast) {
      window.Viora.Toast.show(unchecked ? `Снято галочек: ${unchecked}` : 'Нечего сбрасывать', unchecked ? 'success' : 'info', 1500);
    }
  });
}

// ========== ПАНЕЛЬ УПРАВЛЕНИЯ ==========
// Сворачивание панели в полоску шапки (как на /life)
const panelCollapseBtn = document.getElementById('panelCollapseBtn');
if (panelCollapseBtn) {
  panelCollapseBtn.addEventListener('click', () => {
    const isCollapsing = sidePanel.dataset.collapsed !== '1';
    if (isCollapsing) {
      sidePanel.dataset.prevWidth = sidePanel.style.width || '';
      sidePanel.dataset.prevHeight = sidePanel.style.height || '';
      sidePanel.style.width = '';
      sidePanel.style.height = '';
      sidePanel.classList.add('collapsed');
      sidePanel.dataset.collapsed = '1';
      panelCollapseBtn.textContent = '⤢';
      panelCollapseBtn.setAttribute('aria-expanded', 'false');
      panelCollapseBtn.setAttribute('title', 'Развернуть');
    } else {
      sidePanel.classList.remove('collapsed');
      sidePanel.dataset.collapsed = '0';
      if (sidePanel.dataset.prevWidth) sidePanel.style.width = sidePanel.dataset.prevWidth;
      if (sidePanel.dataset.prevHeight) sidePanel.style.height = sidePanel.dataset.prevHeight;
      panelCollapseBtn.textContent = '↔';
      panelCollapseBtn.setAttribute('aria-expanded', 'true');
      panelCollapseBtn.setAttribute('title', 'Свернуть');
    }
    if (typeof saveState === 'function') saveState();
  });
}

// ========== ИЗМЕНЕНИЕ ВЫСОТЫ ПАНЕЛИ ==========
const panelBottomHandle = document.getElementById('panelBottomHandle');
let panelResizing = false;
let panelStartHeight = 0;
let panelResizeStartY = 0;

if (panelBottomHandle) {
  panelBottomHandle.addEventListener('mousedown', e => {
    panelResizing = true;
    panelResizeStartY = e.clientY;
    panelStartHeight = sidePanel.offsetHeight;
    sidePanel.style.maxHeight = 'none';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
}

// ========== ПЕРЕТАСКИВАНИЕ ПАНЕЛИ (мышь + touch) ==========
let panelDragging = false;
let panelStartX = 0;
let panelStartY = 0;
let panelStartLeft = 0;
let panelStartTop = 0;

function clampPanelPosition(left, top) {
  const editor = document.getElementById('editorPage');
  const editorRect = editor ? editor.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
  const w = sidePanel.offsetWidth || 320;
  const h = sidePanel.offsetHeight || 200;
  const tail = 60; // минимум, который должен оставаться видимым
  const minLeft = -(w - tail);
  const maxLeft = editorRect.width - tail;
  const minTop = 0;
  const maxTop = Math.max(0, editorRect.height - tail);
  return {
    left: Math.min(Math.max(left, minLeft), maxLeft),
    top: Math.min(Math.max(top, minTop), maxTop),
  };
}

function panelDragStart(clientX, clientY, target) {
  if (target && target.closest('button')) return false;
  panelDragging = true;
  panelStartX = clientX;
  panelStartY = clientY;
  const rect = sidePanel.getBoundingClientRect();
  // Если ещё не было ручного позиционирования — берём текущие координаты из getBoundingClientRect
  // относительно editor-page, чтобы переход с right: 10px на left: ... px был бесшовным.
  const editor = document.getElementById('editorPage');
  const editorRect = editor ? editor.getBoundingClientRect() : { left: 0, top: 0 };
  panelStartLeft = parseFloat(sidePanel.style.left);
  panelStartTop = parseFloat(sidePanel.style.top);
  if (Number.isNaN(panelStartLeft)) panelStartLeft = rect.left - editorRect.left;
  if (Number.isNaN(panelStartTop)) panelStartTop = rect.top - editorRect.top;
  // Переключаем якорь с правого на левый, чтобы перетаскивание работало корректно
  sidePanel.style.right = 'auto';
  sidePanel.style.left = panelStartLeft + 'px';
  sidePanel.style.top = panelStartTop + 'px';
  document.body.style.userSelect = 'none';
  return true;
}

function panelDragMove(clientX, clientY) {
  if (!panelDragging) return;
  const dx = clientX - panelStartX;
  const dy = clientY - panelStartY;
  const { left, top } = clampPanelPosition(panelStartLeft + dx, panelStartTop + dy);
  sidePanel.style.left = left + 'px';
  sidePanel.style.top = top + 'px';
}

function panelDragEnd() {
  if (!panelDragging) return;
  panelDragging = false;
  document.body.style.userSelect = '';
  if (typeof saveState === 'function') saveState();
}

if (sideHeader) {
  sideHeader.addEventListener('mousedown', e => {
    if (!panelDragStart(e.clientX, e.clientY, e.target)) return;
    e.preventDefault();
  });

  sideHeader.addEventListener('touchstart', e => {
    const t = e.touches[0];
    if (!t) return;
    if (!panelDragStart(t.clientX, t.clientY, e.target)) return;
    e.preventDefault();
  }, { passive: false });
}

document.addEventListener('mousemove', e => {
  if (panelResizing) {
    const dy = e.clientY - panelResizeStartY;
    const maxH = window.innerHeight - 20;
    sidePanel.style.height = Math.max(220, Math.min(maxH, panelStartHeight + dy)) + 'px';
  }
  if (panelDragging) panelDragMove(e.clientX, e.clientY);
});

document.addEventListener('touchmove', e => {
  if (!panelDragging) return;
  const t = e.touches[0];
  if (!t) return;
  panelDragMove(t.clientX, t.clientY);
  e.preventDefault();
}, { passive: false });

document.addEventListener('mouseup', () => {
  if (panelResizing) {
    panelResizing = false;
    document.body.style.userSelect = '';
    if (typeof saveState === 'function') saveState();
  }
  panelDragEnd();
});
document.addEventListener('touchend', panelDragEnd);
document.addEventListener('touchcancel', panelDragEnd);

// При ресайзе окна — подтянуть панель обратно в видимую область, если она была вручную позиционирована.
window.addEventListener('resize', () => {
  if (!sidePanel.style.left) return;
  const left = parseFloat(sidePanel.style.left) || 0;
  const top = parseFloat(sidePanel.style.top) || 0;
  const clamped = clampPanelPosition(left, top);
  sidePanel.style.left = clamped.left + 'px';
  sidePanel.style.top = clamped.top + 'px';
});

panelCloseBtn.addEventListener('click', () => {
  sidePanel.style.display = 'none';
  openPanelBtn.classList.add('visible');
  saveState();
});

openPanelBtn.addEventListener('click', () => {
  sidePanel.style.display = 'flex';
  openPanelBtn.classList.remove('visible');
  saveState();
});

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function escapeHtml(s){
  if(!s && s!==0) return '';
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========
function init(){
  loadState();
  updateTimerUI();
  updateAIPreview();

  const root = byId('root');
  if(root){
    makeDraggable(root);
    setupNodeButtons(root);
    const t = root.querySelector('.title');
    if(t) t.addEventListener('input', ()=>{ updateAIPreview(); saveState(); });
  }

  // Double-click on canvas to create new frame
  canvasContent.addEventListener('dblclick', e => {
    const target = e.target;
    if(target.closest('.node') || target.closest('.add-btn') || target.closest('.remove-btn')) return;

    const rect = canvasContent.getBoundingClientRect();
    const x = e.clientX - rect.left - LAYOUT_CONFIG.NODE_WIDTH / 2;
    const y = e.clientY - rect.top - LAYOUT_CONFIG.NODE_HEIGHT / 2;

    createNode(x, y, 'Новый кадр');
  });

  // Auto-save on title edits
  document.addEventListener('input', e => {
    if(e.target.classList.contains('title')){
      updateAIPreview();
      saveState();
    }
  });

  // Periodically save state
  setInterval(saveState, 30000);
}

init();