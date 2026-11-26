// =========================================================
// GOOGLE SHEETS CLONE APP MODULE (FLOATING & FULLSCREEN)
// =========================================================
const SheetsApp = (() => {
    const COLS = 12; // A to L
    const ROWS = 35; // 1 to 35
    const DOUBLE_TAP_DELAY = 380;

    // Persistent Cell Store (survives closing/reopening the Sheets window)
    const cellStore = new Map();
    let storeInitialized = false;

    // Mounted DOM References
    let rootEl = null;
    let viewportEl = null;
    let tableEl = null;
    let cellBadgeEl = null;
    let formulaInputEl = null;
    let fillHandleEl = null;

    // Shared OS-Level Overlay Elements
    const dragGhostEl = document.getElementById('drag-ghost');
    const contextMenuEl = document.getElementById('context-menu');

    // Runtime State
    let hostShowToast = () => {};
    let selectedCell = null;
    let editingCell = null;
    let clipboard = null;
    let sheetScale = 1.0;

    // Cell Drag / Fill-Range State
    let isDraggingCell = false;
    let isFillingRange = false;
    let draggedSourceCell = null;
    let currentDropTarget = null;

    // Double-Tap Tracking
    let lastTapTime = 0;
    let lastTappedCell = null;

    function colName(index) {
        return String.fromCharCode(65 + index);
    }

    function initStarterStore() {
        if (storeInitialized) return;
        storeInitialized = true;
        const starter = {
            'A1': { text: 'Expense', bold: true, bg: '#e8f0fe' },
            'B1': { text: 'Cost', bold: true, bg: '#e8f0fe' },
            'C1': { text: 'Status', bold: true, bg: '#e8f0fe' },
            'A2': { text: 'esp32', bold: false, bg: '#ffffff' },
            'B2': { text: '12', bold: false, bg: '#ffffff' },
            'C2': { text: 'paid', bold: false, bg: '#d4edda' },
            'A3': { text: 'switches', bold: false, bg: '#ffffff' },
            'B3': { text: '8', bold: false, bg: '#ffffff' },
            'C3': { text: 'paid', bold: false, bg: '#d4edda' },
            'A4': { text: 'battery', bold: false, bg: '#ffffff' },
            'B4': { text: '15', bold: false, bg: '#ffffff' },
            'C4': { text: 'pending', bold: false, bg: '#fff3cd' },
            'A5': { text: 'Total', bold: true, bg: '#f1f3f4' },
            'B5': { text: '35', bold: true, bg: '#f1f3f4' }
        };
        Object.entries(starter).forEach(([addr, data]) => {
            cellStore.set(addr, { ...data });
        });
    }

    function saveCellToStore(cell) {
        if (!cell) return;
        const addr = cell.dataset.address;
        cellStore.set(addr, {
            text: cell.dataset.value || '',
            bold: cell.style.fontWeight === 'bold',
            bg: cell.style.backgroundColor || '#ffffff'
        });
    }

    function setCellText(cell, text) {
        if (!cell) return;
        cell.dataset.value = text;
        if (editingCell !== cell) {
            cell.textContent = text;
            if (selectedCell === cell && fillHandleEl) {
                cell.appendChild(fillHandleEl);
            }
        }
        saveCellToStore(cell);
    }

    function getCellText(cell) {
        return cell ? (cell.dataset.value || '') : '';
    }

    function updateFillHandlePosition() {
        if (!fillHandleEl) return;
        if (!selectedCell || editingCell) {
            fillHandleEl.style.display = 'none';
            return;
        }
        fillHandleEl.style.display = 'block';
        selectedCell.appendChild(fillHandleEl);
    }

    // --- MOUNT / UNMOUNT ---
    function mount(containerEl, { showToast } = {}) {
        initStarterStore();
        hostShowToast = showToast || (() => {});

        containerEl.innerHTML = `
            <div class="sheets-app-root">
                <div class="sheets-toolbar">
                    <div class="sheet-btn" data-sheet-action="edit">✏️ Chord</div>
                    <div class="sheet-btn" data-sheet-action="bold"><b>B</b></div>
                    <div class="sheet-btn" data-sheet-action="sum">∑ Sum</div>
                    <div class="sheet-btn" data-sheet-action="clear">🗑️</div>
                    <div class="sheet-btn" data-sheet-action="reset-zoom">🔍 100%</div>
                </div>
                <div class="sheets-formula-row">
                    <div class="sheets-cell-badge">A1</div>
                    <span class="sheets-fx-label">fx</span>
                    <input type="text" class="sheets-formula-input" placeholder="Double-tap cell for Chord Input..." readonly />
                </div>
                <div class="sheets-viewport">
                    <table class="sheets-table">
                        <thead></thead>
                        <tbody></tbody>
                    </table>
                    <div class="sheets-fill-handle"></div>
                </div>
            </div>
        `;

        rootEl = containerEl.querySelector('.sheets-app-root');
        viewportEl = containerEl.querySelector('.sheets-viewport');
        tableEl = containerEl.querySelector('.sheets-table');
        cellBadgeEl = containerEl.querySelector('.sheets-cell-badge');
        formulaInputEl = containerEl.querySelector('.sheets-formula-input');
        fillHandleEl = containerEl.querySelector('.sheets-fill-handle');

        const thead = tableEl.querySelector('thead');
        const tbody = tableEl.querySelector('tbody');

        // Build Column Headers
        const headRow = document.createElement('tr');
        const cornerTh = document.createElement('th');
        cornerTh.className = 'corner-header';
        headRow.appendChild(cornerTh);

        for (let c = 0; c < COLS; c++) {
            const th = document.createElement('th');
            th.innerText = colName(c);
            th.dataset.colHeader = c;
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);

        // Build Data Rows
        for (let r = 1; r <= ROWS; r++) {
            const tr = document.createElement('tr');
            const rowTh = document.createElement('th');
            rowTh.innerText = r;
            rowTh.dataset.rowHeader = r;
            tr.appendChild(rowTh);

            for (let c = 0; c < COLS; c++) {
                const td = document.createElement('td');
                const addr = `${colName(c)}${r}`;
                td.className = 'cell';
                td.dataset.row = r;
                td.dataset.col = c;
                td.dataset.address = addr;
                td.dataset.value = '';

                const saved = cellStore.get(addr);
                if (saved) {
                    td.style.fontWeight = saved.bold ? 'bold' : 'normal';
                    td.style.backgroundColor = saved.bg || '#ffffff';
                    td.dataset.value = saved.text || '';
                    td.textContent = saved.text || '';
                }
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }

        tableEl.style.zoom = sheetScale;

        ChordKeyboard.init({
            onTextChange(newVal) {
                if (editingCell) {
                    editingCell.dataset.value = newVal;
                    if (formulaInputEl) formulaInputEl.value = newVal;
                    saveCellToStore(editingCell);
                }
            },
            onDone() {
                finishEditing();
            },
            onToast(msg) {
                hostShowToast(msg);
            }
        });

        selectCell(tableEl.querySelector('td.cell[data-address="A1"]'));
    }

    function unmount() {
        if (editingCell) finishEditing();
        hideContextMenu();
        if (dragGhostEl) dragGhostEl.style.display = 'none';

        isDraggingCell = false;
        isFillingRange = false;
        draggedSourceCell = null;
        currentDropTarget = null;
        selectedCell = null;
        rootEl = null;
        viewportEl = null;
        tableEl = null;
        cellBadgeEl = null;
        formulaInputEl = null;
        fillHandleEl = null;
    }

    // --- SELECTION & CHORD INPUT ---
    function selectCell(cell) {
        if (!cell || !tableEl) return;
        if (editingCell && editingCell !== cell) {
            finishEditing();
        }

        tableEl.querySelectorAll('td.cell.selected').forEach(el => el.classList.remove('selected'));
        tableEl.querySelectorAll('th.active-header').forEach(el => el.classList.remove('active-header'));

        selectedCell = cell;
        selectedCell.classList.add('selected');

        const r = selectedCell.dataset.row;
        const c = selectedCell.dataset.col;
        tableEl.querySelector(`th[data-col-header="${c}"]`)?.classList.add('active-header');
        tableEl.querySelector(`th[data-row-header="${r}"]`)?.classList.add('active-header');

        if (cellBadgeEl) cellBadgeEl.innerText = selectedCell.dataset.address;
        if (formulaInputEl) formulaInputEl.value = getCellText(selectedCell);
        updateFillHandlePosition();
    }

    function startEditing(cell) {
        if (!cell) return;
        selectCell(cell);
        editingCell = cell;
        editingCell.classList.add('editing-cell');
        if (formulaInputEl) formulaInputEl.classList.add('editing');
        if (fillHandleEl) fillHandleEl.style.display = 'none';

        ChordKeyboard.open(editingCell, getCellText(editingCell));
        hostShowToast(`🎹 Chord Input: ${cell.dataset.address}`);
    }

    function finishEditing() {
        if (!editingCell) return;
        const cellToSave = editingCell;
        const finalVal = ChordKeyboard.close();

        cellToSave.classList.remove('editing-cell');
        if (formulaInputEl) formulaInputEl.classList.remove('editing');
        editingCell = null;

        setCellText(cellToSave, finalVal);
        if (formulaInputEl) formulaInputEl.value = finalVal;
        updateFillHandlePosition();
        hostShowToast(`✔ Saved ${cellToSave.dataset.address}`);
    }

    function hideContextMenu() {
        if (contextMenuEl) contextMenuEl.style.display = 'none';
    }

    // --- TOUCHPAD EVENT HANDLERS ---
    function handleTap(el, x, y) {
        if (!el) return false;

        // 1. Context Menu Click
        const menuItem = el.closest('#context-menu .menu-item');
        const swatch = el.closest('#context-menu .color-swatch');
        if (menuItem || swatch) {
            handleContextMenuClick(menuItem, swatch);
            return true;
        }

        if (!rootEl || !rootEl.contains(el)) return false;

        // 2. Sheets Toolbar Button
        const toolBtn = el.closest('.sheet-btn');
        if (toolBtn) {
            handleToolbarAction(toolBtn.dataset.sheetAction);
            return true;
        }

        // 3. Spreadsheet Cell (Single Tap = Select, Double Tap = Chord Keyboard)
        const cellHit = el.closest('td.cell');
        if (cellHit) {
            const now = Date.now();
            if (lastTappedCell === cellHit && (now - lastTapTime) < DOUBLE_TAP_DELAY) {
                startEditing(cellHit);
                lastTapTime = 0;
                lastTappedCell = null;
            } else {
                if (!ChordKeyboard.isPointInsideWheel(x, y)) {
                    selectCell(cellHit);
                }
                lastTapTime = now;
                lastTappedCell = cellHit;
            }
            return true;
        }

        return false;
    }

    function handleHoldStart(el, x, y) {
        if (!rootEl || editingCell || !el || !rootEl.contains(el)) return false;

        // 1. Blue Fill Handle
        if (el === fillHandleEl) {
            isFillingRange = true;
            hostShowToast('🟦 Drag to Fill Range');
            return true;
        }

        // 2. Drag Cell Contents
        const cellHit = el.closest('td.cell');
        if (cellHit) {
            selectCell(cellHit);
            isDraggingCell = true;
            draggedSourceCell = cellHit;
            dragGhostEl.innerText = getCellText(cellHit) || cellHit.dataset.address;
            dragGhostEl.style.left = `${x}px`;
            dragGhostEl.style.top = `${y}px`;
            dragGhostEl.style.display = 'flex';
            hostShowToast(`📦 Dragging ${cellHit.dataset.address}`);
            return true;
        }

        return false;
    }

    function handleHoldMove(x, y) {
        if (isDraggingCell && draggedSourceCell) {
            dragGhostEl.style.left = `${x}px`;
            dragGhostEl.style.top = `${y}px`;

            const elUnder = document.elementFromPoint(x, y);
            const cellUnder = elUnder ? elUnder.closest('td.cell') : null;

            if (currentDropTarget && currentDropTarget !== cellUnder) {
                currentDropTarget.classList.remove('drop-target');
            }
            if (cellUnder && cellUnder !== draggedSourceCell && rootEl.contains(cellUnder)) {
                currentDropTarget = cellUnder;
                currentDropTarget.classList.add('drop-target');
            } else {
                currentDropTarget = null;
            }
            return true;
        }

        if (isFillingRange && selectedCell) {
            const elUnder = document.elementFromPoint(x, y);
            const cellUnder = elUnder ? elUnder.closest('td.cell') : null;
            if (cellUnder && rootEl.contains(cellUnder)) {
                highlightFillRange(selectedCell, cellUnder);
            }
            return true;
        }

        return false;
    }

    function handleHoldEnd() {
        if (!isDraggingCell && !isFillingRange) return false;

        if (isDraggingCell && draggedSourceCell) {
            if (currentDropTarget && currentDropTarget !== draggedSourceCell) {
                currentDropTarget.style.backgroundColor = draggedSourceCell.style.backgroundColor;
                currentDropTarget.style.fontWeight = draggedSourceCell.style.fontWeight;
                setCellText(currentDropTarget, getCellText(draggedSourceCell));

                draggedSourceCell.style.backgroundColor = '#ffffff';
                draggedSourceCell.style.fontWeight = 'normal';
                setCellText(draggedSourceCell, '');

                currentDropTarget.classList.remove('drop-target');
                selectCell(currentDropTarget);
                hostShowToast(`📦 Moved to ${currentDropTarget.dataset.address}`);
            }
            if (currentDropTarget) currentDropTarget.classList.remove('drop-target');
            dragGhostEl.style.display = 'none';
        } else if (isFillingRange && selectedCell && tableEl) {
            const fillCells = tableEl.querySelectorAll('td.cell.fill-range');
            const srcText = getCellText(selectedCell);
            fillCells.forEach(c => {
                c.style.backgroundColor = selectedCell.style.backgroundColor;
                c.style.fontWeight = selectedCell.style.fontWeight;
                setCellText(c, srcText);
                c.classList.remove('fill-range');
            });
            if (fillCells.length > 0) {
                hostShowToast(`🟦 Filled ${fillCells.length} cells`);
            }
        }

        isDraggingCell = false;
        isFillingRange = false;
        draggedSourceCell = null;
        currentDropTarget = null;
        return true;
    }

    function handleTwoFingerTap(el, x, y) {
        if (!rootEl || !el || !rootEl.contains(el)) return false;
        const cellHit = el.closest('td.cell');
        if (!cellHit) return false;

        selectCell(cellHit);
        const menuX = Math.min(x, window.innerWidth - 165);
        const menuY = Math.min(y, window.innerHeight - 260);
        contextMenuEl.style.left = `${menuX}px`;
        contextMenuEl.style.top = `${menuY}px`;
        contextMenuEl.style.display = 'flex';
        hostShowToast(`⚙️ Menu: ${cellHit.dataset.address}`);
        return true;
    }

    function handleScroll(dx, dy, el) {
        if (!viewportEl || !el || !viewportEl.contains(el)) return false;
        viewportEl.scrollLeft -= dx * 1.6;
        viewportEl.scrollTop -= dy * 1.6;
        if (editingCell) ChordKeyboard.updateCenter();
        return true;
    }

    function handleZoomPan(dx, dy, zoomFactor) {
        if (!viewportEl || !tableEl) return;
        if (Math.hypot(dx, dy) > 1.2) {
            viewportEl.scrollLeft -= dx * 1.5;
            viewportEl.scrollTop -= dy * 1.5;
        }
        if (zoomFactor !== 1) {
            sheetScale = Math.max(0.6, Math.min(2.2, sheetScale * zoomFactor));
            tableEl.style.zoom = sheetScale;
        }
        if (editingCell) ChordKeyboard.updateCenter();
    }

    function highlightFillRange(startCell, endCell) {
        if (!tableEl) return;
        tableEl.querySelectorAll('td.cell.fill-range').forEach(c => c.classList.remove('fill-range'));
        const r1 = Math.min(+startCell.dataset.row, +endCell.dataset.row);
        const r2 = Math.max(+startCell.dataset.row, +endCell.dataset.row);
        const c1 = Math.min(+startCell.dataset.col, +endCell.dataset.col);
        const c2 = Math.max(+startCell.dataset.col, +endCell.dataset.col);

        for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++) {
                const cell = tableEl.querySelector(`td.cell[data-row="${r}"][data-col="${c}"]`);
                if (cell && cell !== startCell) cell.classList.add('fill-range');
            }
        }
    }

    // --- TOOLBAR & CONTEXT MENU ACTIONS ---
    function handleToolbarAction(action) {
        if (!selectedCell) return;
        if (action === 'edit') {
            if (editingCell === selectedCell) finishEditing();
            else startEditing(selectedCell);
        } else if (action === 'bold') {
            const isBold = selectedCell.style.fontWeight === 'bold';
            selectedCell.style.fontWeight = isBold ? 'normal' : 'bold';
            saveCellToStore(selectedCell);
            hostShowToast(isBold ? 'Bold Off' : 'Bold On');
        } else if (action === 'clear') {
            if (editingCell === selectedCell) finishEditing();
            selectedCell.style.backgroundColor = '#ffffff';
            setCellText(selectedCell, '');
            if (formulaInputEl) formulaInputEl.value = '';
            hostShowToast(`Cleared ${selectedCell.dataset.address}`);
        } else if (action === 'reset-zoom') {
            sheetScale = 1.0;
            if (tableEl) tableEl.style.zoom = 1.0;
            if (editingCell) ChordKeyboard.updateCenter();
            hostShowToast('🔍 Sheet Zoom 100%');
        } else if (action === 'sum') {
            if (editingCell) finishEditing();
            const col = +selectedCell.dataset.col;
            const row = +selectedCell.dataset.row;
            let sum = 0;
            for (let r = 1; r < row; r++) {
                const c = tableEl.querySelector(`td.cell[data-row="${r}"][data-col="${col}"]`);
                const val = parseFloat(getCellText(c));
                if (!isNaN(val)) sum += val;
            }
            selectedCell.style.fontWeight = 'bold';
            setCellText(selectedCell, String(sum));
            if (formulaInputEl) formulaInputEl.value = String(sum);
            hostShowToast(`∑ Sum = ${sum}`);
        }
    }

    function handleContextMenuClick(menuItem, swatch) {
        if (!selectedCell) {
            hideContextMenu();
            return;
        }
        if (swatch) {
            selectedCell.style.backgroundColor = swatch.dataset.color;
            saveCellToStore(selectedCell);
            hostShowToast('🎨 Color Applied');
            hideContextMenu();
            return;
        }
        const action = menuItem.dataset.menu;
        if (action === 'edit') {
            startEditing(selectedCell);
        } else if (action === 'copy') {
            clipboard = {
                text: getCellText(selectedCell),
                bold: selectedCell.style.fontWeight,
                bg: selectedCell.style.backgroundColor
            };
            hostShowToast(`📋 Copied ${selectedCell.dataset.address}`);
        } else if (action === 'cut') {
            clipboard = {
                text: getCellText(selectedCell),
                bold: selectedCell.style.fontWeight,
                bg: selectedCell.style.backgroundColor
            };
            selectedCell.style.backgroundColor = '#ffffff';
            setCellText(selectedCell, '');
            if (formulaInputEl) formulaInputEl.value = '';
            hostShowToast(`✂️ Cut ${selectedCell.dataset.address}`);
        } else if (action === 'paste') {
            if (clipboard) {
                selectedCell.style.fontWeight = clipboard.bold;
                selectedCell.style.backgroundColor = clipboard.bg;
                setCellText(selectedCell, clipboard.text);
                if (formulaInputEl) formulaInputEl.value = clipboard.text;
                hostShowToast(`📄 Pasted to ${selectedCell.dataset.address}`);
            } else {
                hostShowToast('Clipboard Empty');
            }
        } else if (action === 'bold') {
            handleToolbarAction('bold');
        } else if (action === 'clear') {
            handleToolbarAction('clear');
        }
        hideContextMenu();
    }

    return {
        mount,
        unmount,
        isEditing: () => !!editingCell,
        onLayoutChanged: () => {
            if (editingCell) ChordKeyboard.updateCenter();
        },
        hideContextMenu,
        handleTap,
        handleHoldStart,
        handleHoldMove,
        handleHoldEnd,
        handleTwoFingerTap,
        handleScroll,
        handleZoomPan
    };
})();