// =========================================================
// WHITEBOARD HOME CANVAS + FLOATING/FULLSCREEN WINDOW OS
// =========================================================
const WhiteboardOS = (() => {
    const WORLD_W = 2000;
    const WORLD_H = 2000;
    const MIN_SCALE = 0.35;
    const MAX_SCALE = 2.2;
    const DOUBLE_TAP_DELAY = 380;

    // DOM Elements
    const viewport = document.getElementById('whiteboard-viewport');
    const canvasWorld = document.getElementById('canvas-world');
    const inkCanvas = document.getElementById('ink-canvas');
    const inkCtx = inkCanvas.getContext('2d');
    const iconsLayer = document.getElementById('canvas-icons');
    const windowsLayer = document.getElementById('canvas-windows');
    const fullscreenHost = document.getElementById('fullscreen-host');
    const zoomBadge = document.getElementById('zoom-badge');
    const activeWinBadge = document.getElementById('active-win-badge');
    const toast = document.getElementById('toast');

    // Camera State
    let camScale = 1.0;
    let camX = 0;
    let camY = 0;

    // Whiteboard Tool State
    let currentTool = 'select'; // 'select' | 'pen' | 'eraser'
    let currentInkColor = '#202124';
    let isDrawingStroke = false;
    let lastDrawWorldX = 0;
    let lastDrawWorldY = 0;

    // App Icons & Floating Windows State
    const appRegistry = new Map();
    const openWindows = new Map();
    let topZIndex = 40;
    let focusedWindowId = null;

    // Active Hold-Drag Target
    let dragMode = null; // 'icon' | 'win-move' | 'win-resize' | 'draw' | 'sheets' | null
    let dragTarget = null;
    let selectedIconId = null;

    // Double-Tap Tracking
    let lastTapTime = 0;
    let lastTapTarget = null;

    let toastTimer = null;

    // --- 1. TOAST & CAMERA MATH ---
    function showToast(msg) {
        toast.innerText = msg;
        toast.style.opacity = 1;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.style.opacity = 0, 1400);
    }

    function clampCamera() {
        const vw = viewport.clientWidth;
        const vh = viewport.clientHeight;
        const scaledW = WORLD_W * camScale;
        const scaledH = WORLD_H * camScale;
        const margin = 80;

        if (scaledW <= vw) {
            camX = (vw - scaledW) / 2;
        } else {
            camX = Math.max(vw - scaledW - margin, Math.min(margin, camX));
        }

        if (scaledH <= vh) {
            camY = (vh - scaledH) / 2;
        } else {
            camY = Math.max(vh - scaledH - margin, Math.min(margin, camY));
        }
    }

    function renderCamera() {
        clampCamera();
        canvasWorld.style.transform = `translate(${camX}px, ${camY}px) scale(${camScale})`;
        zoomBadge.innerText = `${Math.round(camScale * 100)}%`;
        SheetsApp.onLayoutChanged();
    }

    function centerCamera() {
        camScale = 1.0;
        const vw = viewport.clientWidth;
        const vh = viewport.clientHeight;
        camX = (vw - WORLD_W) / 2;
        camY = (vh - WORLD_H) / 2;
        renderCamera();
    }

    function screenToWorld(screenX, screenY) {
        const rect = viewport.getBoundingClientRect();
        return {
            x: (screenX - rect.left - camX) / camScale,
            y: (screenY - rect.top - camY) / camScale
        };
    }

    function panCamera(dx, dy) {
        camX += dx;
        camY += dy;
        renderCamera();
    }

    function zoomAndPanCamera(dx, dy, factor, pivotScreenX, pivotScreenY) {
        const rect = viewport.getBoundingClientRect();
        const px = pivotScreenX - rect.left;
        const py = pivotScreenY - rect.top;

        const worldPx = (px - camX) / camScale;
        const worldPy = (py - camY) / camScale;

        camScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, camScale * factor));
        camX = px - worldPx * camScale + dx * 1.3;
        camY = py - worldPy * camScale + dy * 1.3;
        renderCamera();
    }

    // --- 2. STARTER WHITEBOARD APPS ---
    const initialApps = [
        { id: 'sheets', title: 'Sheets', icon: '📊', bg: '#0f9d58', x: 880,  y: 860, w: 350, h: 420 },
        { id: 'notes',  title: 'Notes',  icon: '📝', bg: '#fbbc04', x: 990,  y: 860, w: 300, h: 280 },
        { id: 'sketch', title: 'Board',  icon: '🎨', bg: '#1a73e8', x: 1100, y: 860, w: 300, h: 260 }
    ];

    function buildAppIcons() {
        iconsLayer.innerHTML = '';
        initialApps.forEach(app => {
            appRegistry.set(app.id, { ...app });

            const el = document.createElement('div');
            el.className = 'wb-app-icon';
            el.dataset.appId = app.id;
            el.style.left = `${app.x}px`;
            el.style.top = `${app.y}px`;
            el.innerHTML = `
                <div class="wb-icon-tile" style="background:${app.bg};">${app.icon}</div>
                <div class="wb-icon-label">${app.title}</div>
            `;
            iconsLayer.appendChild(el);
        });
    }

    function selectIcon(appId) {
        selectedIconId = appId;
        document.querySelectorAll('.wb-app-icon').forEach(el => {
            el.classList.toggle('selected', el.dataset.appId === appId);
        });
    }

    // --- 3. FLOATING ↔ FULLSCREEN WINDOW MANAGER ---
    function focusWindow(appId) {
        focusedWindowId = appId;
        topZIndex++;
        openWindows.forEach((win, id) => {
            const isFocused = id === appId;
            win.el.classList.toggle('focused', isFocused);
            if (isFocused && !win.isFullscreen) {
                win.el.style.zIndex = topZIndex;
            }
        });
        const active = openWindows.get(appId);
        activeWinBadge.innerText = active
            ? `${active.icon} ${active.title}${active.isFullscreen ? ' (Full)' : ''}`
            : 'Home';
    }

    function openAppWindow(appId) {
        if (openWindows.has(appId)) {
            focusWindow(appId);
            showToast(`Focused ${openWindows.get(appId).title}`);
            return;
        }

        const app = appRegistry.get(appId);
        if (!app) return;

        const rect = viewport.getBoundingClientRect();
        const centerWorld = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const startX = Math.max(20, Math.min(WORLD_W - app.w - 20, centerWorld.x - app.w / 2));
        const startY = Math.max(20, Math.min(WORLD_H - app.h - 20, centerWorld.y - app.h / 2));

        const winEl = document.createElement('div');
        winEl.className = 'app-window';
        winEl.dataset.winId = appId;
        winEl.style.left = `${startX}px`;
        winEl.style.top = `${startY}px`;
        winEl.style.width = `${app.w}px`;
        winEl.style.height = `${app.h}px`;
        winEl.style.zIndex = ++topZIndex;

        winEl.innerHTML = `
            <div class="win-titlebar" data-win-id="${appId}">
                <div class="win-title">${app.icon} ${app.title}</div>
                <div class="win-actions">
                    <div class="win-btn" data-win-action="fullscreen" data-win-id="${appId}" title="Fullscreen">⛶</div>
                    <div class="win-btn close-btn" data-win-action="close" data-win-id="${appId}" title="Close">✕</div>
                </div>
            </div>
            <div class="win-body" id="win-body-${appId}"></div>
            <div class="win-resize-handle" data-win-resize="${appId}"></div>
        `;

        const bodyEl = winEl.querySelector('.win-body');
        windowsLayer.appendChild(winEl);
        mountAppBody(appId, bodyEl);

        const winObj = {
            id: appId,
            title: app.title,
            icon: app.icon,
            x: startX,
            y: startY,
            w: app.w,
            h: app.h,
            isFullscreen: false,
            el: winEl,
            bodyEl
        };
        openWindows.set(appId, winObj);
        focusWindow(appId);
        showToast(`Opened ${app.title} on Whiteboard`);
    }

    function mountAppBody(appId, bodyEl) {
        if (appId === 'sheets') {
            SheetsApp.mount(bodyEl, { showToast });
        } else if (appId === 'notes') {
            bodyEl.innerHTML = `
                <div class="demo-app-scroll">
                    <div class="demo-card">
                        <h4>📝 Whiteboard Notes</h4>
                        <p style="margin:0;">Ready for Batch 3! Next we can turn this into a live Chorded Keyboard Notes app.</p>
                    </div>
                    <div class="demo-card">
                        <h4>Gesture Guide</h4>
                        <p style="margin:0;">• 1F Tap / Double-Tap = Select / Chord Input<br>• 1F Hold + Drag = Move Icons, Cells, or Windows<br>• 2F Drag = Scroll Sheet or Pan Board<br>• 2F Quick Tap = Cell Context Menu<br>• 3F Pinch = Zoom Board (or Zoom Sheet in Full Screen)<br>• 4F Quick Tap = Toggle Full Screen<br>• 5F Drag = Move Touchpad</p>
                    </div>
                </div>
            `;
        } else {
            bodyEl.innerHTML = `
                <div class="demo-app-scroll">
                    <div class="demo-card">
                        <h4>🎨 Whiteboard Tips</h4>
                        <p style="margin:0;">Select <b>✏️ Pen</b> in the bottom dock, hold 1 finger briefly on the touchpad (160ms), and doodle anywhere around your floating Sheets window!</p>
                    </div>
                </div>
            `;
        }
    }

    function toggleWindowFullscreen(appId) {
        const win = openWindows.get(appId);
        if (!win) return;

        win.isFullscreen = !win.isFullscreen;
        const fsBtn = win.el.querySelector('[data-win-action="fullscreen"]');

        if (win.isFullscreen) {
            openWindows.forEach((other, otherId) => {
                if (otherId !== appId && other.isFullscreen) {
                    other.isFullscreen = false;
                    other.el.classList.remove('is-fullscreen');
                    windowsLayer.appendChild(other.el);
                }
            });
            win.el.classList.add('is-fullscreen');
            fullscreenHost.appendChild(win.el);
            if (fsBtn) fsBtn.innerText = '🗗';
            showToast(`⛶ ${win.title} Full Screen`);
        } else {
            win.el.classList.remove('is-fullscreen');
            win.el.style.left = `${win.x}px`;
            win.el.style.top = `${win.y}px`;
            win.el.style.width = `${win.w}px`;
            win.el.style.height = `${win.h}px`;
            windowsLayer.appendChild(win.el);
            if (fsBtn) fsBtn.innerText = '⛶';
            showToast(`🗗 Returned ${win.title} to Whiteboard`);
        }

        focusWindow(appId);
        if (appId === 'sheets') {
            requestAnimationFrame(() => SheetsApp.onLayoutChanged());
        }
    }

    function closeAppWindow(appId) {
        const win = openWindows.get(appId);
        if (!win) return;
        if (appId === 'sheets') SheetsApp.unmount();
        win.el.remove();
        openWindows.delete(appId);
        focusedWindowId = null;
        activeWinBadge.innerText = 'Home';
        showToast(`Closed ${win.title}`);
    }

    function hasFullscreenWindow() {
        for (const win of openWindows.values()) {
            if (win.isFullscreen) return win;
        }
        return null;
    }

    // --- 4. DOODLING ENGINE ---
    function setTool(tool) {
        currentTool = tool;
        document.querySelectorAll('.dock-btn[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
        Touchpad.setHoldDelay(tool === 'select' ? 320 : 160);
        showToast(tool === 'select' ? '↖ Select Mode' : tool === 'pen' ? '✏️ Pen Mode' : '🧽 Eraser Mode');
    }

    function setInkColor(color) {
        currentInkColor = color;
        document.querySelectorAll('.ink-swatch').forEach(sw => {
            sw.classList.toggle('active', sw.dataset.color === color);
        });
        if (currentTool !== 'pen') setTool('pen');
    }

    function clearInkCanvas() {
        inkCtx.clearRect(0, 0, WORLD_W, WORLD_H);
        showToast('🗑️ Cleared Whiteboard Ink');
    }

    function beginInkStroke(screenX, screenY) {
        const pt = screenToWorld(screenX, screenY);
        isDrawingStroke = true;
        lastDrawWorldX = pt.x;
        lastDrawWorldY = pt.y;

        inkCtx.save();
        if (currentTool === 'eraser') {
            inkCtx.globalCompositeOperation = 'destination-out';
            inkCtx.beginPath();
            inkCtx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
            inkCtx.fill();
        } else {
            inkCtx.globalCompositeOperation = 'source-over';
            inkCtx.fillStyle = currentInkColor;
            inkCtx.beginPath();
            inkCtx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
            inkCtx.fill();
        }
        inkCtx.restore();
    }

    function extendInkStroke(screenX, screenY) {
        if (!isDrawingStroke) return;
        const pt = screenToWorld(screenX, screenY);

        inkCtx.save();
        inkCtx.lineCap = 'round';
        inkCtx.lineJoin = 'round';
        if (currentTool === 'eraser') {
            inkCtx.globalCompositeOperation = 'destination-out';
            inkCtx.lineWidth = 28;
        } else {
            inkCtx.globalCompositeOperation = 'source-over';
            inkCtx.strokeStyle = currentInkColor;
            inkCtx.lineWidth = 4.5;
        }
        inkCtx.beginPath();
        inkCtx.moveTo(lastDrawWorldX, lastDrawWorldY);
        inkCtx.lineTo(pt.x, pt.y);
        inkCtx.stroke();
        inkCtx.restore();

        lastDrawWorldX = pt.x;
        lastDrawWorldY = pt.y;
    }

    function endInkStroke() {
        isDrawingStroke = false;
    }

    // --- 5. TOUCHPAD EVENT ROUTING ---
    function handleTap(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el) return;

        // 1. Floating Chorded Keyboard Buttons (Space, Backspace, 123, Done)
        if (ChordKeyboard.handleButtonElementClick(el)) return;

        // 2. Sheets Context Menu Overlay
        if (el.closest('#context-menu')) {
            SheetsApp.handleTap(el, x, y);
            return;
        } else {
            SheetsApp.hideContextMenu();
        }

        // 3. OS Top Bar Buttons
        const osBtn = el.closest('[data-os-action]');
        if (osBtn) {
            const action = osBtn.dataset.osAction;
            if (action === 'reset-view') { centerCamera(); showToast('⌖ Centered Whiteboard'); }
            if (action === 'toggle-pad-controls') Touchpad.toggleControlsPanel();
            return;
        }

        // 4. Bottom Tool Dock
        const dockTool = el.closest('.dock-btn[data-tool]');
        if (dockTool) { setTool(dockTool.dataset.tool); return; }

        const dockAction = el.closest('.dock-btn[data-action]');
        if (dockAction) {
            if (dockAction.dataset.action === 'clear-ink') clearInkCanvas();
            return;
        }

        const swatch = el.closest('.ink-swatch');
        if (swatch) { setInkColor(swatch.dataset.color); return; }

        // 5. Window Action Buttons (Fullscreen / Close)
        const winBtn = el.closest('[data-win-action]');
        if (winBtn) {
            const action = winBtn.dataset.winAction;
            const winId = winBtn.dataset.winId;
            if (action === 'fullscreen') toggleWindowFullscreen(winId);
            if (action === 'close') closeAppWindow(winId);
            return;
        }

        // 6. Double-Tap Window Title Bar -> Toggle Fullscreen
        const titleBar = el.closest('.win-titlebar');
        if (titleBar) {
            const winId = titleBar.dataset.winId;
            focusWindow(winId);
            const now = Date.now();
            if (lastTapTarget === titleBar && (now - lastTapTime) < DOUBLE_TAP_DELAY) {
                toggleWindowFullscreen(winId);
                lastTapTarget = null;
                lastTapTime = 0;
            } else {
                lastTapTarget = titleBar;
                lastTapTime = now;
            }
            return;
        }

        // 7. Inside Sheets Window Body
        if (el.closest('#win-body-sheets')) {
            focusWindow('sheets');
            SheetsApp.handleTap(el, x, y);
            return;
        }

        // 8. Inside Any Other Open Window
        const winEl = el.closest('.app-window');
        if (winEl) {
            focusWindow(winEl.dataset.winId);
            return;
        }

        // 9. App Icons on Whiteboard (Single Tap = Select, Double Tap = Open)
        const iconEl = el.closest('.wb-app-icon');
        if (iconEl) {
            const appId = iconEl.dataset.appId;
            const now = Date.now();
            if (lastTapTarget === iconEl && (now - lastTapTime) < DOUBLE_TAP_DELAY) {
                openAppWindow(appId);
                lastTapTarget = null;
                lastTapTime = 0;
            } else {
                selectIcon(appId);
                lastTapTarget = iconEl;
                lastTapTime = now;
            }
            return;
        }

        // 10. Open Whiteboard Tap
        selectIcon(null);
        if (currentTool === 'pen' || currentTool === 'eraser') {
            beginInkStroke(x, y);
            endInkStroke();
        }
    }

    function handleHoldStart(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el) return;

        // 1. Resize Handle on a Floating Window
        const resizeEl = el.closest('[data-win-resize]');
        if (resizeEl) {
            const win = openWindows.get(resizeEl.dataset.winResize);
            if (win && !win.isFullscreen) {
                focusWindow(win.id);
                dragMode = 'win-resize';
                dragTarget = win;
                Touchpad.setCursorMode('drag');
                return;
            }
        }

        // 2. Title Bar on a Floating Window -> Drag Window
        const titleBar = el.closest('.win-titlebar');
        if (titleBar) {
            const win = openWindows.get(titleBar.dataset.winId);
            if (win && !win.isFullscreen) {
                focusWindow(win.id);
                dragMode = 'win-move';
                dragTarget = win;
                Touchpad.setCursorMode('drag');
                return;
            }
        }

        // 3. Inside Sheets Window -> Cell Move or Fill-Handle Drag
        if (el.closest('#win-body-sheets')) {
            focusWindow('sheets');
            if (SheetsApp.handleHoldStart(el, x, y)) {
                dragMode = 'sheets';
                Touchpad.setCursorMode('drag');
                return;
            }
        }

        // 4. Pen / Eraser Mode on Open Whiteboard
        if ((currentTool === 'pen' || currentTool === 'eraser') && !el.closest('.app-window, #tool-dock, #top-bar, #context-menu')) {
            dragMode = 'draw';
            Touchpad.setCursorMode('draw');
            beginInkStroke(x, y);
            return;
        }

        // 5. Dragging an App Icon on Whiteboard
        const iconEl = el.closest('.wb-app-icon');
        if (iconEl) {
            const appId = iconEl.dataset.appId;
            selectIcon(appId);
            iconEl.classList.add('dragging');
            dragMode = 'icon';
            dragTarget = { app: appRegistry.get(appId), el: iconEl };
            Touchpad.setCursorMode('drag');
        }
    }

    function handleHoldMove(x, y, dx, dy) {
        if (dragMode === 'sheets') {
            SheetsApp.handleHoldMove(x, y);
            return;
        }

        if (dragMode === 'draw') {
            extendInkStroke(x, y);
            return;
        }

        if (dragMode === 'icon' && dragTarget) {
            dragTarget.app.x = Math.max(10, Math.min(WORLD_W - 92, dragTarget.app.x + dx / camScale));
            dragTarget.app.y = Math.max(10, Math.min(WORLD_H - 96, dragTarget.app.y + dy / camScale));
            dragTarget.el.style.left = `${dragTarget.app.x}px`;
            dragTarget.el.style.top = `${dragTarget.app.y}px`;
            return;
        }

        if (dragMode === 'win-move' && dragTarget) {
            dragTarget.x = Math.max(10, Math.min(WORLD_W - dragTarget.w - 10, dragTarget.x + dx / camScale));
            dragTarget.y = Math.max(10, Math.min(WORLD_H - dragTarget.h - 10, dragTarget.y + dy / camScale));
            dragTarget.el.style.left = `${dragTarget.x}px`;
            dragTarget.el.style.top = `${dragTarget.y}px`;
            if (dragTarget.id === 'sheets') SheetsApp.onLayoutChanged();
            return;
        }

        if (dragMode === 'win-resize' && dragTarget) {
            dragTarget.w = Math.max(240, Math.min(900, dragTarget.w + dx / camScale));
            dragTarget.h = Math.max(220, Math.min(820, dragTarget.h + dy / camScale));
            dragTarget.el.style.width = `${dragTarget.w}px`;
            dragTarget.el.style.height = `${dragTarget.h}px`;
            if (dragTarget.id === 'sheets') SheetsApp.onLayoutChanged();
        }
    }

    function handleHoldEnd() {
        if (dragMode === 'sheets') {
            SheetsApp.handleHoldEnd();
        } else if (dragMode === 'draw') {
            endInkStroke();
        } else if (dragMode === 'icon' && dragTarget) {
            dragTarget.el.classList.remove('dragging');
        }
        dragMode = null;
        dragTarget = null;
    }

    function handleTwoFingerTap(cursorX, cursorY) {
        const el = document.elementFromPoint(cursorX, cursorY);
        if (el && SheetsApp.handleTwoFingerTap(el, cursorX, cursorY)) {
            focusWindow('sheets');
        }
    }

    function handleTwoFingerScroll(dx, dy, cursorX, cursorY) {
        const el = document.elementFromPoint(cursorX, cursorY);
        if (el && SheetsApp.handleScroll(dx, dy, el)) return;

        const scrollArea = el ? el.closest('.demo-app-scroll') : null;
        if (scrollArea) {
            scrollArea.scrollLeft -= dx * 1.5;
            scrollArea.scrollTop -= dy * 1.5;
            return;
        }

        if (!hasFullscreenWindow()) {
            panCamera(dx * 1.5, dy * 1.5);
        }
    }

    function handleThreeFingerZoomPan(dx, dy, zoomFactor, cursorX, cursorY) {
        const fsWin = hasFullscreenWindow();
        if (fsWin) {
            if (fsWin.id === 'sheets') {
                SheetsApp.handleZoomPan(dx, dy, zoomFactor);
            }
            return;
        }
        zoomAndPanCamera(dx, dy, zoomFactor, cursorX, cursorY);
    }

    function handleFourFingerTap() {
        if (focusedWindowId && openWindows.has(focusedWindowId)) {
            toggleWindowFullscreen(focusedWindowId);
        } else {
            centerCamera();
            showToast('⌖ Centered Whiteboard');
        }
    }

    function handleUnlatchedTouch(unlatchedTouches) {
        if (SheetsApp.isEditing()) {
            ChordKeyboard.handleTouch(unlatchedTouches);
        }
    }

    // --- 6. BOOTSTRAP ---
    buildAppIcons();
    centerCamera();

    window.addEventListener('resize', renderCamera);

    Touchpad.init({
        onTap: handleTap,
        onHoldStart: handleHoldStart,
        onHoldMove: handleHoldMove,
        onHoldEnd: handleHoldEnd,
        onTwoFingerTap: handleTwoFingerTap,
        onTwoFingerScroll: handleTwoFingerScroll,
        onThreeFingerZoomPan: handleThreeFingerZoomPan,
        onFourFingerTap: handleFourFingerTap,
        onUnlatchedTouch: handleUnlatchedTouch
    });

    return {
        openAppWindow,
        toggleWindowFullscreen,
        showToast
    };
})();