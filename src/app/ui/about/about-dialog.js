import {
    ABOUT_APP_NAME,
    ABOUT_CREDITS,
    ABOUT_LICENSE,
    ABOUT_LINKS,
    buildDependencyEntries,
} from './about-data.js';

function createSectionHeading(documentRef, text) {
    const heading = documentRef.createElement('h3');
    heading.className = 'about-dialog-section-title';
    heading.textContent = text;
    return heading;
}

function createDefinitionGrid(documentRef, rows = []) {
    const grid = documentRef.createElement('dl');
    grid.className = 'about-dialog-grid';
    rows.forEach(({ label, value }) => {
        const dt = documentRef.createElement('dt');
        dt.textContent = label;
        const dd = documentRef.createElement('dd');
        dd.textContent = value;
        grid.append(dt, dd);
    });
    return grid;
}

export function createAboutDialogController({
    callbacks = {},
    documentRef = globalThis.document,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    initLucideIcons = () => {},
} = {}) {
    const {
        getAppBuildLabel = () => 'dev',
        getAppVersionLabel = () => 'dev',
        getCurrentRuntime = () => 'webgl2',
        getCurrentRuntimeVersion = () => 'latest',
        getOpenExternalUrl = () => null,
        getTauriEventListener = () => null,
    } = callbacks;

    let dialog = null;
    let dependencyList = null;
    let dependencyStatus = null;
    let loadedDependencies = false;
    let tauriAboutUnlisten = null;

    function closeDialog() {
        if (!dialog) {
            return;
        }
        if (typeof dialog.close === 'function') {
            dialog.close();
            return;
        }
        dialog.removeAttribute('open');
    }

    async function openExternal(url) {
        const openExternalUrl = getOpenExternalUrl();
        if (typeof openExternalUrl === 'function') {
            await openExternalUrl(url);
            return;
        }
        globalThis.window?.open?.(url, '_blank', 'noopener,noreferrer');
    }

    function ensureDialog() {
        if (dialog) {
            return dialog;
        }

        dialog = documentRef.createElement('dialog');
        dialog.className = 'about-dialog';
        dialog.id = 'about-dialog';
        dialog.innerHTML = `
            <div class="about-dialog-content">
                <div class="about-dialog-header">
                    <div>
                        <p class="about-dialog-kicker">About</p>
                        <h2>${ABOUT_APP_NAME}</h2>
                    </div>
                    <button type="button" class="icon-btn icon-btn-ghost about-dialog-close" aria-label="Close">
                        <i data-lucide="x" class="lucide-18"></i>
                    </button>
                </div>
                <div class="about-dialog-body">
                    <section class="about-dialog-section about-dialog-summary">
                        <div class="about-dialog-build-pill">v<span data-about-version></span> · <span data-about-build></span></div>
                        <p class="about-dialog-summary-text">Desktop and web viewer for .riv files with live editing, ViewModel controls, export tooling, and MCP automation.</p>
                    </section>
                    <section class="about-dialog-section" data-about-metadata></section>
                    <section class="about-dialog-section" data-about-credits></section>
                    <section class="about-dialog-section" data-about-links></section>
                    <section class="about-dialog-section" data-about-dependencies></section>
                </div>
            </div>
        `;
        documentRef.body.append(dialog);

        dialog.querySelector('.about-dialog-close')?.addEventListener('click', closeDialog);
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeDialog();
        });
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                closeDialog();
            }
        });

        const metadataSection = dialog.querySelector('[data-about-metadata]');
        metadataSection.append(
            createSectionHeading(documentRef, 'Build'),
            createDefinitionGrid(documentRef, [
                { label: 'Version', value: getAppVersionLabel() },
                { label: 'Build', value: getAppBuildLabel() },
                { label: 'Runtime', value: `${String(getCurrentRuntime()).toUpperCase()} ${getCurrentRuntimeVersion()}` },
                { label: 'License', value: ABOUT_LICENSE },
            ]),
        );

        const creditsSection = dialog.querySelector('[data-about-credits]');
        creditsSection.append(
            createSectionHeading(documentRef, 'Credits'),
            createDefinitionGrid(documentRef, ABOUT_CREDITS),
        );

        const linksSection = dialog.querySelector('[data-about-links]');
        linksSection.append(createSectionHeading(documentRef, 'Links'));
        const linkList = documentRef.createElement('div');
        linkList.className = 'about-dialog-links';
        ABOUT_LINKS.forEach(({ label, url }) => {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = 'about-dialog-link-btn';
            button.textContent = label;
            button.addEventListener('click', () => {
                void openExternal(url);
            });
            linkList.append(button);
        });
        linksSection.append(linkList);

        const dependencySection = dialog.querySelector('[data-about-dependencies]');
        dependencySection.append(createSectionHeading(documentRef, 'Dependencies'));
        dependencyStatus = documentRef.createElement('p');
        dependencyStatus.className = 'about-dialog-dependency-status';
        dependencyStatus.textContent = 'Loading package metadata…';
        dependencyList = documentRef.createElement('div');
        dependencyList.className = 'about-dialog-dependencies';
        dependencySection.append(dependencyStatus, dependencyList);

        initLucideIcons();
        return dialog;
    }

    async function loadDependencies() {
        if (loadedDependencies || typeof fetchImpl !== 'function') {
            return;
        }

        try {
            const response = await fetchImpl('package.json', { cache: 'no-store' });
            if (!response?.ok) {
                throw new Error(`HTTP ${response?.status || 'error'}`);
            }
            const packageData = await response.json();
            const entries = buildDependencyEntries(packageData);
            dependencyList.replaceChildren();
            entries.forEach(({ name, version }) => {
                const row = documentRef.createElement('div');
                row.className = 'about-dialog-dependency-row';
                const nameSpan = documentRef.createElement('span');
                nameSpan.textContent = name;
                const versionSpan = documentRef.createElement('span');
                versionSpan.textContent = version;
                row.append(nameSpan, versionSpan);
                dependencyList.append(row);
            });
            dependencyStatus.textContent = `${entries.length} package entries`;
            loadedDependencies = true;
        } catch (error) {
            dependencyStatus.textContent = `Could not load dependency metadata: ${error.message}`;
        }
    }

    function attachAboutEntry() {
        const popover = documentRef.getElementById('settings-popover');
        if (!popover || popover.querySelector('[data-settings-about-row]')) {
            return;
        }

        const row = documentRef.createElement('div');
        row.className = 'settings-row settings-row-about';
        row.dataset.settingsAboutRow = 'true';

        const label = documentRef.createElement('span');
        label.className = 'settings-label';
        label.textContent = 'About';

        const controls = documentRef.createElement('div');
        controls.className = 'settings-controls';

        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'settings-toggle';
        button.textContent = 'OPEN';
        button.addEventListener('click', () => {
            void openDialog();
            popover.hidden = true;
        });

        controls.append(button);
        row.append(label, controls);
        popover.append(row);
    }

    async function openDialog() {
        const aboutDialog = ensureDialog();
        aboutDialog.querySelector('[data-about-version]').textContent = getAppVersionLabel();
        aboutDialog.querySelector('[data-about-build]').textContent = getAppBuildLabel();
        if (!aboutDialog.open) {
            if (typeof aboutDialog.showModal === 'function') {
                aboutDialog.showModal();
            } else {
                aboutDialog.setAttribute('open', '');
            }
        }
        await loadDependencies();
    }

    async function setupTauriMenuHook() {
        if (tauriAboutUnlisten) {
            return;
        }
        const listen = await getTauriEventListener();
        if (typeof listen !== 'function') {
            return;
        }
        tauriAboutUnlisten = await listen('show-about', () => {
            void openDialog();
        });
    }

    function setup() {
        ensureDialog();
        attachAboutEntry();
        void setupTauriMenuHook();
    }

    return {
        openDialog,
        setup,
    };
}
