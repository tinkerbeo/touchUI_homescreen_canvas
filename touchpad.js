// =========================================================
// OS-LEVEL VIRTUAL CIRCLE TOUCHPAD DRIVER (1–5 FINGERS)
// =========================================================
const Touchpad = (() => {
    const touchpad = document.getElementById('touchpad');
    const multiTouchRing = document.getElementById('multi-touch-ring');
    const cursor = document.getElementById('cursor');

    // Sliders & Toggle Switch DOM
    const padControls = document.getElementById('pad-controls');
    const btnPadSettings = document.getElementById('btn-pad-settings');
    const sliderPadRadius = document.getElementById('slider-pad-radius');
    const sliderMultiRadius = document.getElementById('slider-multi-radius');
    const valPadRadius = document.getElementById('val-pad-radius');
    const valMultiRadius = document.getElementById('val-multi-radius');
    const toggleMultiRing = document.getElementById('toggle-multi-ring');

    // Cursor & Touchpad State
    let cursorX = window.innerWidth / 2;
    let cursorY = window.innerHeight / 2;

    let padRadius = 60;         // 120px diameter visible ring
    let multiTouchRadius = 120; // 240px diameter hidden error room
    const CURSOR_SPEED = 1.65;
    let padX = window.innerWidth - 95;
    let padY = window.innerHeight - 130;

    // Multi-Touch Latching Map
    const padTouches = new Map();
    let maxFingersInSession = 0;
    let longPressTimer = null;
    let isHoldActive = false;

    const TAP_MOVE_LIMIT = 12;
    const TAP_TIME_LIMIT = 280;
    let holdDelayMs = 320; // Shortened automatically in Pen/Eraser mode

    // 2F Scroll
    let lastTwoMidX = 0, lastTwoMidY = 0;
    let twoFingerStartTime = 0, twoFingerMoved = false;

    // 3F Zoom & Pan
    let lastThreeMidX = 0, lastThreeMidY = 0, lastThreeSpan = 0;

    // 4F Quick Toggle / Swipe
    let lastFourMidX = 0, lastFourMidY = 0;
    let fourFingerStartTime = 0, fourFingerMoved = false;

    // 5F Move Touchpad
    let isMovingTouchpad = false;
    let lastFiveMidX = 0, lastFiveMidY = 0;

    // Event Delegate Callbacks
    let handlers = {};

    function updateCursor(x, y) {
        cursorX = Math.max(4, Math.min(window.innerWidth - 4, x));
        cursorY = Math.max(4, Math.min(window.innerHeight - 4, y));
        cursor.style.left = `${cursorX}px`;
        cursor.style.top = `${cursorY}px`;
    }

    function updateTouchpadPosition(x, y) {
        const margin = Math.max(30, padRadius + 6);
        padX = Math.max(margin, Math.min(window.innerWidth - margin, x));
        padY = Math.max(margin, Math.min(window.innerHeight - margin, y));
        touchpad.style.left = `${padX}px`;
        touchpad.style.top = `${padY}px`;
        multiTouchRing.style.left = `${padX}px`;
        multiTouchRing.style.top = `${padY}px`;
    }

    function syncRadii() {
        touchpad.style.width = `${padRadius * 2}px`;
        touchpad.style.height = `${padRadius * 2}px`;
        multiTouchRing.style.width = `${multiTouchRadius * 2}px`;
        multiTouchRing.style.height = `${multiTouchRadius * 2}px`;
        valPadRadius.innerText = `${padRadius}px`;
        valMultiRadius.innerText = `${multiTouchRadius}px`;
        updateTouchpadPosition(padX, padY);
    }

    function toggleControlsPanel() {
        const hidden = padControls.classList.toggle('hidden');
        btnPadSettings.classList.toggle('active', !hidden);
    }

    // Direct Slider / Switch Listeners
    sliderPadRadius.addEventListener('input', (e) => {
        padRadius = parseInt(e.target.value, 10);
        syncRadii();
    });
    sliderMultiRadius.addEventListener('input', (e) => {
        multiTouchRadius = parseInt(e.target.value, 10);
        syncRadii();
    });
    toggleMultiRing.addEventListener('change', (e) => {
        multiTouchRing.classList.toggle('visible', e.target.checked);
    });
    btnPadSettings.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleControlsPanel();
    }, { passive: false });

    window.addEventListener('resize', () => {
        updateCursor(cursorX, cursorY);
        updateTouchpadPosition(padX, padY);
    });

    function isWithin(x, y, radius) {
        return Math.hypot(x - padX, y - padY) <= radius;
    }

    function getCentroidAndSpread(touches) {
        const count = touches.length;
        let sx = 0, sy = 0;
        for (let i = 0; i < count; i++) {
            sx += touches[i].clientX;
            sy += touches[i].clientY;
        }
        const midX = sx / count;
        const midY = sy / count;
        let dSum = 0;
        for (let i = 0; i < count; i++) {
            dSum += Math.hypot(touches[i].clientX - midX, touches[i].clientY - midY);
        }
        return { midX, midY, spread: dSum / count };
    }

    function clearHoldTimer() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    function getLatched(allTouches) {
        const list = [];
        for (let i = 0; i < allTouches.length; i++) {
            if (padTouches.has(allTouches[i].identifier)) list.push(allTouches[i]);
        }
        return list;
    }

    function latchEligible(allTouches, isStart) {
        const multiR = Math.max(padRadius, multiTouchRadius);
        let nearby = 0;
        for (let i = 0; i < allTouches.length; i++) {
            const t = allTouches[i];
            if (padTouches.has(t.identifier) || isWithin(t.clientX, t.clientY, multiR)) {
                nearby++;
            }
        }
        const effR = nearby >= 2 ? multiR : padRadius;
        let newlyLatched = false;

        for (let i = 0; i < allTouches.length; i++) {
            const t = allTouches[i];
            if (!padTouches.has(t.identifier) && isWithin(t.clientX, t.clientY, effR)) {
                padTouches.set(t.identifier, {
                    lastX: t.clientX,
                    lastY: t.clientY,
                    startX: t.clientX,
                    startY: t.clientY,
                    startTime: Date.now(),
                    startedInside: isStart,
                    maxMove: isStart ? 0 : 999
                });
                newlyLatched = true;
            }
        }
        return newlyLatched;
    }

    function endHoldIfActive() {
        if (!isHoldActive) return;
        isHoldActive = false;
        cursor.classList.remove('dragging', 'drawing');
        if (handlers.onHoldEnd) handlers.onHoldEnd(cursorX, cursorY);
    }

    function activateModeForCount(latchedList) {
        const count = latchedList.length;
        if (count > maxFingersInSession) maxFingersInSession = count;

        if (count === 1 && maxFingersInSession === 1) {
            const mem = padTouches.get(latchedList[0].identifier);
            touchpad.className = 'active-1f';
            clearHoldTimer();
            if (mem && mem.startedInside) {
                longPressTimer = setTimeout(() => {
                    if (padTouches.size === 1 && maxFingersInSession === 1) {
                        isHoldActive = true;
                        touchpad.className = 'active-drag';
                        if (handlers.onHoldStart) handlers.onHoldStart(cursorX, cursorY);
                    }
                }, holdDelayMs);
            }
        } else if (count === 2 && maxFingersInSession === 2) {
            clearHoldTimer();
            endHoldIfActive();
            touchpad.className = 'active-2f';
            const { midX, midY } = getCentroidAndSpread(latchedList);
            lastTwoMidX = midX;
            lastTwoMidY = midY;
            twoFingerStartTime = Date.now();
            twoFingerMoved = false;
        } else if (count === 3 && maxFingersInSession === 3) {
            clearHoldTimer();
            endHoldIfActive();
            touchpad.className = 'active-3f';
            const { midX, midY, spread } = getCentroidAndSpread(latchedList);
            lastThreeMidX = midX;
            lastThreeMidY = midY;
            lastThreeSpan = spread;
        } else if (count === 4 && maxFingersInSession === 4) {
            clearHoldTimer();
            endHoldIfActive();
            touchpad.className = 'active-4f';
            const { midX, midY } = getCentroidAndSpread(latchedList);
            lastFourMidX = midX;
            lastFourMidY = midY;
            fourFingerStartTime = Date.now();
            fourFingerMoved = false;
        } else if (count >= 5) {
            clearHoldTimer();
            endHoldIfActive();
            isMovingTouchpad = true;
            touchpad.className = 'active-5f';
            const { midX, midY } = getCentroidAndSpread(latchedList);
            lastFiveMidX = midX;
            lastFiveMidY = midY;
        }
    }

    function shouldBypass(target) {
        return target.classList.contains('kb-btn') || !!target.closest('#pad-controls');
    }

    function forwardUnlatched(allTouches) {
        if (!handlers.onUnlatchedTouch) return;
        const unlatched = Array.from(allTouches).filter(t => !padTouches.has(t.identifier));
        handlers.onUnlatchedTouch(unlatched);
    }

    function onTouchStart(e) {
        if (shouldBypass(e.target)) return;
        e.preventDefault();

        const newly = latchEligible(e.touches, true);
        forwardUnlatched(e.touches);
        if (newly) activateModeForCount(getLatched(e.touches));
    }

    function onTouchMove(e) {
        if (shouldBypass(e.target)) return;
        e.preventDefault();

        const slidIn = latchEligible(e.touches, false);
        forwardUnlatched(e.touches);

        const latched = getLatched(e.touches);
        const count = latched.length;
        if (slidIn) activateModeForCount(latched);
        if (count === 0) return;

        // 5F: Move Touchpad
        if (isMovingTouchpad && count >= 5) {
            const { midX, midY } = getCentroidAndSpread(latched);
            updateTouchpadPosition(padX + (midX - lastFiveMidX), padY + (midY - lastFiveMidY));
            lastFiveMidX = midX;
            lastFiveMidY = midY;
            return;
        }

        // 4F: Window / OS Gesture
        if (count === 4 && maxFingersInSession === 4 && !isMovingTouchpad) {
            const { midX, midY } = getCentroidAndSpread(latched);
            const dx = midX - lastFourMidX;
            const dy = midY - lastFourMidY;
            if (Math.hypot(dx, dy) > 2) {
                fourFingerMoved = true;
                if (handlers.onFourFingerMove) handlers.onFourFingerMove(dx, dy);
            }
            lastFourMidX = midX;
            lastFourMidY = midY;
            return;
        }

        // 3F: Zoom & Pan
        if (count === 3 && maxFingersInSession === 3 && !isMovingTouchpad) {
            const { midX, midY, spread } = getCentroidAndSpread(latched);
            const dMidX = midX - lastThreeMidX;
            const dMidY = midY - lastThreeMidY;
            const spanDelta = spread - lastThreeSpan;
            const zoomFactor = (Math.abs(spanDelta) > 1.4 && lastThreeSpan > 16)
                ? (spread / lastThreeSpan)
                : 1;

            if (handlers.onThreeFingerZoomPan) {
                handlers.onThreeFingerZoomPan(dMidX, dMidY, zoomFactor, cursorX, cursorY);
            }
            lastThreeMidX = midX;
            lastThreeMidY = midY;
            lastThreeSpan = spread;
            return;
        }

        // 2F: Scroll / Pan Only
        if (count === 2 && maxFingersInSession === 2 && !isMovingTouchpad) {
            const { midX, midY } = getCentroidAndSpread(latched);
            const dMidX = midX - lastTwoMidX;
            const dMidY = midY - lastTwoMidY;
            if (Math.hypot(dMidX, dMidY) > 1.2) {
                twoFingerMoved = true;
                if (handlers.onTwoFingerScroll) handlers.onTwoFingerScroll(dMidX, dMidY, cursorX, cursorY);
            }
            lastTwoMidX = midX;
            lastTwoMidY = midY;
            return;
        }

        // 1F: Relative Cursor & Hold-Drag / Draw
        if (count === 1 && maxFingersInSession === 1 && !isMovingTouchpad) {
            const t = latched[0];
            const mem = padTouches.get(t.identifier);
            if (!mem) return;

            const rawDx = t.clientX - mem.lastX;
            const rawDy = t.clientY - mem.lastY;
            mem.lastX = t.clientX;
            mem.lastY = t.clientY;

            const dist = Math.hypot(t.clientX - mem.startX, t.clientY - mem.startY);
            if (dist > mem.maxMove) mem.maxMove = dist;
            if (mem.maxMove > TAP_MOVE_LIMIT) clearHoldTimer();

            const prevX = cursorX;
            const prevY = cursorY;
            updateCursor(cursorX + rawDx * CURSOR_SPEED, cursorY + rawDy * CURSOR_SPEED);

            if (isHoldActive && handlers.onHoldMove) {
                handlers.onHoldMove(cursorX, cursorY, cursorX - prevX, cursorY - prevY);
            }
        }
    }

    function onTouchEnd(e) {
        if (shouldBypass(e.target)) return;
        e.preventDefault();
        clearHoldTimer();

        for (let i = 0; i < e.changedTouches.length; i++) {
            const ct = e.changedTouches[i];
            const mem = padTouches.get(ct.identifier);
            if (mem) {
                const dur = Date.now() - mem.startTime;
                if (
                    maxFingersInSession === 1 &&
                    mem.startedInside &&
                    !isHoldActive &&
                    mem.maxMove <= TAP_MOVE_LIMIT &&
                    dur <= TAP_TIME_LIMIT
                ) {
                    pulseCursor();
                    if (handlers.onTap) handlers.onTap(cursorX, cursorY);
                }
                padTouches.delete(ct.identifier);
            }
        }

        forwardUnlatched(e.touches);
        const remaining = getLatched(e.touches);

        if (
            maxFingersInSession === 2 &&
            remaining.length === 0 &&
            !twoFingerMoved &&
            (Date.now() - twoFingerStartTime) <= TAP_TIME_LIMIT
        ) {
            if (handlers.onTwoFingerTap) handlers.onTwoFingerTap(cursorX, cursorY);
        }

        if (maxFingersInSession === 4 && remaining.length === 0) {
            const wasTap = !fourFingerMoved && (Date.now() - fourFingerStartTime) <= TAP_TIME_LIMIT;
            if (wasTap && handlers.onFourFingerTap) handlers.onFourFingerTap();
        }

        if (remaining.length === 0) {
            endHoldIfActive();
            isMovingTouchpad = false;
            maxFingersInSession = 0;
            padTouches.clear();
            touchpad.className = '';
        }
    }

    function pulseCursor() {
        cursor.style.transform = 'translate(-50%, -50%) scale(0.75)';
        setTimeout(() => {
            if (!isHoldActive) cursor.style.transform = 'translate(-50%, -50%) scale(1)';
        }, 110);
    }

    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onTouchEnd, { passive: false });

    updateCursor(cursorX, cursorY);
    syncRadii();

    return {
        init(newHandlers) {
            handlers = newHandlers || {};
        },
        setHoldDelay(ms) {
            holdDelayMs = ms;
        },
        setCursorMode(mode) {
            cursor.classList.remove('dragging', 'drawing');
            if (mode === 'drag') cursor.classList.add('dragging');
            if (mode === 'draw') cursor.classList.add('drawing');
        },
        toggleControlsPanel,
        getCursor() {
            return { x: cursorX, y: cursorY };
        }
    };
})();