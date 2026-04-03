export function setupShellPanelResizers({
    clamp,
    documentRef = globalThis.document,
    elements,
    handleResize = () => {},
    isLeftPanelVisible = () => false,
    isRightPanelVisible = () => true,
    setGridVar = () => {},
    windowRef = globalThis.window,
} = {}) {
    const grid = elements.mainGrid;
    const leftResizer = elements.leftResizer;
    const rightResizer = elements.rightResizer;
    if (!grid || !leftResizer || !rightResizer) {
        return;
    }

    const startResizerDrag = (event, side) => {
        if ((side === 'left' && !isLeftPanelVisible()) || (side === 'right' && !isRightPanelVisible())) {
            return;
        }
        event.preventDefault();
        const gridRect = grid.getBoundingClientRect();
        const startX = event.clientX;
        const initialLeft = grid.style.getPropertyValue('--left-width')
            ? parseFloat(grid.style.getPropertyValue('--left-width'))
            : elements.configPanel?.offsetWidth || 340;
        const initialRight = grid.style.getPropertyValue('--right-width')
            ? parseFloat(grid.style.getPropertyValue('--right-width'))
            : elements.rightPanel?.offsetWidth || 330;

        const activeResizer = side === 'left' ? leftResizer : rightResizer;
        activeResizer.classList.add('is-dragging');
        documentRef.body.style.cursor = 'col-resize';
        documentRef.body.style.userSelect = 'none';

        const onMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - startX;
            if (side === 'left') {
                const maxLeft = Math.max(260, gridRect.width - initialRight - 380);
                setGridVar('--left-width', clamp(initialLeft + deltaX, 240, maxLeft));
            } else {
                const maxRight = Math.max(320, gridRect.width - initialLeft - 320);
                setGridVar('--right-width', clamp(initialRight - deltaX, 260, maxRight));
            }
        };

        const onUp = () => {
            activeResizer.classList.remove('is-dragging');
            documentRef.body.style.cursor = '';
            documentRef.body.style.userSelect = '';
            windowRef.removeEventListener('mousemove', onMove);
            windowRef.removeEventListener('mouseup', onUp);
            handleResize();
        };

        windowRef.addEventListener('mousemove', onMove);
        windowRef.addEventListener('mouseup', onUp);
    };

    leftResizer.addEventListener('mousedown', (event) => startResizerDrag(event, 'left'));
    rightResizer.addEventListener('mousedown', (event) => startResizerDrag(event, 'right'));
}

export function setupCenterPanelResizer({
    clamp,
    documentRef = globalThis.document,
    elements,
    handleResize = () => {},
    windowRef = globalThis.window,
} = {}) {
    const centerPanel = elements.centerPanel;
    const centerResizer = elements.centerResizer;
    if (!centerPanel || !centerResizer) {
        return;
    }

    const getMaxLogHeight = () => {
        const panelHeight = centerPanel.getBoundingClientRect?.().height || 0;
        if (!panelHeight) {
            return Number.MAX_SAFE_INTEGER;
        }
        const minCanvasHeight = 96;
        const reservedHeight = 36 + 2 + minCanvasHeight;
        return Math.max(120, Math.floor(panelHeight - reservedHeight));
    };

    centerResizer.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = centerPanel.style.getPropertyValue('--center-log-height')
            ? parseFloat(centerPanel.style.getPropertyValue('--center-log-height'))
            : 230;

        centerResizer.classList.add('is-dragging');
        documentRef.body.style.cursor = 'row-resize';
        documentRef.body.style.userSelect = 'none';

        const onMove = (moveEvent) => {
            const deltaY = moveEvent.clientY - startY;
            const nextHeight = clamp(startHeight - deltaY, 120, getMaxLogHeight());
            centerPanel.style.setProperty('--center-log-height', `${Math.round(nextHeight)}px`);
        };

        const onUp = () => {
            centerResizer.classList.remove('is-dragging');
            documentRef.body.style.cursor = '';
            documentRef.body.style.userSelect = '';
            windowRef.removeEventListener('mousemove', onMove);
            windowRef.removeEventListener('mouseup', onUp);
            handleResize();
        };

        windowRef.addEventListener('mousemove', onMove);
        windowRef.addEventListener('mouseup', onUp);
    });
}
