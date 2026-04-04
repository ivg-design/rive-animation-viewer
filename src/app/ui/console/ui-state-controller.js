export function createConsoleUiStateController({
    documentRef = globalThis.document,
    elements,
    getErudaReady = () => false,
    onScrollStateChange = () => {},
    state,
} = {}) {
    function getErudaLogList() {
        if (!getErudaReady()) {
            return null;
        }
        return elements.scriptConsoleOutput?.querySelector('.luna-console-logs') || null;
    }

    function getErudaScrollContainer() {
        if (!getErudaReady()) {
            return null;
        }
        return elements.scriptConsoleOutput?.querySelector('.eruda-logs-container.luna-console')
            || elements.scriptConsoleOutput?.querySelector('.rav-eruda .eruda-logs-container.luna-console')
            || elements.scriptConsoleOutput?.querySelector('.luna-console')
            || elements.scriptConsoleOutput?.querySelector('.luna-console-logs-space')
            || null;
    }

    function getScrollContainer() {
        return getErudaScrollContainer() || elements.scriptConsoleOutput || null;
    }

    function getListContainer() {
        return elements.scriptConsoleLogList || elements.scriptConsoleOutput || null;
    }

    function getLatestScrollTop() {
        const container = getScrollContainer();
        const logList = getErudaLogList();
        if (!container || !logList || container === logList) {
            return 0;
        }
        if (!logList.children.length) {
            return 0;
        }

        const offsetTop = Number(logList.offsetTop);
        if (Number.isFinite(offsetTop) && offsetTop > 0) {
            return offsetTop;
        }

        const containerRect = typeof container.getBoundingClientRect === 'function'
            ? container.getBoundingClientRect()
            : null;
        const logListRect = typeof logList.getBoundingClientRect === 'function'
            ? logList.getBoundingClientRect()
            : null;

        if (!containerRect || !logListRect) {
            return 0;
        }

        return Math.max(0, container.scrollTop + (logListRect.top - containerRect.top));
    }

    function syncLevelButtons() {
        const levelButtons = [
            { element: elements.scriptConsoleFilterAll, level: 'all' },
            { element: elements.scriptConsoleFilterInfo, level: 'info' },
            { element: elements.scriptConsoleFilterWarning, level: 'warning' },
            { element: elements.scriptConsoleFilterError, level: 'error' },
        ];

        levelButtons.forEach(({ element, level }) => {
            if (!element) {
                return;
            }
            const active = state.currentLevel === level;
            element.classList.toggle('is-active', active);
            element.setAttribute('aria-pressed', String(active));
        });
    }

    function syncModeTabs() {
        const eventTab = elements.eventConsoleTab;
        const scriptTab = elements.scriptConsoleTab;
        const isJsMode = state.isOpen;

        if (eventTab) {
            eventTab.classList.toggle('is-active', !isJsMode);
            eventTab.setAttribute('aria-pressed', String(!isJsMode));
        }
        if (scriptTab) {
            scriptTab.classList.toggle('is-active', isJsMode);
            scriptTab.setAttribute('aria-pressed', String(isJsMode));
        }
    }

    function syncFollowButton() {
        const button = elements.scriptConsoleFollowButton;
        if (!button) {
            return;
        }
        button.classList.toggle('is-active', state.followLatest);
        button.setAttribute('aria-pressed', String(state.followLatest));
        button.dataset.followState = state.followLatest ? 'on' : 'off';
        button.setAttribute('aria-label', state.followLatest ? 'Follow latest console output' : 'Follow latest console output off');
        button.title = state.followLatest
            ? 'Newest console output stays pinned in view'
            : 'Pinned follow is off';
    }

    function syncFollowStateFromScroll() {
        const container = getScrollContainer();
        if (!container) {
            return;
        }
        const nextFollowLatest = Math.abs(container.scrollTop - getLatestScrollTop()) <= 6;
        if (nextFollowLatest === state.followLatest) {
            return;
        }
        state.followLatest = nextFollowLatest;
        syncFollowButton();
        onScrollStateChange();
    }

    function scrollConsoleToLatest() {
        const container = getScrollContainer();
        if (!container) {
            return;
        }
        container.scrollTop = getLatestScrollTop();
        syncFollowStateFromScroll();
    }

    function unbindScrollContainer() {
        if (state.scrollContainer && state.scrollHandler) {
            state.scrollContainer.removeEventListener('scroll', state.scrollHandler);
        }
        state.scrollContainer = null;
    }

    function bindScrollContainer() {
        const container = getScrollContainer();
        if (!container || !state.scrollHandler || state.scrollContainer === container) {
            return;
        }
        unbindScrollContainer();
        state.scrollContainer = container;
        state.scrollContainer.addEventListener('scroll', state.scrollHandler, { passive: true });
    }

    function syncUi() {
        documentRef?.body?.classList.toggle('js-console-mode', state.isOpen);

        const button = elements.toggleScriptConsoleButton;
        if (button) {
            button.classList.toggle('is-active', state.isOpen);
            button.setAttribute('aria-pressed', String(state.isOpen));
            button.title = state.isOpen ? 'Disable JavaScript Console' : 'Enable JavaScript Console';
        }

        elements.eventLogPanel?.classList.toggle('script-console-mode', state.isOpen);
        syncModeTabs();
        if (elements.eventLogFilterControls) {
            elements.eventLogFilterControls.hidden = state.isOpen;
        }
        if (elements.scriptConsoleSummaryRight) {
            elements.scriptConsoleSummaryRight.hidden = !state.isOpen;
        }
        if (elements.scriptConsoleView) {
            elements.scriptConsoleView.hidden = !state.isOpen;
        }
        if (elements.eventLogList) {
            elements.eventLogList.hidden = state.isOpen;
        }
        if (elements.eventLogCount) {
            elements.eventLogCount.style.display = state.isOpen ? 'none' : '';
        }
    }

    return {
        bindScrollContainer,
        getListContainer,
        getScrollContainer,
        scrollConsoleToLatest,
        syncFollowButton,
        syncModeTabs,
        syncFollowStateFromScroll,
        syncLevelButtons,
        syncUi,
        unbindScrollContainer,
    };
}
