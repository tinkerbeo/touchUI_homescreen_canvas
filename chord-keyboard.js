// ==========================================
// FLOATING CHORDED KEYBOARD MODULE
// ==========================================
const ChordKeyboard = (() => {
    const innerRadius = 60;
    const mainRadius = 73;
    const textRadius = mainRadius + 13;
    const outerRadius = textRadius + 13;

    const labelFontSize = 27;
    const gapAngle = 18;
    const numItems = 6;
    const angleStep = 360 / numItems;
    const sweepAngle = angleStep - gapAngle;

    let isActive = false;
    let textValue = "";
    let activeTouchId = null;
    let firstFiredZone = null;
    let activeCharIndex = null;
    let fingerPos = null;
    let ghosts = [];
    let cursorSparks = [];
    let isNumberMode = false;
    let kbdCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    let onTextChangeCallback = null;
    let onDoneCallback = null;
    let onToastCallback = null;

    const canvas = document.getElementById('kbCanvas');
    const ctx = canvas.getContext('2d');
    const btnSpace = document.getElementById('btnSpace');
    const btnBackspace = document.getElementById('btnBackspace');
    const btnMode = document.getElementById('btnMode');
    const btnDone = document.getElementById('btnDone');

    const textContentSpan = document.createElement('span');
    textContentSpan.id = 'textContent';
    const caretSpan = document.createElement('span');
    caretSpan.id = 'caret';

    function generateLetterComboMap() {
        const map = new Map();
        let charCode = 97;
        const extras = [" ", ".", "?", "!"];
        let extraIdx = 0;

        for (let i = 1; i <= 6; i++) {
            for (let j = 1; j <= 6; j++) {
                if (i !== j) {
                    if (charCode <= 122) {
                        map.set(`${i}-${j}`, String.fromCharCode(charCode));
                        charCode++;
                    } else if (extraIdx < extras.length) {
                        map.set(`${i}-${j}`, extras[extraIdx]);
                        extraIdx++;
                    }
                }
            }
        }
        return map;
    }

    function generateNumberComboMap() {
        const map = new Map();
        const numChars = [
            "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
            ".", "+", "-", "*", "/", "=", "$", "%", "(", ")",
            "00", ",", ":", ";", "#", "@", "?", "!", "_", " "
        ];
        let idx = 0;
        for (let i = 1; i <= 6; i++) {
            for (let j = 1; j <= 6; j++) {
                if (i !== j && idx < numChars.length) {
                    map.set(`${i}-${j}`, numChars[idx]);
                    idx++;
                }
            }
        }
        return map;
    }

    const letterComboMap = generateLetterComboMap();
    const numberComboMap = generateNumberComboMap();

    function getActiveComboMap() {
        return isNumberMode ? numberComboMap : letterComboMap;
    }

    function getZoneForIndex(index) {
        return ((index + 2) % 6) + 1;
    }

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        if (isActive) updateCenter();
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function updateCenter() {
        if (!isActive) return;
        const rect = caretSpan.getBoundingClientRect();
        const rawX = rect.left || (window.innerWidth / 2);
        const rawY = (rect.top + rect.height / 2) || (window.innerHeight / 2);

        const minX = 135;
        const maxX = window.innerWidth - 135;
        const minY = 195;
        const maxY = window.innerHeight - 135;

        kbdCenter = {
            x: Math.max(minX, Math.min(maxX, rawX)),
            y: Math.max(minY, Math.min(maxY, rawY))
        };

        const offset = 100;
        const btnRadius = 25;

        btnSpace.style.left = (kbdCenter.x - offset - btnRadius) + 'px';
        btnSpace.style.top = (kbdCenter.y - offset - btnRadius) + 'px';

        btnBackspace.style.left = (kbdCenter.x + offset - btnRadius) + 'px';
        btnBackspace.style.top = (kbdCenter.y - offset - btnRadius) + 'px';

        btnMode.style.left = (kbdCenter.x - offset - btnRadius) + 'px';
        btnMode.style.top = (kbdCenter.y + offset - btnRadius) + 'px';

        btnDone.style.left = (kbdCenter.x + offset - btnRadius) + 'px';
        btnDone.style.top = (kbdCenter.y + offset - btnRadius) + 'px';
    }

    function commitText(char) {
        if (!isActive) return;
        textValue += char;
        textContentSpan.textContent = textValue;
        if (onTextChangeCallback) onTextChangeCallback(textValue);
        updateCenter();
    }

    function deleteChar() {
        if (!isActive) return;
        if (textValue.length > 0) {
            textValue = textValue.slice(0, -1);
            textContentSpan.textContent = textValue;
            if (onTextChangeCallback) onTextChangeCallback(textValue);
            updateCenter();
        }
    }

    function toggleMode() {
        isNumberMode = !isNumberMode;
        firstFiredZone = null;
        btnMode.innerText = isNumberMode ? 'ABC' : '123';
        btnMode.style.background = isNumberMode ? '#fbbc04' : '#1a73e8';
        if (onToastCallback) {
            onToastCallback(isNumberMode ? '🔢 Number Chord Mode' : '🔤 Letter Chord Mode');
        }
    }

    function getHitZoneIndex(x, y) {
        const dx = x - kbdCenter.x;
        const dy = y - kbdCenter.y;
        const distToCenter = Math.sqrt(dx * dx + dy * dy);

        if (distToCenter < mainRadius || distToCenter > outerRadius) return null;

        let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angleDeg < 0) angleDeg += 360;

        let shiftedAngle = angleDeg + 90;
        if (shiftedAngle < 0) shiftedAngle += 360;
        if (shiftedAngle >= 360) shiftedAngle -= 360;

        const closestIndex = Math.round(shiftedAngle / angleStep) % numItems;
        const centerAngleForIndex = closestIndex * angleStep;

        let diff = Math.abs(shiftedAngle - centerAngleForIndex);
        if (diff > 180) diff = 360 - diff;

        return (diff <= sweepAngle / 2) ? closestIndex : null;
    }

    function handleTouch(touchesList) {
        if (!isActive) return;
        let activeTouch = null;

        if (activeTouchId !== null) {
            for (let i = 0; i < touchesList.length; i++) {
                if (touchesList[i].identifier === activeTouchId) {
                    activeTouch = touchesList[i];
                    break;
                }
            }
            if (!activeTouch) {
                activeTouchId = null;
                activeCharIndex = null;
                fingerPos = null;
            }
        }

        if (activeTouchId === null) {
            for (let i = 0; i < touchesList.length; i++) {
                const t = touchesList[i];
                const hitZone = getHitZoneIndex(t.clientX, t.clientY);
                if (hitZone !== null) {
                    activeTouchId = t.identifier;
                    activeTouch = t;
                    break;
                }
            }
        }

        if (!activeTouch) return;

        fingerPos = { x: activeTouch.clientX, y: activeTouch.clientY };

        const dx = fingerPos.x - kbdCenter.x;
        const dy = fingerPos.y - kbdCenter.y;
        const distToCenter = Math.sqrt(dx * dx + dy * dy);

        if (distToCenter > outerRadius) {
            activeCharIndex = null;
        } else if (distToCenter > innerRadius) {
            if (distToCenter >= mainRadius) {
                activeCharIndex = getHitZoneIndex(fingerPos.x, fingerPos.y);
            }
        } else {
            if (activeCharIndex !== null) {
                const firedZone = getZoneForIndex(activeCharIndex);
                const isCancelBtn = (firstFiredZone !== null && firedZone === firstFiredZone);
                const activeMap = getActiveComboMap();

                const mappedChar = (firstFiredZone !== null && !isCancelBtn)
                    ? activeMap.get(`${firstFiredZone}-${firedZone}`)
                    : null;

                const isValidAction = isCancelBtn || firstFiredZone === null || mappedChar;

                if (isValidAction) {
                    const ghostText = isCancelBtn ? "🔙" : firedZone.toString();
                    const angleRad = ((activeCharIndex * angleStep) - 90) * Math.PI / 180;

                    const now = Date.now();
                    ghosts.push({
                        text: ghostText,
                        x: kbdCenter.x + Math.cos(angleRad) * textRadius,
                        y: kbdCenter.y + Math.sin(angleRad) * textRadius,
                        isCancelBtn: isCancelBtn,
                        startTime: now
                    });

                    cursorSparks.push({
                        x: fingerPos.x,
                        y: fingerPos.y,
                        isCancelBtn: isCancelBtn,
                        startTime: now
                    });

                    if (firstFiredZone === null) {
                        firstFiredZone = firedZone;
                    } else {
                        if (isCancelBtn) {
                            firstFiredZone = null;
                        } else {
                            commitText(mappedChar);
                            firstFiredZone = null;
                        }
                    }
                }
                activeCharIndex = null;
            }
        }
    }

    function drawArc(x, y, r, startAngleDeg, sweepAngleDeg, color, lineWidth) {
        ctx.beginPath();
        const startRad = startAngleDeg * Math.PI / 180;
        const endRad = (startAngleDeg + sweepAngleDeg) * Math.PI / 180;
        ctx.arc(x, y, r, startRad, endRad);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    function drawLoop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (isActive) {
            const cx = kbdCenter.x;
            const cy = kbdCenter.y;
            const now = Date.now();

            ctx.beginPath();
            ctx.arc(cx, cy, outerRadius + 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.fill();

            for (let i = 0; i < numItems; i++) {
                const zone = getZoneForIndex(i);
                if (zone === firstFiredZone) {
                    const startAngleDeg = (i * angleStep) - 90 - (sweepAngle / 2);
                    const startRad = startAngleDeg * Math.PI / 180;
                    const endRad = (startAngleDeg + sweepAngle) * Math.PI / 180;

                    ctx.beginPath();
                    ctx.arc(cx, cy, outerRadius, startRad, endRad, false);
                    ctx.arc(cx, cy, mainRadius, endRad, startRad, true);
                    ctx.closePath();
                    ctx.fillStyle = '#4CAF50';
                    ctx.fill();
                }
            }

            ctx.beginPath();
            ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
            ctx.strokeStyle = isNumberMode ? '#fbbc04' : '#2196F3';
            ctx.lineWidth = 6;
            ctx.stroke();

            const borderColor = 'rgba(95, 99, 104, 0.65)';
            for (let i = 0; i < numItems; i++) {
                const startAngleDeg = (i * angleStep) - 90 - (sweepAngle / 2);
                const startRad = startAngleDeg * Math.PI / 180;
                const endRad = (startAngleDeg + sweepAngle) * Math.PI / 180;

                drawArc(cx, cy, mainRadius, startAngleDeg, sweepAngle, borderColor, 3);
                drawArc(cx, cy, outerRadius, startAngleDeg, sweepAngle, borderColor, 3);

                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(startRad) * mainRadius, cy + Math.sin(startRad) * mainRadius);
                ctx.lineTo(cx + Math.cos(startRad) * outerRadius, cy + Math.sin(startRad) * outerRadius);
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = 3;
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(endRad) * mainRadius, cy + Math.sin(endRad) * mainRadius);
                ctx.lineTo(cx + Math.cos(endRad) * outerRadius, cy + Math.sin(endRad) * outerRadius);
                ctx.stroke();
            }

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${labelFontSize}px sans-serif`;
            const activeMap = getActiveComboMap();

            for (let i = 0; i < numItems; i++) {
                const zone = getZoneForIndex(i);
                const angleRad = ((i * angleStep) - 90) * Math.PI / 180;
                const textX = cx + Math.cos(angleRad) * textRadius;
                const textY = cy + Math.sin(angleRad) * textRadius;

                if (firstFiredZone === null) {
                    ctx.fillStyle = '#202124';
                    ctx.fillText(zone.toString(), textX, textY);
                } else if (zone === firstFiredZone) {
                    ctx.fillStyle = 'white';
                    ctx.fillText('🔙', textX, textY);
                } else {
                    const previewChar = activeMap.get(`${firstFiredZone}-${zone}`) || '';
                    ctx.fillStyle = '#1a73e8';
                    ctx.fillText(previewChar === ' ' ? '␣' : previewChar, textX, textY);
                }
            }

            ghosts = ghosts.filter(ghost => {
                const age = now - ghost.startTime;
                if (age > 300) return false;
                const alpha = 1 - (age / 300);
                ctx.fillStyle = ghost.isCancelBtn ? `rgba(255, 152, 0, ${alpha})` : `rgba(76, 175, 80, ${alpha})`;
                ctx.fillText(ghost.text, ghost.x, ghost.y);
                return true;
            });

            cursorSparks = cursorSparks.filter(spark => {
                const age = now - spark.startTime;
                if (age > 300) return false;
                const p = age / 300;
                const currentRadius = 24 + (60 - 24) * p;
                const alpha = 1 - p;

                const r = spark.isCancelBtn ? 255 : 76;
                const g = spark.isCancelBtn ? 152 : 175;
                const b = spark.isCancelBtn ? 0 : 80;

                ctx.beginPath();
                ctx.arc(spark.x, spark.y, currentRadius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.4})`;
                ctx.fill();

                ctx.beginPath();
                ctx.arc(spark.x, spark.y, currentRadius, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                ctx.lineWidth = 6;
                ctx.stroke();
                return true;
            });
        }

        requestAnimationFrame(drawLoop);
    }
    requestAnimationFrame(drawLoop);

    btnSpace.addEventListener('touchstart', (e) => { e.preventDefault(); commitText(" "); }, { passive: false });
    btnBackspace.addEventListener('touchstart', (e) => { e.preventDefault(); deleteChar(); }, { passive: false });
    btnMode.addEventListener('touchstart', (e) => { e.preventDefault(); toggleMode(); }, { passive: false });
    btnDone.addEventListener('touchstart', (e) => { e.preventDefault(); if (onDoneCallback) onDoneCallback(); }, { passive: false });

    return {
        init({ onTextChange, onDone, onToast }) {
            onTextChangeCallback = onTextChange;
            onDoneCallback = onDone;
            onToastCallback = onToast;
        },
        open(cellElement, initialText) {
            isActive = true;
            textValue = initialText || "";
            firstFiredZone = null;
            activeTouchId = null;
            activeCharIndex = null;
            fingerPos = null;

            textContentSpan.textContent = textValue;
            cellElement.innerHTML = '';
            cellElement.appendChild(textContentSpan);
            cellElement.appendChild(caretSpan);

            canvas.style.display = 'block';
            btnSpace.style.display = 'flex';
            btnBackspace.style.display = 'flex';
            btnMode.style.display = 'flex';
            btnDone.style.display = 'flex';

            updateCenter();
        },
        close() {
            isActive = false;
            firstFiredZone = null;
            activeTouchId = null;
            activeCharIndex = null;
            fingerPos = null;

            canvas.style.display = 'none';
            btnSpace.style.display = 'none';
            btnBackspace.style.display = 'none';
            btnMode.style.display = 'none';
            btnDone.style.display = 'none';

            return textValue;
        },
        handleTouch,
        updateCenter,
        handleButtonElementClick(el) {
            if (el === btnSpace) { commitText(" "); return true; }
            if (el === btnBackspace) { deleteChar(); return true; }
            if (el === btnMode) { toggleMode(); return true; }
            if (el === btnDone) { if (onDoneCallback) onDoneCallback(); return true; }
            return false;
        },
        isPointInsideWheel(x, y) {
            if (!isActive) return false;
            return Math.hypot(x - kbdCenter.x, y - kbdCenter.y) <= (outerRadius + 15);
        }
    };
})();