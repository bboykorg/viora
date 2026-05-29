// КОНФИГУРАЦИЯ
const STORAGE_KEY = 'viora_state';
const canvas = document.getElementById('canvasArea');
const canvasContainer = document.getElementById('canvasContainer');
const canvasTransform = document.getElementById('canvasTransform');
const canvasContent = document.getElementById('canvasContent');
const connectorsSvg = document.getElementById('connectors');
const sidePanel = document.getElementById('sidePanel');
const panelHandle = document.getElementById('panelHandle');
const panelBottomHandle = document.getElementById('panelBottomHandle');
const sideHeader = document.getElementById('sideHeader');
const panelCollapseBtn = document.getElementById('panelCollapseBtn');
const panelCloseBtn = document.getElementById('panelCloseBtn');
const openPanelBtn = document.getElementById('openPanelBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalText = document.getElementById('modalText');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

// ЭЛЕМЕНТЫ МАСШТАБА
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const resetZoomBtn = document.getElementById('resetZoom');
const centerRootBtn = document.getElementById('centerRoot');
const zoomLevelDisplay = document.getElementById('zoomLevel');

let edges = [];
let nodeCounter = 1;
const MAX_RETRIES = 4;
let isLockedUntil = 0;
let timerInterval = null;
let _saveTimeout = null;
let modalResolve = null;

// ПЕРЕМЕННЫЕ ДЛЯ МАСШТАБИРОВАНИЯ И ПАННОРАМИРОВАНИЯ
let scale = 1;
let translateX = 0;
let translateY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let startTranslate = { x: 0, y: 0 };

// КОНФИГУРАЦИЯ МАСШТАБА
const ZOOM_CONFIG = {
    min: 0.1,
    max: 3.0,
    step: 0.1,
    default: 1.0
};

// КОНФИГУРАЦИЯ РАСПОЛОЖЕНИЯ И ГРАНИЦ
const LAYOUT_CONFIG = {
    NODE_WIDTH: 280,
    NODE_HEIGHT: 80,
    COLUMN_SPACING: 220,
    ROW_SPACING: 90,
    /** Расстояние от центра исхода до центра колонки «плюсы» / «минусы» */
    HORIZONTAL_OFFSET: 300,
    /** Зазор между соседними деревьями решений */
    OUTCOME_GAP: 48,
    /** Доп. поля внутри «слота» одного исхода */
    OUTCOME_TREE_PADDING: 40,
    PRO_CON_SPACING: 50,
    PRO_CON_ITEM_HEIGHT: 60,
    PRO_CON_VERTICAL_SPACING: 14,
    MIN_DISTANCE_FROM_PARENT: 22,
    CANVAS_WIDTH: 5000,
    CANVAS_HEIGHT: 5000
};

// Границы перемещения блоков
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
    if (!root) return;

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
centerRootBtn.addEventListener('click', centerOnRoot);

// МАСШТАБИРОВАНИЕ КОЛЕСОМ МЫШИ
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

// ========== МОДАЛЬНОЕ ОКНО ==========
function showModal(title, text) {
    return new Promise((resolve) => {
        modalTitle.textContent = title;
        modalText.textContent = text;
        modalOverlay.classList.add('active');
        modalResolve = resolve;
    });
}

modalCancel.addEventListener('click', () => {
    modalOverlay.classList.remove('active');
    if (modalResolve) modalResolve(false);
});

modalConfirm.addEventListener('click', () => {
    modalOverlay.classList.remove('active');
    if (modalResolve) modalResolve(true);
});

modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
        modalOverlay.classList.remove('active');
        if (modalResolve) modalResolve(false);
    }
});

// ========== УПРАВЛЕНИЕ ПОЗИЦИЯМИ С ГРАНИЦАМИ ==========
let occupiedPositions = new Map();
let occupiedRectangles = new Map();

function resetOccupiedPositions() {
    occupiedPositions = new Map();
    occupiedRectangles = new Map();
}

function registerPosition(nodeId, x, y, width = LAYOUT_CONFIG.NODE_WIDTH, height = LAYOUT_CONFIG.NODE_HEIGHT) {
    const gridX = Math.floor(x / 30);
    const gridY = Math.floor(y / 30);
    const key = `${gridX}_${gridY}`;
    occupiedPositions.set(key, { nodeId, x, y });

    occupiedRectangles.set(nodeId, {
        id: nodeId,
        x: x,
        y: y,
        width: width,
        height: height,
        right: x + width,
        bottom: y + height
    });
}

// Функция проверки пересечения двух прямоугольников
function rectanglesIntersect(rect1, rect2, padding = 20) {
    return !(rect1.right <= rect2.x - padding ||
             rect1.x >= rect2.right + padding ||
             rect1.bottom <= rect2.y - padding ||
             rect1.y >= rect2.bottom + padding);
}

// Функция проверки пересечения с любым существующим блоком
function intersectsWithAnyBlock(x, y, width = LAYOUT_CONFIG.NODE_WIDTH, height = LAYOUT_CONFIG.NODE_HEIGHT, excludeId = null) {
    const testRect = {
        x: x,
        y: y,
        width: width,
        height: height,
        right: x + width,
        bottom: y + height
    };

    for (const [nodeId, rect] of occupiedRectangles) {
        if (excludeId && nodeId === excludeId) continue;
        const nodeEl = byId(nodeId);
        if (nodeEl && nodeEl.classList.contains('hidden')) continue;
        if (rectanglesIntersect(testRect, rect)) {
            return { intersects: true, with: nodeId };
        }
    }
    return { intersects: false, with: null };
}

// Функция для разбиения кривой Безье на сегменты с маской
function getMaskedBezierSegments(fromX, fromY, toX, toY, controlOffset, excludeNodeIds = []) {
    const segments = [];
    const steps = 20;
    let lastVisiblePoint = { x: fromX, y: fromY };
    let isCurrentlyVisible = true;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;

        // Координаты Безье для t
        const bx = fromX * Math.pow(1 - t, 3) +
                  3 * fromX * Math.pow(1 - t, 2) * t +
                  3 * toX * (1 - t) * Math.pow(t, 2) +
                  toX * Math.pow(t, 3);
        const by = fromY * Math.pow(1 - t, 3) +
                  3 * (fromY + controlOffset) * Math.pow(1 - t, 2) * t +
                  3 * (toY - controlOffset) * (1 - t) * Math.pow(t, 2) +
                  toY * Math.pow(t, 3);

        // Проверяем, находится ли эта точка внутри какого-либо блока
        let pointInsideBlock = false;
        for (const [nodeId, rect] of occupiedRectangles) {
            if (excludeNodeIds.includes(nodeId)) continue;

            const node = byId(nodeId);
            if (node && node.classList.contains('hidden')) continue;

            if (bx >= rect.x && bx <= rect.right && by >= rect.y && by <= rect.bottom) {
                pointInsideBlock = true;
                break;
            }
        }

        if (pointInsideBlock) {
            // Точка внутри блока
            if (isCurrentlyVisible) {
                // Заканчиваем предыдущий видимый сегмент
                if (i > 0) {
                    segments.push({
                        x1: lastVisiblePoint.x,
                        y1: lastVisiblePoint.y,
                        x2: bx,
                        y2: by,
                        visible: true
                    });
                }
                isCurrentlyVisible = false;
            }
        } else {
            // Точка вне блока
            if (!isCurrentlyVisible) {
                // Начинаем новый видимый сегмент
                lastVisiblePoint = { x: bx, y: by };
                isCurrentlyVisible = true;
            } else if (i > 0) {
                // Продолжаем текущий видимый сегмент
                segments.push({
                    x1: lastVisiblePoint.x,
                    y1: lastVisiblePoint.y,
                    x2: bx,
                    y2: by,
                    visible: true
                });
                lastVisiblePoint = { x: bx, y: by };
            }
        }
    }

    return segments;
}

// Функция для создания пути из сегментов
function createPathFromSegments(segments) {
    if (segments.length === 0) return '';

    let pathData = `M ${segments[0].x1} ${segments[0].y1}`;

    for (const segment of segments) {
        if (segment.visible) {
            pathData += ` L ${segment.x2} ${segment.y2}`;
        }
    }

    return pathData;
}

function isPositionFree(x, y, width = LAYOUT_CONFIG.NODE_WIDTH, height = LAYOUT_CONFIG.NODE_HEIGHT, excludeId = null) {
    if (x < BOUNDARIES.minX || y < BOUNDARIES.minY) {
        return false;
    }
    if (x + width > BOUNDARIES.maxX || y + height > BOUNDARIES.maxY) {
        return false;
    }

    return !intersectsWithAnyBlock(x, y, width, height, excludeId).intersects;
}

function getViewportCenter() {
    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;

    const worldX = (-translateX + containerWidth / 2) / scale;
    const worldY = (-translateY + containerHeight / 2) / scale;

    return {
        x: worldX - LAYOUT_CONFIG.NODE_WIDTH / 2,
        y: worldY - LAYOUT_CONFIG.NODE_HEIGHT / 2
    };
}

function findFreePosition(nearX, nearY, parentId = null, verticalOffset = 0) {
    if (parentId) {
        const parentRect = occupiedRectangles.get(parentId);
        if (parentRect) {
            let baseX = parentRect.x;
            let baseY = parentRect.bottom + LAYOUT_CONFIG.ROW_SPACING + verticalOffset;

            if (isPositionFree(baseX, baseY)) {
                const clampedPos = clampToBoundaries(baseX, baseY);
                return { x: clampedPos.x, y: clampedPos.y };
            }

            for (let offset = 1; offset <= 10; offset++) {
                const rightX = parentRect.x + offset * 30;
                if (isPositionFree(rightX, baseY)) {
                    const clampedPos = clampToBoundaries(rightX, baseY);
                    return { x: clampedPos.x, y: clampedPos.y };
                }

                const leftX = parentRect.x - offset * 30;
                if (isPositionFree(leftX, baseY)) {
                    const clampedPos = clampToBoundaries(leftX, baseY);
                    return { x: clampedPos.x, y: clampedPos.y };
                }
            }
        }
    }

    let targetX = nearX;
    let targetY = nearY;

    if ((!targetX && targetX !== 0) || (!targetY && targetY !== 0)) {
        const viewportCenter = getViewportCenter();
        targetX = viewportCenter.x;
        targetY = viewportCenter.y;
    }

    if (isPositionFree(targetX, targetY)) {
        const clampedPos = clampToBoundaries(targetX, targetY);
        return { x: clampedPos.x, y: clampedPos.y };
    }

    for (let radius = 1; radius <= 15; radius++) {
        const points = 12;
        for (let i = 0; i < points; i++) {
            const angle = (i * 360) / points;
            const rad = angle * Math.PI / 180;
            const x = targetX + Math.cos(rad) * radius * 100;
            const y = targetY + Math.sin(rad) * radius * 80;

            if (isPositionFree(x, y)) {
                const clampedPos = clampToBoundaries(x, y);
                return { x: clampedPos.x, y: clampedPos.y };
            }
        }
    }

    const clampedPos = clampToBoundaries(targetX, targetY);
    return { x: clampedPos.x, y: clampedPos.y };
}

function clampToBoundaries(x, y, width = LAYOUT_CONFIG.NODE_WIDTH, height = LAYOUT_CONFIG.NODE_HEIGHT) {
    const clampedX = Math.max(BOUNDARIES.minX, Math.min(BOUNDARIES.maxX - width, x));
    const clampedY = Math.max(BOUNDARIES.minY, Math.min(BOUNDARIES.maxY - height, y));
    return { x: clampedX, y: clampedY };
}

// ========== СОХРАНЕНИЕ И ЗАГРУЗКА ==========
function saveState(debounceMs = 200) {
    if (_saveTimeout) clearTimeout(_saveTimeout);
    _saveTimeout = setTimeout(() => {
        try {
            const state = serializeState();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) { console.error('saveState', e); }
    }, debounceMs);
}

function serializeState() {
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
        collapsed: sidePanel.dataset.collapsed === '1',
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

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        if (raw) {
            const s = JSON.parse(raw);
            if (s) {
                if (typeof s.nodeCounter === 'number') nodeCounter = s.nodeCounter;

                resetOccupiedPositions();

                if (s.viewState && s.version >= 3) {
                    scale = s.viewState.scale || ZOOM_CONFIG.default;
                    translateX = s.viewState.translateX || 0;
                    translateY = s.viewState.translateY || 0;
                }

                const root = document.querySelector('[data-id="root"]');
                if (root) {
                    const savedRoot = (s.nodes || []).find(n => n.id === 'root');
                    if (savedRoot) {
                        const clampedPos = clampToBoundaries(savedRoot.left || 0, savedRoot.top || 0);
                        root.style.left = clampedPos.x + 'px';
                        root.style.top = clampedPos.y + 'px';
                        const t = root.querySelector('.title');
                        if (t) t.innerText = savedRoot.title || '';
                        registerPosition('root', clampedPos.x, clampedPos.y);
                    }
                }

                document.querySelectorAll('.node').forEach(n => { if (n.dataset.id !== 'root') n.remove(); });
                edges = [];

                if (Array.isArray(s.nodes)) {
                    s.nodes.forEach(n => {
                        if (n.id === 'root') return;

                        let yPos = n.top || 100;
                        const isProCon = n.type && (n.type === 'pro' || n.type === 'con' ||
                            n.type === 'pros-container' || n.type === 'cons-container' ||
                            n.type === 'risk' || n.type === 'recommendation' || n.type === 'verdict' ||
                            n.type === 'risks-container' || n.type === 'recommendations-container');

                        if (isProCon) {
                            const parentEdge = (s.edges || []).find(e => e.to === n.id);
                            if (parentEdge) {
                                const parentNode = s.nodes.find(node => node.id === parentEdge.from);
                                if (parentNode) {
                                    const minY = (parentNode.top || 0) + LAYOUT_CONFIG.NODE_HEIGHT + 40;
                                    yPos = Math.max(yPos, minY);
                                }
                            }
                        }

                        const clampedPos = clampToBoundaries(n.left || 100, yPos);
                        const node = recreateNode(n.id, clampedPos.x, clampedPos.y, n.title || 'Новый исход');
                        if (n.type) node.dataset.type = n.type;
                        if (n.collapsed) {
                            node.dataset.collapsed = 'true';
                            addToggleButton(node);
                        }
                        registerPosition(n.id, clampedPos.x, clampedPos.y);
                    });
                }

                if (Array.isArray(s.edges)) edges = s.edges.slice();
                if (s.aiOutput !== undefined) document.getElementById('ai-output').innerHTML = s.aiOutput || '';

                if (s.panelState) {
                    const editorRect = document.getElementById('editorPage').getBoundingClientRect();
                    sidePanel.style.left = (s.panelState.left || 0) + 'px';
                    sidePanel.style.top = (s.panelState.top || 0) + 'px';
                    sidePanel.style.right = 'auto';
                    if (s.panelState.collapsed) {
                        sidePanel.dataset.prevWidth = (s.panelState.width || '') ? s.panelState.width + 'px' : '';
                        sidePanel.dataset.prevHeight = (s.panelState.height || '') ? s.panelState.height + 'px' : '';
                        sidePanel.style.width = '';
                        sidePanel.style.height = '';
                        sidePanel.classList.add('collapsed');
                        sidePanel.dataset.collapsed = '1';
                        if (panelCollapseBtn) {
                            panelCollapseBtn.textContent = '⤢';
                            panelCollapseBtn.title = 'Развернуть';
                            panelCollapseBtn.setAttribute('aria-label', 'Развернуть панель');
                            panelCollapseBtn.setAttribute('aria-expanded', 'false');
                        }
                    } else {
                        if (s.panelState.width) sidePanel.style.width = s.panelState.width + 'px';
                        if (s.panelState.height) sidePanel.style.height = s.panelState.height + 'px';
                    }
                    if (s.panelState.hidden) {
                        sidePanel.style.display = 'none';
                        openPanelBtn.classList.add('visible');
                    }
                }

                if (s.isLockedUntil) {
                    isLockedUntil = s.isLockedUntil;
                    updateTimerUI();
                    if (isLockedUntil > Date.now()) {
                        timerInterval && clearInterval(timerInterval);
                        timerInterval = setInterval(updateTimerUI, 250);
                    }
                }
            }
        } else {
            const root = document.querySelector('[data-id="root"]');
            if (root) {
                const centerX = LAYOUT_CONFIG.CANVAS_WIDTH / 2 - LAYOUT_CONFIG.NODE_WIDTH / 2;
                const centerY = LAYOUT_CONFIG.CANVAS_HEIGHT / 2 - LAYOUT_CONFIG.NODE_HEIGHT / 2;

                root.style.left = centerX + 'px';
                root.style.top = centerY + 'px';
                registerPosition('root', centerX, centerY);
            }
        }

        centerOnRoot();

        setTimeout(() => {
            relayoutAllProConTrees();
            fixProConPositions();
            restoreCollapsedState();
            renderConnections();
            updateAIPreview();
            saveState();
        }, 800);

    } catch (e) { console.error('loadState', e); }
}

// ========== ТАЙМЕР ==========
function setLock(seconds) {
    isLockedUntil = Date.now() + seconds * 1000;
    updateTimerUI();
    timerInterval && clearInterval(timerInterval);
    timerInterval = setInterval(updateTimerUI, 250);
    saveState();
}

function updateTimerUI() {
    const el = document.getElementById('ai-timer');
    const runBtn = document.getElementById('ai-analyze');
    const remaining = Math.max(0, Math.ceil((isLockedUntil - Date.now()) / 1000));
    if (remaining > 0) {
        el.innerText = `${remaining}s`;
        runBtn.disabled = true;
        runBtn.style.opacity = '0.6';
    } else {
        el.innerText = '—';
        runBtn.disabled = false;
        runBtn.style.opacity = '';
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (isLockedUntil !== 0) {
            isLockedUntil = 0;
            saveState();
        }
    }
}

// ========== УЗЛЫ И ИНТЕРФЕЙС ==========
function byId(id) { return document.querySelector(`[data-id="${id}"]`); }
function genId() { nodeCounter = (nodeCounter || 0) + 1; saveState(); return 'node-' + nodeCounter; }

function recreateNode(id, x = 100, y = 200, text = 'Новый исход') {
    const div = document.createElement('div');
    div.className = 'node';

    const clampedPos = clampToBoundaries(x, y);
    div.style.left = clampedPos.x + 'px';
    div.style.top = clampedPos.y + 'px';

    div.dataset.id = id;
    div.innerHTML = `
    <div contenteditable class="title">${text}</div>
    <div class="controls">
      <div class="small-muted">${id === 'root' ? 'Главный пункт' : 'Исход'}</div>
      <div class="buttons-container">
        <div class="add-btn" title="Добавить исход" data-add>+</div>
        ${id === 'root' ? '' : '<div class="remove-btn" title="Удалить узел">✕</div>'}
      </div>
    </div>
  `;
    canvasContent.appendChild(div);
    makeDraggable(div);
    setupNodeButtons(div);
    const t = div.querySelector('.title');
    if (t) t.addEventListener('input', () => { updateAIPreview(); saveState(); });

    registerPosition(id, clampedPos.x, clampedPos.y, div.offsetWidth, div.offsetHeight);

    return div;
}

function createNode(x = 100, y = 200, text = 'Новый исход', parentId = null, type = null, skipAutoLayout = false) {
    const id = genId();

    const isProCon = type && (type === 'pro' || type === 'con' ||
        type === 'pros-container' || type === 'cons-container' ||
        type === 'risk' || type === 'recommendation' || type === 'verdict' ||
        type === 'risks-container' || type === 'recommendations-container');

    let targetX = x;
    let targetY = y;

    if (skipAutoLayout) {
        // Caller сам нашёл свободное место — используем его как есть.
        const clamped = clampToBoundaries(targetX, targetY);
        targetX = clamped.x;
        targetY = clamped.y;
    } else if (isProCon && parentId) {
        const parentRect = occupiedRectangles.get(parentId);
        if (parentRect) {
            const minY = parentRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT;

            let foundSpot = false;

            for (let horizontalAttempt = 0; horizontalAttempt < 5; horizontalAttempt++) {
                const offsetX = (horizontalAttempt - 2) * 50;
                const testX = parentRect.x + offsetX;

                for (let verticalAttempt = 0; verticalAttempt < 8; verticalAttempt++) {
                    const testY = minY + verticalAttempt * 45;

                    if (isPositionFree(testX, testY, LAYOUT_CONFIG.NODE_WIDTH, LAYOUT_CONFIG.NODE_HEIGHT)) {
                        targetX = testX;
                        targetY = testY;
                        foundSpot = true;
                        break;
                    }
                }
                if (foundSpot) break;
            }

            if (!foundSpot) {
                targetX = parentRect.x;
                targetY = minY;

                const clamped = clampToBoundaries(targetX, targetY);
                targetX = clamped.x;
                targetY = clamped.y;
            }
        }
    } else {
        let verticalOffset = 0;
        let horizontalOffset = 0;

        if (type === 'pro' || type === 'con') {
            verticalOffset = 80;
        } else if (type === 'pros-container' || type === 'cons-container') {
            horizontalOffset = type === 'pros-container' ? -400 : 400;
        }

        targetX = x + horizontalOffset;
        targetY = y + verticalOffset;
    }

    let freePos = skipAutoLayout
        ? { x: targetX, y: targetY }
        : findFreePosition(targetX, targetY, parentId, 0);

    if (!skipAutoLayout && isProCon && parentId) {
        const parentRect = occupiedRectangles.get(parentId);
        if (parentRect) {
            if (freePos.y < parentRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT) {
                let correctedY = parentRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT;
                let correctedX = freePos.x;

                for (let attempt = 0; attempt < 10; attempt++) {
                    if (isPositionFree(correctedX, correctedY)) {
                        freePos = { x: correctedX, y: correctedY };
                        break;
                    }
                    correctedY += 30;
                }

                freePos.y = Math.max(freePos.y, parentRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT);
            }
        }
    }

    const node = recreateNode(id, freePos.x, freePos.y, text);
    if (type) node.dataset.type = type;
    if (parentId) addEdge(parentId, id);

    if (!skipAutoLayout && isProCon && parentId) {
        setTimeout(() => {
            const nodeRect = occupiedRectangles.get(id);
            const parentRect = occupiedRectangles.get(parentId);

            if (nodeRect && parentRect && nodeRect.y < parentRect.bottom + 10) {
                node.style.top = (parentRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT) + 'px';

                occupiedRectangles.delete(id);
                registerPosition(id, nodeRect.x, parentRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT,
                    node.offsetWidth, node.offsetHeight);

                renderConnections();
                saveState();
            }
        }, 100);
    }

    updateAIPreview();
    renderConnections();
    saveState();
    return id;
}

function makeDraggable(elem) {
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
    const nodeId = elem.dataset.id;
    const nodeType = elem.dataset.type || '';
    const isAIChild = nodeType === 'pro' || nodeType === 'con' ||
        nodeType === 'pros-container' || nodeType === 'cons-container' ||
        nodeType === 'risk' || nodeType === 'recommendation' || nodeType === 'verdict' ||
        nodeType === 'risks-container' || nodeType === 'recommendations-container';
    const isProCon = isAIChild;

    elem.addEventListener('mousedown', e => {
        if (e.target.closest('.add-btn, .remove-btn, .toggle-btn, .title')) return;
        if (e.button !== 0) return;

        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        origLeft = parseFloat(elem.style.left) || 0;
        origTop = parseFloat(elem.style.top) || 0;

        e.preventDefault();
        elem.style.zIndex = '1000';
        canvasContainer.classList.add('canvas-panning');
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newLeft = origLeft + dx;
        let newTop = origTop + dy;

        if (isProCon) {
            const parentEdge = edges.find(e => e.to === nodeId);
            if (parentEdge) {
                const parentRect = occupiedRectangles.get(parentEdge.from);
                if (parentRect) {
                    const minY = parentRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT;
                    if (newTop < minY) {
                        newTop = minY;
                    }
                }
            }
        }

        const clampedPos = clampToBoundaries(newLeft, newTop);
        newLeft = clampedPos.x;
        newTop = clampedPos.y;

        elem.style.left = newLeft + 'px';
        elem.style.top = newTop + 'px';

        renderConnections();
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        elem.style.zIndex = '';
        canvasContainer.classList.remove('canvas-panning');

        const finalLeft = parseFloat(elem.style.left) || 0;
        const finalTop = parseFloat(elem.style.top) || 0;

        occupiedRectangles.delete(nodeId);
        registerPosition(nodeId, finalLeft, finalTop, elem.offsetWidth, elem.offsetHeight);

        renderConnections();
        saveState();
    });

    elem.addEventListener('contextmenu', e => {
        if (dragging) {
            e.preventDefault();
        }
    });
}

function fixProConPositions() {
    const proConNodes = Array.from(document.querySelectorAll('.node[data-id]'))
        .filter(n => {
            const nodeType = n.dataset.type;
            return nodeType && (
                nodeType.includes('pro') || nodeType.includes('con') ||
                nodeType.includes('pros-container') || nodeType.includes('cons-container') ||
                nodeType === 'risk' || nodeType === 'recommendation' || nodeType === 'verdict' ||
                nodeType === 'risks-container' || nodeType === 'recommendations-container'
            );
        });

    let fixedCount = 0;

    proConNodes.forEach(node => {
        const nodeId = node.dataset.id;

        const parentEdge = edges.find(e => e.to === nodeId);
        if (!parentEdge) return;

        const parentRect = occupiedRectangles.get(parentEdge.from);
        if (!parentRect) return;

        const currentX = parseFloat(node.style.left) || 0;
        let currentY = parseFloat(node.style.top) || 0;

        const MIN_ALLOWED_Y = parentRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT;

        if (currentY < MIN_ALLOWED_Y) {
            let foundY = MIN_ALLOWED_Y;

            for (let offsetY = 0; offsetY < 15; offsetY++) {
                const testY = MIN_ALLOWED_Y + offsetY * 35;
                if (isPositionFree(currentX, testY, node.offsetWidth, node.offsetHeight, nodeId)) {
                    foundY = testY;
                    break;
                }
            }

            foundY = Math.max(foundY, MIN_ALLOWED_Y);

            node.style.top = foundY + 'px';

            occupiedRectangles.delete(nodeId);
            registerPosition(nodeId, currentX, foundY, node.offsetWidth, node.offsetHeight);

            fixedCount++;
        }
    });

    if (fixedCount > 0) {
        console.log(`Исправлено ${fixedCount} pro/con узлов`);
        renderConnections();
        saveState();
    }
}

function setupNodeButtons(node) {
    const addBtn = node.querySelector('[data-add]');
    const removeBtn = node.querySelector('.remove-btn');
    const toggleBtn = node.querySelector('.toggle-btn');

    if (addBtn) addBtn.addEventListener('click', e => {
        e.stopPropagation();
        const nodeId = node.dataset.id;
        const nodeRect = occupiedRectangles.get(nodeId);

        if (!nodeRect) return;

        const freePos = findFreePosition(nodeRect.x, nodeRect.bottom + 20, nodeId);

        createNode(freePos.x, freePos.y, 'Новый пункт', nodeId);
        if (nodeId === 'root') layoutOutcomeColumns();
    });

    if (removeBtn) removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        removeNode(node.dataset.id);
    });

    if (toggleBtn) toggleBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleCollapse(node);
    });
}

function addToggleButton(node) {
    const buttonsContainer = node.querySelector('.buttons-container');
    if (!buttonsContainer) return;

    if (!buttonsContainer.querySelector('.toggle-btn')) {
        const toggleBtn = document.createElement('div');
        toggleBtn.className = 'toggle-btn';
        toggleBtn.title = 'Свернуть/развернуть';
        toggleBtn.textContent = '−';
        buttonsContainer.appendChild(toggleBtn);
        setupNodeButtons(node);
    }
}

function toggleCollapse(node) {
    const isCollapsed = node.dataset.collapsed === 'true';
    node.dataset.collapsed = (!isCollapsed).toString();

    const toggleBtn = node.querySelector('.toggle-btn');
    if (toggleBtn) {
        toggleBtn.textContent = isCollapsed ? '−' : '+';
    }

    collapseAllChildren(node, !isCollapsed);
    saveState();
}

function collapseAllChildren(parentNode, shouldCollapse) {
    const parentId = parentNode.dataset.id;

    const childNodes = findAllChildNodes(parentId);

    childNodes.forEach(childNode => {
        if (shouldCollapse) {
            childNode.classList.add('hidden');
        } else {
            childNode.classList.remove('hidden');
            setTimeout(() => {
                renderConnections();
            }, 50);
        }

        const childToggleBtn = childNode.querySelector('.toggle-btn');
        if (childToggleBtn && childNode.dataset.type &&
            (childNode.dataset.type.includes('container') || childNode.dataset.collapsed === 'true')) {
            childToggleBtn.textContent = shouldCollapse ? '+' : '−';
        }
    });

    renderConnections();
}

function findAllChildNodes(parentId) {
    const children = [];
    const visited = new Set();

    function findChildrenRecursive(id) {
        if (visited.has(id)) return;
        visited.add(id);

        edges.forEach(edge => {
            if (edge.from === id) {
                const childNode = byId(edge.to);
                if (childNode && !children.includes(childNode)) {
                    children.push(childNode);
                    findChildrenRecursive(edge.to);
                }
            }
        });
    }

    findChildrenRecursive(parentId);
    return children;
}

function restoreCollapsedState() {
    document.querySelectorAll('.node[data-collapsed="true"]').forEach(node => {
        collapseAllChildren(node, true);
    });
}

function removeNode(id) {
    const node = byId(id);
    if (!node) return;

    const childEdges = edges.filter(e => e.from === id);
    childEdges.forEach(e => removeNode(e.to));

    edges = edges.filter(e => e.from !== id && e.to !== id);

    occupiedRectangles.delete(id);

    node.remove();
    updateAIPreview();
    if (getOutcomeNodes().length) layoutOutcomeColumns();
    renderConnections();
    saveState();
}

function addEdge(fromId, toId) {
    edges.push({ from: fromId, to: toId });
    renderConnections();
}

// ========== ОТРИСОВКА СОЕДИНЕНИЙ С МАСКИРОВАНИЕМ ЗА БЛОКАМИ ==========
function syncNodeRectFromDom(node) {
    if (!node || !node.dataset.id) return;
    const x = parseFloat(node.style.left) || 0;
    const y = parseFloat(node.style.top) || 0;
    occupiedRectangles.delete(node.dataset.id);
    registerPosition(
        node.dataset.id,
        x,
        y,
        node.offsetWidth || LAYOUT_CONFIG.NODE_WIDTH,
        node.offsetHeight || LAYOUT_CONFIG.NODE_HEIGHT
    );
}

let _aiLayoutTimer = null;
function scheduleFinalAiLayout(delayMs = 120) {
    clearTimeout(_aiLayoutTimer);
    _aiLayoutTimer = setTimeout(() => {
        _aiLayoutTimer = null;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                relayoutAllProConTrees();
                document.querySelectorAll('.node[data-id]').forEach(syncNodeRectFromDom);
                renderConnections();
                saveState();
            });
        });
    }, delayMs);
}

function renderConnections() {
    const svg = connectorsSvg;

    if (renderConnections._frame) {
        cancelAnimationFrame(renderConnections._frame);
    }
    renderConnections._frame = requestAnimationFrame(() => {
            renderConnections._frame = null;
            svg.innerHTML = '';
            edges.forEach(e => {
                const fromNode = byId(e.from);
                const toNode = byId(e.to);
                if (!fromNode || !toNode) return;

                if (fromNode.classList.contains('hidden') || toNode.classList.contains('hidden')) return;

                const fromX = parseFloat(fromNode.style.left) + fromNode.offsetWidth / 2;
                const fromY = parseFloat(fromNode.style.top) + fromNode.offsetHeight;
                const toX = parseFloat(toNode.style.left) + toNode.offsetWidth / 2;
                const toY = parseFloat(toNode.style.top);

                const fromType = fromNode.dataset.type || '';
                const toType = toNode.dataset.type || '';

                const isProConnection = (fromType.includes('pro') || toType.includes('pro'));
                const isConConnection = (fromType.includes('con') || toType.includes('con'));
                const isRiskConnection = (fromType === 'risk' || toType === 'risk' ||
                    fromType === 'risks-container' || toType === 'risks-container');
                const isRecConnection = (fromType === 'recommendation' || toType === 'recommendation' ||
                    fromType === 'recommendations-container' || toType === 'recommendations-container');
                const isVerdictConnection = (fromType === 'verdict' || toType === 'verdict');
                // Риски / рекомендации матчатся .includes('con')/.includes('pro') случайно —
                // принудительно сбрасываем pro/con, если это другая категория.
                let proConOverride = isProConnection || isConConnection;
                let _isProConnection = isProConnection;
                let _isConConnection = isConConnection;
                if (isRiskConnection || isRecConnection || isVerdictConnection) {
                    _isProConnection = false;
                    _isConConnection = false;
                    proConOverride = false;
                }
                const isProConConnection = _isProConnection || _isConConnection;

                const isContainerCollapsed =
                    (fromNode.dataset.type && fromNode.dataset.type.includes('container') && fromNode.dataset.collapsed === 'true') ||
                    (toNode.dataset.type && toNode.dataset.type.includes('container') && toNode.dataset.collapsed === 'true');

                const isInCollapsedContainer = isContainerCollapsed && isProConConnection;

                let controlOffset;
                const horizontalDistance = Math.abs(toX - fromX);
                const verticalDistance = Math.abs(toY - fromY);

                controlOffset = Math.min(Math.max(horizontalDistance * 0.25, verticalDistance * 0.18), 45);

                if (isProConConnection && verticalDistance > horizontalDistance) {
                    controlOffset = Math.min(horizontalDistance * 0.15, 22);
                }

                // Получаем сегменты кривой с учетом маскирования
                const excludeNodeIds = [e.from, e.to];
                const segments = getMaskedBezierSegments(fromX, fromY, toX, toY, controlOffset, excludeNodeIds);

                // Если нет видимых сегментов, не отрисовываем соединение
                const hasVisibleSegments = segments.some(segment => segment.visible);
                if (!hasVisibleSegments && !isInCollapsedContainer) {
                    return;
                }

                // Создаем путь из сегментов
                const pathData = createPathFromSegments(segments);
                if (!pathData) return;

                // Глоу эффект
                const glow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                glow.setAttribute('d', pathData);

                let glowColor = 'var(--glow-neon)';
                let glowWidth = '8';

                if (_isProConnection) {
                    glowColor = 'var(--glow-pro)';
                    glowWidth = '6';
                } else if (_isConConnection) {
                    glowColor = 'var(--glow-con)';
                    glowWidth = '6';
                } else if (isRiskConnection) {
                    glowColor = 'rgba(245,158,11,0.45)';
                    glowWidth = '6';
                } else if (isRecConnection) {
                    glowColor = 'rgba(96,165,250,0.45)';
                    glowWidth = '6';
                } else if (isVerdictConnection) {
                    glowColor = 'rgba(167,139,250,0.45)';
                    glowWidth = '6';
                }

                glow.setAttribute('stroke', isInCollapsedContainer ? 'rgba(255,255,255,0.02)' : glowColor);
                glow.setAttribute('stroke-width', isInCollapsedContainer ? '4' : glowWidth);
                glow.setAttribute('fill', 'none');
                glow.setAttribute('stroke-linecap', 'round');
                glow.classList.add('connector-glow');
                svg.appendChild(glow);

                // Основная линия
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', pathData);

                let strokeColor = 'var(--neon)';
                let strokeWidth = 3;
                let strokeOpacity = 0.98;
                let cssClass = 'connector-line';

                if (_isProConnection) {
                    strokeColor = 'var(--pro-color)';
                    strokeWidth = 2.5;
                    strokeOpacity = 1;
                    cssClass = 'connector-pro';
                } else if (_isConConnection) {
                    strokeColor = 'var(--con-color)';
                    strokeWidth = 2.5;
                    strokeOpacity = 1;
                    cssClass = 'connector-con';
                } else if (isRiskConnection) {
                    strokeColor = '#f59e0b';
                    strokeWidth = 2.5;
                    strokeOpacity = 1;
                    cssClass = 'connector-risk';
                } else if (isRecConnection) {
                    strokeColor = '#60a5fa';
                    strokeWidth = 2.5;
                    strokeOpacity = 1;
                    cssClass = 'connector-recommendation';
                } else if (isVerdictConnection) {
                    strokeColor = '#a78bfa';
                    strokeWidth = 2.5;
                    strokeOpacity = 1;
                    cssClass = 'connector-verdict';
                }

                if (isInCollapsedContainer) {
                    strokeWidth = 0.8;
                    strokeOpacity = 0.3;
                }

                path.setAttribute('stroke', strokeColor);
                path.setAttribute('stroke-width', strokeWidth.toString());
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke-linecap', 'round');
                path.style.opacity = strokeOpacity.toString();
                path.classList.add(cssClass);
                svg.appendChild(path);

                // Стрелка (только если последний сегмент видим)
                if (!isInCollapsedContainer && segments.length > 0 && segments[segments.length - 1].visible) {
                    const arrowSize = isProConConnection ? 6 : 8;

                    // Берем последние две точки для расчета угла
                    const lastSegment = segments[segments.length - 1];
                    const angle = Math.atan2(lastSegment.y2 - lastSegment.y1, lastSegment.x2 - lastSegment.x1);

                    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    const points = `
                        ${lastSegment.x2},${lastSegment.y2}
                        ${lastSegment.x2 - arrowSize * Math.cos(angle - Math.PI/6)},${lastSegment.y2 - arrowSize * Math.sin(angle - Math.PI/6)}
                        ${lastSegment.x2 - arrowSize * Math.cos(angle + Math.PI/6)},${lastSegment.y2 - arrowSize * Math.sin(angle + Math.PI/6)}
                    `;
                    arrow.setAttribute('points', points);
                    arrow.setAttribute('fill', strokeColor);
                    arrow.style.opacity = strokeOpacity.toString();

                    if (_isProConnection) {
                        arrow.classList.add('arrow-pro');
                    } else if (_isConConnection) {
                        arrow.classList.add('arrow-con');
                    } else {
                        arrow.classList.add('connector-arrow');
                    }
                    svg.appendChild(arrow);
                }
            });
    });
}

// ========== ФОРМА НАСТРОЙКИ (вопрос + варианты) ==========
const ROOT_PLACEHOLDER = 'Нажмите и впишите проблему';
let _suppressFormSync = false;

function normalizeProblemText(text) {
    const t = (text || '').trim();
    if (!t || t === ROOT_PLACEHOLDER) return '';
    return t;
}

function isOutcomeNode(el) {
    if (!el || el.dataset.id === 'root') return false;
    const nodeType = el.dataset.type;
    return !nodeType || (
        nodeType !== 'pro' && nodeType !== 'con' &&
        nodeType !== 'pros-container' && nodeType !== 'cons-container' &&
        nodeType !== 'risk' && nodeType !== 'recommendation' && nodeType !== 'verdict' &&
        nodeType !== 'risks-container' && nodeType !== 'recommendations-container'
    );
}

function getOutcomeNodes() {
    return Array.from(document.querySelectorAll('.node[data-id]')).filter(isOutcomeNode);
}

function getSetupOutcomesList() {
    return document.getElementById('setup-outcomes-list');
}

function addSetupOutcomeRow(value = '') {
    const list = getSetupOutcomesList();
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'setup-outcome-row';
    row.setAttribute('role', 'listitem');
    row.innerHTML = `
        <input type="text" class="setup-outcome-input" placeholder="Вариант решения…" value="${escapeHtml(value)}" />
        <button type="button" class="setup-outcome-remove" title="Удалить вариант" aria-label="Удалить вариант">✕</button>`;
    list.appendChild(row);
}

function ensureSetupOutcomeRows(minRows = 2) {
    const list = getSetupOutcomesList();
    if (!list) return;
    while (list.children.length < minRows) addSetupOutcomeRow();
}

function readSetupOutcomeValues() {
    const list = getSetupOutcomesList();
    if (!list) return [];
    return Array.from(list.querySelectorAll('.setup-outcome-input'))
        .map(inp => inp.value.trim())
        .filter(Boolean);
}

function collectFormData() {
    const q = document.getElementById('setup-question');
    const title = normalizeProblemText(q ? q.value : '');
    const outcomes = readSetupOutcomeValues();
    return { title, outcomes };
}

function syncFormFromCanvas() {
    if (_suppressFormSync) return;
    const q = document.getElementById('setup-question');
    const list = getSetupOutcomesList();
    if (!q || !list) return;

    const root = byId('root');
    const title = root ? normalizeProblemText(root.querySelector('.title')?.innerText) : '';
    const outcomes = getOutcomeNodes()
        .map(n => (n.querySelector('.title')?.innerText || '').trim())
        .filter(Boolean);

    q.value = title;
    list.innerHTML = '';
    if (outcomes.length) {
        outcomes.forEach(text => addSetupOutcomeRow(text));
    } else {
        ensureSetupOutcomeRows(2);
    }
}

function canvasHasAiBranches() {
    return Array.from(document.querySelectorAll('.node[data-id]:not([data-id="root"])'))
        .some(n => isAiBranchType(n.dataset.type));
}

function removeAllOutcomeNodes() {
    getOutcomeNodes().map(n => n.dataset.id).forEach(id => removeNode(id));
}

function buildTreeFromForm() {
    const { title, outcomes } = collectFormData();
    const outBox = document.getElementById('ai-output');

    if (!title) {
        if (outBox) outBox.textContent = 'Опишите вопрос или проблему в поле выше.';
        return false;
    }
    if (!outcomes.length) {
        if (outBox) outBox.textContent = 'Добавьте хотя бы один вариант решения.';
        return false;
    }

    const runBuild = () => {
        _suppressFormSync = true;

        const root = byId('root');
        if (root) {
            const t = root.querySelector('.title');
            if (t) t.innerText = title;
        }

        removeAllOutcomeNodes();

        const rootEl = byId('root');
        const rootX = parseFloat(rootEl?.style.left) || 0;
        const rootY = parseFloat(rootEl?.style.top) || 0;
        const rootRect = occupiedRectangles.get('root');

        outcomes.forEach((text) => {
            const y = rootRect
                ? rootRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT + 40
                : rootY + LAYOUT_CONFIG.ROW_SPACING;
            createNode(rootX, y, text, 'root');
        });

        layoutOutcomeColumns();

        _suppressFormSync = false;
        centerOnRoot();
        renderConnections();
        saveState();
        if (outBox) outBox.textContent = 'Дерево создано. Нажмите «Проанализировать», чтобы получить плюсы, минусы и риски.';
        return true;
    };

    if (canvasHasAiBranches()) {
        showModal(
            'Пересоздать дерево?',
            'На холсте уже есть анализ ИИ. При пересоздании варианты обновятся, а ветки анализа будут удалены.'
        ).then(ok => {
            if (ok) runBuild();
        });
        return false;
    }

    return runBuild();
}

function initSetupForm() {
    const list = getSetupOutcomesList();
    const addBtn = document.getElementById('setup-add-outcome');
    const buildBtn = document.getElementById('setup-build-tree');
    if (!list || !addBtn || !buildBtn) return;

    addBtn.addEventListener('click', () => {
        addSetupOutcomeRow();
        list.lastElementChild?.querySelector('.setup-outcome-input')?.focus();
    });

    list.addEventListener('click', e => {
        const btn = e.target.closest('.setup-outcome-remove');
        if (!btn) return;
        const row = btn.closest('.setup-outcome-row');
        if (!row) return;
        if (list.children.length <= 1) {
            row.querySelector('.setup-outcome-input').value = '';
            return;
        }
        row.remove();
    });

    buildBtn.addEventListener('click', () => buildTreeFromForm());

    ensureSetupOutcomeRows(2);
}

// ========== AI И ПАРСИНГ ==========
function collectTreeText() {
    if (document.getElementById('setup-question')) {
        return collectFormData();
    }

    const root = byId('root');
    const title = normalizeProblemText(root ? root.querySelector('.title')?.innerText : '');

    const outcomes = getOutcomeNodes()
        .map(n => (n.querySelector('.title')?.innerText || '').trim())
        .filter(Boolean);

    return { title, outcomes };
}

function updateAIPreview() {
    syncFormFromCanvas();
}

function lifeAnalysisFromItem(item) {
    if (!item) return parseProsConsFromText('');
    const hasStructured = item.description != null || Array.isArray(item.pros) || Array.isArray(item.cons) ||
        Array.isArray(item.risks) || Array.isArray(item.recommendations) ||
        item.rating != null || item.verdict != null;
    if (hasStructured) {
        return {
            description: item.description || '',
            pros: item.pros || [],
            cons: item.cons || [],
            risks: item.risks || [],
            recommendations: item.recommendations || [],
            rating: item.rating || '',
            verdict: item.verdict || '',
        };
    }
    return parseProsConsFromText(item.result || '');
}

function parseProsConsFromText(text) {
    const empty = { description: '', pros: [], cons: [], risks: [], recommendations: [], rating: '', verdict: '' };
    if (!text) return empty;

    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

    // Заголовки в любом порядке, регистронезависимо.
    const headers = [
        { key: 'pros',            re: /^\s*ПЛЮСЫ?\s*:?\s*$/im },
        { key: 'cons',            re: /^\s*МИНУСЫ?\s*:?\s*$/im },
        { key: 'risks',           re: /^\s*РИСКИ?\s*:?\s*$/im },
        { key: 'recommendations', re: /^\s*РЕКОМЕНДАЦИИ\s*:?\s*$/im },
        { key: 'rating',          re: /^\s*ОЦЕНКА\s*:\s*(.*)$/im },
        { key: 'verdict',         re: /^\s*ВЕРДИКТ\s*:\s*(.*)$/im },
    ];

    // Найдём все позиции заголовков
    const positions = [];
    for (const h of headers) {
        const m = normalized.match(h.re);
        if (m) positions.push({ key: h.key, index: m.index, length: m[0].length, capture: m[1] || '' });
    }
    positions.sort((a, b) => a.index - b.index);

    // Описание = текст до первой найденной секции (без слова «ОПИСАНИЕ»)
    let description = '';
    if (positions.length > 0) {
        description = normalized.substring(0, positions[0].index).trim();
    } else {
        description = normalized;
    }
    description = description.replace(/^ОПИСАНИЕ[:\s]*/i, '').trim();

    const sections = { pros: [], cons: [], risks: [], recommendations: [], rating: '', verdict: '' };

    const splitItems = (raw) => raw
        .split('\n')
        .map(s => s.trim().replace(/^[\-\*\•\d\.\)\s]+/, '').trim())
        .filter(s => s.length > 2)
        .slice(0, 6);

    for (let i = 0; i < positions.length; i++) {
        const cur = positions[i];
        const next = positions[i + 1];
        const start = cur.index + cur.length;
        const end = next ? next.index : normalized.length;
        const body = normalized.substring(start, end).trim();

        if (cur.key === 'rating' || cur.key === 'verdict') {
            // Эти секции — однострочные, берём строку из захвата или из body до новой строки
            const oneLine = (cur.capture || body.split('\n')[0] || '').trim();
            sections[cur.key] = oneLine;
        } else {
            sections[cur.key] = splitItems(body);
        }
    }

    // Бэкап для совсем кривых ответов: если ничего не распарсилось — описательный fallback
    if (positions.length === 0 && description) {
        sections.pros = ["Высокая эффективность", "Быстрая реализация"];
        sections.cons = ["Риск неудачи", "Ограниченный масштаб"];
    }

    return {
        description,
        pros: sections.pros,
        cons: sections.cons,
        risks: sections.risks,
        recommendations: sections.recommendations,
        rating: sections.rating,
        verdict: sections.verdict,
    };
}

const AI_BRANCH_TYPES = new Set([
    'pro', 'con', 'pros-container', 'cons-container',
    'risk', 'recommendation', 'verdict',
    'risks-container', 'recommendations-container',
]);

function isAiBranchType(type) {
    return type && (AI_BRANCH_TYPES.has(type) || type.includes('pro') || type.includes('con'));
}

function removeOutcomeAiBranches(outcomeId) {
    edges.filter(e => e.from === outcomeId).forEach(e => {
        const child = byId(e.to);
        if (child && isAiBranchType(child.dataset.type)) {
            removeNode(e.to);
        }
    });
}

function moveNodeTo(node, x, y) {
    node.style.left = x + 'px';
    node.style.top = y + 'px';
    occupiedRectangles.delete(node.dataset.id);
    registerPosition(node.dataset.id, x, y, node.offsetWidth, node.offsetHeight);
}

function getOutcomeCenterX(outcomeRect) {
    return outcomeRect.x + (outcomeRect.width || LAYOUT_CONFIG.NODE_WIDTH) / 2;
}

function branchXForOutcome(outcomeRect, side) {
    const W = LAYOUT_CONFIG.NODE_WIDTH;
    const centerX = getOutcomeCenterX(outcomeRect);
    const x = centerX + side * LAYOUT_CONFIG.HORIZONTAL_OFFSET - W / 2;
    return Math.min(BOUNDARIES.maxX - W, Math.max(BOUNDARIES.minX, x));
}

function getOutcomeTreeWidth() {
    return 2 * LAYOUT_CONFIG.HORIZONTAL_OFFSET
        + LAYOUT_CONFIG.NODE_WIDTH
        + LAYOUT_CONFIG.OUTCOME_TREE_PADDING;
}

function getOrderedOutcomeNodes() {
    const fromRoot = edges
        .filter(e => e.from === 'root')
        .map(e => byId(e.to))
        .filter(n => n && isOutcomeNode(n));
    if (fromRoot.length) return fromRoot;
    return getOutcomeNodes().sort((a, b) => {
        const ax = parseFloat(a.style.left) || 0;
        const bx = parseFloat(b.style.left) || 0;
        return ax - bx;
    });
}

/** Раскладывает исходы в ряд под корнем — у каждого своё горизонтальное «поле» для веток ИИ */
function layoutOutcomeColumns() {
    const outcomes = getOrderedOutcomeNodes();
    if (!outcomes.length) return;

    const rootRect = occupiedRectangles.get('root');
    if (!rootRect) return;

    document.querySelectorAll('.node[data-id]').forEach(syncNodeRectFromDom);

    const W = LAYOUT_CONFIG.NODE_WIDTH;
    const treeW = getOutcomeTreeWidth();
    const gap = LAYOUT_CONFIG.OUTCOME_GAP;
    const n = outcomes.length;
    const totalW = n * treeW + (n - 1) * gap;
    const rootCenterX = getOutcomeCenterX(rootRect);
    const startX = rootCenterX - totalW / 2;
    const baseY = rootRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT + 28;

    outcomes.forEach((node, i) => {
        const slotCenterX = startX + i * (treeW + gap) + treeW / 2;
        const x = Math.round(slotCenterX - W / 2);
        const clamped = clampToBoundaries(x, baseY);
        moveNodeTo(node, clamped.x, clamped.y);
    });
}

function relayoutOutcomeBranches(outcomeNode) {
    const outcomeId = outcomeNode.dataset.id;
    const outcomeRect = occupiedRectangles.get(outcomeId);
    if (!outcomeRect) return;

    const W = LAYOUT_CONFIG.NODE_WIDTH;
    const CONT_H = LAYOUT_CONFIG.NODE_HEIGHT;
    const V_SPACE = LAYOUT_CONFIG.PRO_CON_VERTICAL_SPACING;
    const MIN_TOP = outcomeRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT;
    const ROW_STEP = CONT_H + V_SPACE + 6;

    const branchX = (side) => branchXForOutcome(outcomeRect, side);

    const layoutByType = {
        'pros-container': { side: -1, row: 0 },
        'cons-container': { side: 1, row: 0 },
        'recommendations-container': { side: -1, row: 1 },
        'risks-container': { side: 1, row: 1 },
    };

    const directChildIds = edges.filter(e => e.from === outcomeId).map(e => e.to);

    for (const [containerType, cfg] of Object.entries(layoutByType)) {
        const container = directChildIds.map(byId).find(n => n && n.dataset.type === containerType);
        if (!container) continue;

        const cx = branchX(cfg.side);
        const cy = MIN_TOP + cfg.row * ROW_STEP;
        moveNodeTo(container, cx, cy);

        const containerRect = occupiedRectangles.get(container.dataset.id);
        let nextY = containerRect.bottom + V_SPACE;

        edges.filter(e => e.from === container.dataset.id).forEach(e => {
            const child = byId(e.to);
            if (!child) return;
            moveNodeTo(child, cx, nextY);
            const r = occupiedRectangles.get(child.dataset.id);
            nextY = (r ? r.bottom : nextY + child.offsetHeight) + V_SPACE;
        });
    }

    const verdict = directChildIds.map(byId).find(n => n && n.dataset.type === 'verdict');
    if (verdict) {
        const hasSecondRow = directChildIds.some(id => {
            const n = byId(id);
            return n && (n.dataset.type === 'recommendations-container' || n.dataset.type === 'risks-container');
        });
        const row = hasSecondRow ? 2 : 1;
        moveNodeTo(verdict, branchX(0), MIN_TOP + row * ROW_STEP);
    }
}

function relayoutAllProConTrees() {
    document.querySelectorAll('.node[data-id]').forEach(syncNodeRectFromDom);
    layoutOutcomeColumns();
    getOrderedOutcomeNodes().forEach(node => {
        const hasAiBranch = edges.some(e => {
            if (e.from !== node.dataset.id) return false;
            const child = byId(e.to);
            return child && isAiBranchType(child.dataset.type);
        });
        if (hasAiBranch) relayoutOutcomeBranches(node);
    });
    document.querySelectorAll('.node[data-id]').forEach(syncNodeRectFromDom);
    renderConnections();
    saveState();
}

function createProConNodesForOutcome(outcomeText, pros, cons, outcomeIndex, extras = {}) {
    const nodes = Array.from(document.querySelectorAll('.node[data-id]'));

    let outcomeNode = nodes.find(n => {
        const nodeText = (n.querySelector('.title')?.innerText || '').trim();
        const nodeType = n.dataset.type;
        return nodeText === outcomeText &&
            !nodeType &&
            n.dataset.id !== 'root';
    });

    if (!outcomeNode) {
        const root = byId('root');
        const rootX = parseFloat(root.style.left) || 0;
        const rootY = parseFloat(root.style.top) || 0;

        const freePos = findFreePosition(
            rootX,
            rootY + (outcomeIndex + 1) * LAYOUT_CONFIG.ROW_SPACING,
            'root'
        );

        const rootRect = occupiedRectangles.get('root');
        if (rootRect && freePos.y < rootRect.bottom + 50) {
            freePos.y = rootRect.bottom + 50;
        }

        const newOutcomeId = createNode(freePos.x, freePos.y, outcomeText, 'root');

        setTimeout(() => {
            outcomeNode = byId(newOutcomeId);
            if (outcomeNode) {
                setTimeout(() => {
                    createProConBranches(outcomeNode, pros, cons, outcomeIndex, extras);
                }, 400);
            }
        }, 300);
    } else {
        createProConBranches(outcomeNode, pros, cons, outcomeIndex, extras);
    }
}

function createProConBranches(outcomeNode, pros, cons, outcomeIndex, extras = {}) {
    const outcomeId = outcomeNode.dataset.id;
    removeOutcomeAiBranches(outcomeId);

    const outcomeRect = occupiedRectangles.get(outcomeId);

    if (!outcomeRect) {
        setTimeout(() => {
            const rect = occupiedRectangles.get(outcomeId);
            if (rect) createProConBranches(outcomeNode, pros, cons, outcomeIndex, extras);
        }, 100);
        return;
    }

    const W = LAYOUT_CONFIG.NODE_WIDTH;
    const ITEM_H = LAYOUT_CONFIG.PRO_CON_ITEM_HEIGHT;
    const CONT_H = LAYOUT_CONFIG.NODE_HEIGHT;
    const V_SPACE = LAYOUT_CONFIG.PRO_CON_VERTICAL_SPACING;
    const MIN_TOP = outcomeRect.bottom + LAYOUT_CONFIG.MIN_DISTANCE_FROM_PARENT;
    const ROW_STEP = CONT_H + V_SPACE + 6;

    const branchX = (side) => branchXForOutcome(outcomeRect, side);

    function buildBranch(items, side, type, containerType, containerLabel, row = 0) {
        if (!items.length) return;

        const containerY = MIN_TOP + row * ROW_STEP;
        const containerX = branchX(side);

        const containerId = createNode(containerX, containerY, containerLabel, outcomeId, containerType, true);
        const containerEl = byId(containerId);
        if (!containerEl) return;
        containerEl.dataset.collapsed = 'true';
        addToggleButton(containerEl);

        const containerRect = occupiedRectangles.get(containerId) || {
            x: containerX,
            y: containerY,
            right: containerX + W,
            bottom: containerY + CONT_H
        };

        let nextY = containerRect.bottom + V_SPACE;
        items.forEach(text => {
            const id = createNode(containerRect.x, nextY, text, containerId, type, true);
            const childEl = byId(id);
            const r = occupiedRectangles.get(id);
            const h = childEl ? childEl.offsetHeight : LAYOUT_CONFIG.PRO_CON_ITEM_HEIGHT;
            nextY = (r ? r.bottom : nextY + h) + V_SPACE;
        });

        collapseAllChildren(containerEl, true);
    }

    function buildVerdictNode(verdictText) {
        if (!verdictText) return;
        const hasSecondRow = (extras.recommendations || []).length || (extras.risks || []).length;
        const row = hasSecondRow ? 2 : 1;
        const verdictX = branchX(0);
        const verdictY = MIN_TOP + row * ROW_STEP;
        createNode(verdictX, verdictY, verdictText, outcomeId, 'verdict', true);
    }

    // Две компактные строки: плюсы/минусы, затем рекомендации/риски — без поиска «вниз до конца».
    buildBranch(pros, -1, 'pro', 'pros-container', 'Плюсы', 0);
    buildBranch(cons, +1, 'con', 'cons-container', 'Минусы', 0);
    buildBranch(extras.recommendations || [], -1, 'recommendation', 'recommendations-container', 'Рекомендации', 1);
    buildBranch(extras.risks || [], +1, 'risk', 'risks-container', 'Риски', 1);
    buildVerdictNode((extras.verdict || '').trim());

    layoutOutcomeColumns();
    relayoutOutcomeBranches(outcomeNode);
    document.querySelectorAll('.node[data-id]').forEach(syncNodeRectFromDom);
    fixProConPositions();
    scheduleFinalAiLayout();
}

async function resetAIResponses() {
    const result = await showModal('Сброс ответов', 'Удалить все плюсы и минусы, созданные ИИ? Исходные варианты решений останутся.');
    if (!result) return;

    const proConNodes = Array.from(document.querySelectorAll('.node[data-id]:not([data-id="root"])'))
        .filter(n => {
            const nodeType = n.dataset.type;
            return nodeType && (
                nodeType.includes('pro') || nodeType.includes('con') ||
                nodeType.includes('pros-container') || nodeType.includes('cons-container') ||
                nodeType === 'risk' || nodeType === 'recommendation' || nodeType === 'verdict' ||
                nodeType === 'risks-container' || nodeType === 'recommendations-container'
            );
        });

    proConNodes.forEach(node => {
        const nodeId = node.dataset.id;
        edges = edges.filter(e => e.from !== nodeId && e.to !== nodeId);

        occupiedRectangles.delete(nodeId);

        node.remove();
    });

    document.getElementById('ai-output').innerHTML = '';
    updateTimerUI();
    updateAIPreview();
    renderConnections();
    saveState();
}

// ========== ЗАПРОСЫ К СЕРВЕРУ ==========
async function sendAiRequestWithRetries(payload, maxRetries = MAX_RETRIES) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch('/run-ai-life', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                lastError = new Error('HTTP ' + res.status);
            } else {
                const data = await res.json();
                return { success: true, data };
            }
        } catch (err) { lastError = err; }

        const backoff = 200 * attempt;
        await new Promise(r => setTimeout(r, backoff));
    }
    return { success: false, error: lastError };
}

// ========== AI UI (fallback без streaming; основной обработчик — life-enhancements.js) ==========
const aiAnalyzeBtn = document.getElementById('ai-analyze');
const aiResetBtn = document.getElementById('ai-reset');

aiAnalyzeBtn?.addEventListener('click', async () => {
    if (isLockedUntil > Date.now()) return;

    const { title, outcomes } = collectTreeText();
    const outBox = document.getElementById('ai-output');

    if (!title) {
        outBox.innerText = 'Пожалуйста, опишите проблему.';
        return;
    }

    if (!outcomes.length) {
        outBox.innerText = 'Добавьте варианты решения.';
        return;
    }

    outBox.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'ai-response';
    loading.innerHTML = `<div class="meta"><b>Анализируем ${outcomes.length} исходов...</b></div>`;
    outBox.appendChild(loading);
    outBox.scrollTop = outBox.scrollHeight;

    aiAnalyzeBtn.disabled = true;
    aiAnalyzeBtn.style.opacity = '0.6';

    const payload = { title, outcomes };
    const result = await sendAiRequestWithRetries(payload, MAX_RETRIES);

    if (result.success) {
        const data = result.data || {};
        const results = Array.isArray(data.results) ? data.results : [];

        if (outBox.lastElementChild === loading) outBox.removeChild(loading);

        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ai-response';
            empty.innerText = 'Пустой результат от сервера.';
            outBox.appendChild(empty);
        } else {
            results.forEach((item, index) => {
                const block = document.createElement('div');
                block.className = 'ai-response result-highlight';
                const outcomeText = item.outcome || outcomes[index] || `Исход ${index + 1}`;
                const resultText = item.result || '';

                const { description, pros, cons, risks, recommendations, rating, verdict } = lifeAnalysisFromItem(item);

                // Парсим оценку «N/10» в число для прогресс-бара
                const ratingMatch = (rating || '').match(/(\d+(?:[.,]\d+)?)\s*\/\s*10/);
                const ratingNum = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;
                const ratingPct = ratingNum != null ? Math.max(0, Math.min(100, ratingNum * 10)) : null;
                const ratingHue = ratingNum != null ? Math.round((ratingNum / 10) * 120) : 0; // 0 = red, 120 = green

                block.innerHTML = `
          <div class="meta"><b>Исход ${index + 1}:</b> ${escapeHtml(outcomeText)}</div>

          ${description ? `
            <div class="ai-section">
              <div class="ai-section-title">📝 Анализ</div>
              <div class="ai-section-body">${escapeHtml(description)}</div>
            </div>
          ` : ''}

          ${pros.length > 0 ? `
            <div class="ai-section">
              <div class="ai-section-title" style="color: var(--pro-color);">✅ Плюсы</div>
              <ul class="pros-list">
                ${pros.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${cons.length > 0 ? `
            <div class="ai-section">
              <div class="ai-section-title" style="color: var(--con-color);">❌ Минусы</div>
              <ul class="cons-list">
                ${cons.map(c => `<li>${escapeHtml(c)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${risks.length > 0 ? `
            <div class="ai-section">
              <div class="ai-section-title" style="color: #f59e0b;">⚠️ Риски</div>
              <ul class="risks-list">
                ${risks.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${recommendations.length > 0 ? `
            <div class="ai-section">
              <div class="ai-section-title" style="color: #60a5fa;">💡 Рекомендации</div>
              <ul class="recs-list">
                ${recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${rating ? `
            <div class="ai-section ai-rating">
              <div class="ai-section-title">📊 Оценка</div>
              <div class="ai-rating-row">
                <div class="ai-rating-value" style="color: hsl(${ratingHue}, 70%, 60%);">
                  ${escapeHtml(rating)}
                </div>
                ${ratingPct != null ? `
                  <div class="ai-rating-bar">
                    <div class="ai-rating-fill" style="width:${ratingPct}%; background: hsl(${ratingHue}, 70%, 55%);"></div>
                  </div>
                ` : ''}
              </div>
            </div>
          ` : ''}

          ${verdict ? `
            <div class="ai-section ai-verdict">
              <div class="ai-section-title">🎯 Вердикт</div>
              <div class="ai-section-body verdict-body">${escapeHtml(verdict)}</div>
            </div>
          ` : ''}
        `;

                outBox.appendChild(block);

                if (pros.length > 0 || cons.length > 0 || risks.length > 0 || recommendations.length > 0 || (verdict && verdict.trim())) {
                    createProConNodesForOutcome(outcomeText, pros, cons, index, { risks, recommendations, verdict });
                }
            });
            scheduleFinalAiLayout(200);
        }

        setLock(60);
        saveState();
    } else {
        if (outBox.lastElementChild === loading) {
            loading.innerHTML = `<div class="meta"><b>Ошибка при запросе к AI. Попытки исчерпаны.</b></div>`;
        } else {
            const err = document.createElement('div');
            err.className = 'ai-response';
            err.innerText = 'Ошибка при запросе к AI. Попытки исчерпаны.';
            outBox.appendChild(err);
        }
        console.error('AI request failed', result.error);
    }

    aiAnalyzeBtn.disabled = false;
    aiAnalyzeBtn.style.opacity = '';
});

aiResetBtn?.addEventListener('click', resetAIResponses);

// ========== ПАНЕЛЬ (ПЕРЕМЕЩЕНИЕ И УПРАВЛЕНИЕ) ==========
let panelDragging = false;
let panelResizing = false;
let panelResizeAxis = 'w'; // 'w' | 'h'
let panelStartX = 0;
let panelStartY = 0;
let panelStartWidth = 0;
let panelStartHeight = 0;
let panelStartLeft = 0;
let panelStartTop = 0;

sideHeader.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    panelDragging = true;
    panelStartX = e.clientX;
    panelStartY = e.clientY;
    panelStartLeft = parseInt(sidePanel.style.left) || 0;
    panelStartTop = parseInt(sidePanel.style.top) || 0;
    sidePanel.style.right = 'auto';
    document.body.style.userSelect = 'none';
    e.preventDefault();
});

function startPanelResize(axis, e) {
    panelResizing = true;
    panelResizeAxis = axis;
    panelStartX = e.clientX;
    panelStartY = e.clientY;
    panelStartWidth = sidePanel.offsetWidth;
    panelStartHeight = sidePanel.offsetHeight;
    sidePanel.style.maxHeight = 'none';
    document.body.style.userSelect = 'none';
    e.preventDefault();
}

if (panelHandle) {
    panelHandle.addEventListener('mousedown', e => startPanelResize('w', e));
}
if (panelBottomHandle) {
    panelBottomHandle.addEventListener('mousedown', e => startPanelResize('h', e));
}

document.addEventListener('mousemove', e => {
    if (panelDragging) {
        const dx = e.clientX - panelStartX;
        const dy = e.clientY - panelStartY;
        sidePanel.style.left = (panelStartLeft + dx) + 'px';
        sidePanel.style.top = (panelStartTop + dy) + 'px';
    }
    if (panelResizing) {
        const dx = e.clientX - panelStartX;
        const dy = e.clientY - panelStartY;
        if (panelResizeAxis === 'w' || panelResizeAxis === 'both') {
            const newWidth = Math.max(260, Math.min(window.innerWidth * 0.92, panelStartWidth - dx));
            sidePanel.style.width = newWidth + 'px';
        }
        if (panelResizeAxis === 'h' || panelResizeAxis === 'both') {
            const maxH = window.innerHeight - 20;
            const newHeight = Math.max(220, Math.min(maxH, panelStartHeight + dy));
            sidePanel.style.height = newHeight + 'px';
        }
        renderConnections();
    }
});

document.addEventListener('mouseup', () => {
    if (panelDragging || panelResizing) {
        panelDragging = false;
        panelResizing = false;
        document.body.style.userSelect = '';
        saveState();
    }
});

panelCollapseBtn.addEventListener('click', () => {
    const isCollapsing = sidePanel.dataset.collapsed !== '1';
    if (isCollapsing) {
        // Сохраняем текущие inline-размеры, чтобы вернуть их при разворачивании
        sidePanel.dataset.prevWidth = sidePanel.style.width || '';
        sidePanel.dataset.prevHeight = sidePanel.style.height || '';
        sidePanel.style.width = '';
        sidePanel.style.height = '';
        sidePanel.classList.add('collapsed');
        sidePanel.dataset.collapsed = '1';
        panelCollapseBtn.textContent = '⤢';
        panelCollapseBtn.title = 'Развернуть';
        panelCollapseBtn.setAttribute('aria-label', 'Развернуть панель');
        panelCollapseBtn.setAttribute('aria-expanded', 'false');
    } else {
        sidePanel.classList.remove('collapsed');
        sidePanel.style.width = sidePanel.dataset.prevWidth || '';
        sidePanel.style.height = sidePanel.dataset.prevHeight || '';
        sidePanel.dataset.collapsed = '0';
        panelCollapseBtn.textContent = '↔';
        panelCollapseBtn.title = 'Свернуть';
        panelCollapseBtn.setAttribute('aria-label', 'Свернуть панель');
        panelCollapseBtn.setAttribute('aria-expanded', 'true');
    }
    saveState();
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
function escapeHtml(s) {
    if (!s && s !== 0) return '';
    return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function init() {
    loadState();
    initSetupForm();
    updateTimerUI();
    updateAIPreview();

    const root = byId('root');
    if (root) {
        makeDraggable(root);
        setupNodeButtons(root);
        const t = root.querySelector('.title');
        if (t) t.addEventListener('input', () => { updateAIPreview(); saveState(); });
    }

    canvasContent.addEventListener('dblclick', e => {
        const target = e.target;
        if (target.closest('.node') || target.closest('.add-btn') || target.closest('.remove-btn')) return;

        const rect = canvasContent.getBoundingClientRect();
        const x = e.clientX - rect.left - LAYOUT_CONFIG.NODE_WIDTH / 2;
        const y = e.clientY - rect.top - LAYOUT_CONFIG.NODE_HEIGHT / 2;

        createNode(x, y, 'Новый исход');
    });

    document.addEventListener('input', e => {
        if (e.target.classList.contains('title')) {
            updateAIPreview();
            saveState();
        }
    });

    setInterval(() => {
        fixProConPositions();
    }, 5000);

    setInterval(saveState, 30000);

    window.addEventListener('beforeunload', () => {
        if (renderConnections._frame) {
            cancelAnimationFrame(renderConnections._frame);
        }
    });

    window.addEventListener('resize', () => {
        if (!sidePanel.style.left) return;
        const left = parseFloat(sidePanel.style.left) || 0;
        const top = parseFloat(sidePanel.style.top) || 0;
        const editor = document.getElementById('editorPage');
        const editorRect = editor ? editor.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
        const w = sidePanel.offsetWidth || 320;
        const h = sidePanel.offsetHeight || 200;
        const tail = 60;
        sidePanel.style.left = Math.min(Math.max(left, -(w - tail)), editorRect.width - tail) + 'px';
        sidePanel.style.top = Math.min(Math.max(top, 0), Math.max(0, editorRect.height - tail)) + 'px';
    });
}

window.parseProsConsFromText = parseProsConsFromText;
window.lifeAnalysisFromItem = lifeAnalysisFromItem;
window.createProConNodesForOutcome = createProConNodesForOutcome;
window.collectTreeText = collectTreeText;
window.collectFormData = collectFormData;
window.buildTreeFromForm = buildTreeFromForm;
window.syncFormFromCanvas = syncFormFromCanvas;
window.getOutcomeNodes = getOutcomeNodes;
window.setLock = setLock;
window.relayoutAllProConTrees = relayoutAllProConTrees;
window.layoutOutcomeColumns = layoutOutcomeColumns;
window.scheduleFinalAiLayout = scheduleFinalAiLayout;

init();