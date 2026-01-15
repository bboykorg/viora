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
  COLUMN_SPACING: 400,
  ROW_SPACING: 150,
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
let occupiedPositions = new Map();

function resetOccupiedPositions() {
  occupiedPositions = new Map();
}

function registerPosition(nodeId, x, y) {
  const gridX = Math.floor(x / 30);
  const gridY = Math.floor(y / 30);
  const key = `${gridX}_${gridY}`;
  occupiedPositions.set(key, { nodeId, x, y });
}

function isPositionFree(x, y, width = LAYOUT_CONFIG.NODE_WIDTH, height = LAYOUT_CONFIG.NODE_HEIGHT) {
  // Проверяем границы с учетом размера блока
  if (x < BOUNDARIES.minX || y < BOUNDARIES.minY) {
    return false;
  }
  if (x + width > BOUNDARIES.maxX || y + height > BOUNDARIES.maxY) {
    return false;
  }

  const startGridX = Math.floor(x / 30);
  const startGridY = Math.floor(y / 30);
  const endGridX = Math.floor((x + width) / 30);
  const endGridY = Math.floor((y + height) / 30);

  for (let gridX = startGridX; gridX <= endGridX; gridX++) {
    for (let gridY = startGridY; gridY <= endGridY; gridY++) {
      const key = `${gridX}_${gridY}`;
      if (occupiedPositions.has(key)) return false;
    }
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

function findFreePosition(nearX, nearY) {
  // Если координаты не указаны, используем центр видимой области
  let targetX = nearX;
  let targetY = nearY;

  if ((!targetX && targetX !== 0) || (!targetY && targetY !== 0)) {
    const viewportCenter = getViewportCenter();
    targetX = viewportCenter.x;
    targetY = viewportCenter.y;
  }

  // Сначала проверяем указанную позицию
  if (isPositionFree(targetX, targetY)) {
    const clampedPos = clampToBoundaries(targetX, targetY);
    return { x: clampedPos.x, y: clampedPos.y };
  }

  // Ищем свободное место по спирали от указанной точки
  for (let radius = 1; radius <= 15; radius++) {
    const points = 8;
    for (let i = 0; i < points; i++) {
      const angle = (i * 360) / points;
      const rad = angle * Math.PI / 180;
      const x = targetX + Math.cos(rad) * radius * 120;
      const y = targetY + Math.sin(rad) * radius * 100;

      if (isPositionFree(x, y)) {
        const clampedPos = clampToBoundaries(x, y);
        return { x: clampedPos.x, y: clampedPos.y };
      }
    }
  }

  // Если не нашли, возвращаем позицию в пределах границ
  const clampedPos = clampToBoundaries(targetX, targetY);
  return { x: clampedPos.x, y: clampedPos.y };
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
    hidden: sidePanel.style.display === 'none'
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
          const editorRect = document.getElementById('editorPage').getBoundingClientRect();
          sidePanel.style.left = (s.panelState.left || 0) + 'px';
          sidePanel.style.top = (s.panelState.top || 0) + 'px';
          sidePanel.style.right = 'auto';
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
    const controlOffset = Math.min(Math.abs(toX - fromX) * 0.5, 150);

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

function parseNextFrameResponse(text){
  if(!text) return { nextFrame: '', visualElements: [], emotionalImpact: [] };

  const nextFrameMatch = text.match(/СЛЕДУЮЩИЙ КАДР:\s*([^\n]+)/i);
  const visualMatch = text.match(/ВИЗУАЛЬНЫЕ ЭЛЕМЕНТЫ:\s*([^\n]+)/i);
  const emotionalMatch = text.match(/ЭМОЦИОНАЛЬНОЕ ВОЗДЕЙСТВИЕ:\s*([^\n]+)/i);

  const nextFrame = nextFrameMatch ? nextFrameMatch[1].trim() : '';
  const visualElements = visualMatch ? visualMatch[1].split(';').map(item => item.trim()).filter(Boolean) : [];
  const emotionalImpact = emotionalMatch ? emotionalMatch[1].split(';').map(item => item.trim()).filter(Boolean) : [];

  return { nextFrame, visualElements, emotionalImpact };
}

function parseFrameAnalysisResponse(text){
  if(!text) return { bestFrame: '', explanation: '', strengths: [], improvements: [] };

  const bestFrameMatch = text.match(/ЛУЧШИЙ КАДР:\s*([^\n]+)/i);
  const explanationMatch = text.match(/ПОЧЕМУ ЭТОТ КАДР:\s*([^\n]+)/i);
  const strengthsMatch = text.match(/СИЛЬНЫЕ СТОРОНЫ:\s*([^\n]+)/i);
  const improvementsMatch = text.match(/ВОЗМОЖНЫЕ УЛУЧШЕНИЯ:\s*([^\n]+)/i);

  const bestFrame = bestFrameMatch ? bestFrameMatch[1].trim() : '';
  const explanation = explanationMatch ? explanationMatch[1].trim() : '';
  const strengths = strengthsMatch ? strengthsMatch[1].split(';').map(item => item.trim()).filter(Boolean) : [];
  const improvements = improvementsMatch ? improvementsMatch[1].split(';').map(item => item.trim()).filter(Boolean) : [];

  return { bestFrame, explanation, strengths, improvements };
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

    const { nextFrame, visualElements, emotionalImpact } = parseNextFrameResponse(result);

    if(nextFrame) {
      const rect = parentNode.getBoundingClientRect();
      const canvasRect = canvasContent.getBoundingClientRect();

      let newX = rect.left - canvasRect.left + 400;
      let newY = rect.top - canvasRect.top;

      // Корректируем позицию, чтобы не выходить за границы
      newX = Math.min(newX, BOUNDARIES.maxX - LAYOUT_CONFIG.NODE_WIDTH);
      newY = Math.min(newY, BOUNDARIES.maxY - LAYOUT_CONFIG.NODE_HEIGHT);

      createNode(newX, newY, nextFrame, parentNode.dataset.id, 'frame');

      // Показываем анализ в панели
      const analysisHTML = `
        <div class="ai-response result-highlight">
          <div class="meta"><b>Сгенерирован следующий кадр:</b> ${nextFrame}</div>
          ${visualElements.length > 0 ? `
            <div style="margin-top: 8px;">
              <div style="color: var(--visual-color); font-weight: 600; font-size: 12px;">🎬 Визуальные элементы:</div>
              <ul class="visual-list">
                ${visualElements.map(el => `<li>${escapeHtml(el)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${emotionalImpact.length > 0 ? `
            <div style="margin-top: 8px;">
              <div style="color: var(--emotional-color); font-weight: 600; font-size: 12px;">💫 Эмоциональное воздействие:</div>
              <ul class="emotional-list">
                ${emotionalImpact.map(em => `<li>${escapeHtml(em)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
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
    alert('Выберите как минимум 2 кадра для анализа');
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

    const { bestFrame, explanation, strengths, improvements } = parseFrameAnalysisResponse(result);

    const analysisHTML = `
      <div class="ai-response result-highlight">
        <div class="meta"><b>Анализ кадров:</b></div>
        ${bestFrame ? `
          <div style="margin-top: 8px;">
            <div style="color: var(--frame-color); font-weight: 600; font-size: 12px;">🏆 Лучший кадр:</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${bestFrame}</div>
          </div>
        ` : ''}
        ${explanation ? `
          <div style="margin-top: 8px;">
            <div style="color: var(--accent); font-weight: 600; font-size: 12px;">📝 Обоснование:</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${explanation}</div>
          </div>
        ` : ''}
        ${strengths.length > 0 ? `
          <div style="margin-top: 8px;">
            <div style="color: var(--pro-color); font-weight: 600; font-size: 12px;">✅ Сильные стороны:</div>
            <ul style="color: var(--text-muted); font-size: 12px; margin: 4px 0; padding-left: 16px;">
              ${strengths.map(st => `<li>${escapeHtml(st)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${improvements.length > 0 ? `
          <div style="margin-top: 8px;">
            <div style="color: var(--con-color); font-weight: 600; font-size: 12px;">💡 Возможные улучшения:</div>
            <ul style="color: var(--text-muted); font-size: 12px; margin: 4px 0; padding-left: 16px;">
              ${improvements.map(im => `<li>${escapeHtml(im)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
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

// ========== ОБРАБОТЧИКИ КНОПОК ==========
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

// ========== ПАНЕЛЬ УПРАВЛЕНИЯ ==========
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