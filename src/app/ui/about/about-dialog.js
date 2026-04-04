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

function createSectionHeaderRow(documentRef, titleText, detailText = '') {
    const row = documentRef.createElement('div');
    row.className = 'about-dialog-card-heading';

    row.append(createSectionHeading(documentRef, titleText));

    if (detailText) {
        const detail = documentRef.createElement('span');
        detail.className = 'about-dialog-card-detail';
        detail.textContent = detailText;
        row.append(detail);
    }

    return row;
}

function createDefinitionGrid(documentRef, rows = [], className = '') {
    const grid = documentRef.createElement('dl');
    grid.className = `about-dialog-grid ${className}`.trim();
    rows.forEach(({ datasetKey, label, value }) => {
        const dt = documentRef.createElement('dt');
        dt.textContent = label;
        const dd = documentRef.createElement('dd');
        dd.textContent = value;
        if (datasetKey) {
            dd.dataset[datasetKey] = 'true';
        }
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
    let menuHookRetryTimer = null;
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
                <div class="about-dialog-hero">
                    <div class="about-dialog-hero-brand">
                        <div class="about-dialog-appmark" aria-hidden="true">
                            <img src="icons/app-icon.png" alt="" class="about-dialog-appmark-image">
                        </div>
                        <div class="about-dialog-hero-copy">
                            <p class="about-dialog-kicker">RAV // Desktop</p>
                            <h2>${ABOUT_APP_NAME}</h2>
                            <p class="about-dialog-summary-text">Inspect, drive, export, and automate .riv files with live editor injection, ViewModel tooling, a JavaScript REPL, and MCP control.</p>
                        </div>
                    </div>
                    <div class="about-dialog-hero-side">
                        <button type="button" class="icon-btn icon-btn-ghost about-dialog-close" aria-label="Close">
                            <i data-lucide="x" class="lucide-18"></i>
                        </button>
                        <div class="about-dialog-build-pill">v<span data-about-version></span> · <span data-about-build></span></div>
                        <div class="about-dialog-runtime-line"><span class="dot dot-sm" aria-hidden="true"></span><span data-about-runtime></span></div>
                    </div>
                </div>
                <div class="about-dialog-body">
                    <section class="about-dialog-card about-dialog-card-build" data-about-metadata></section>
                    <section class="about-dialog-card about-dialog-card-links" data-about-links></section>
                    <section class="about-dialog-card about-dialog-card-credits" data-about-credits></section>
                    <section class="about-dialog-card about-dialog-card-dependencies" data-about-dependencies></section>
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
            createSectionHeaderRow(documentRef, 'Build Matrix'),
            createDefinitionGrid(documentRef, [
                { datasetKey: 'aboutVersionDetail', label: 'Version', value: getAppVersionLabel() },
                { datasetKey: 'aboutBuildDetail', label: 'Build', value: getAppBuildLabel() },
                { datasetKey: 'aboutRuntimeDetail', label: 'Runtime', value: `${String(getCurrentRuntime()).toUpperCase()} ${getCurrentRuntimeVersion()}` },
                { datasetKey: 'aboutLicenseDetail', label: 'License', value: ABOUT_LICENSE },
            ], 'about-dialog-grid-build'),
        );

        const creditsSection = dialog.querySelector('[data-about-credits]');
        creditsSection.append(
            createSectionHeaderRow(documentRef, 'Credits + Stack'),
            createDefinitionGrid(documentRef, ABOUT_CREDITS, 'about-dialog-grid-credits'),
        );

        const linksSection = dialog.querySelector('[data-about-links]');
        linksSection.append(createSectionHeaderRow(documentRef, 'Links'));
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
        dependencyStatus = documentRef.createElement('span');
        dependencyStatus.className = 'about-dialog-card-detail';
        dependencyStatus.textContent = 'Loading…';
        dependencySection.append(createSectionHeaderRow(documentRef, 'Dependencies'));
        dependencySection.querySelector('.about-dialog-card-heading')?.append(dependencyStatus);
        dependencyList = documentRef.createElement('div');
        dependencyList.className = 'about-dialog-dependencies';
        dependencySection.append(dependencyList);

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
            dependencyStatus.textContent = `${entries.length} deps`;
            loadedDependencies = true;
        } catch (error) {
            dependencyStatus.textContent = 'Load failed';
            dependencyList.replaceChildren();
            const detail = documentRef.createElement('p');
            detail.className = 'about-dialog-dependency-error';
            detail.textContent = `Could not load dependency metadata: ${error.message}`;
            dependencyList.append(detail);
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
        const runtimeSummary = `${String(getCurrentRuntime()).toUpperCase()} ${getCurrentRuntimeVersion()}`;
        aboutDialog.querySelector('[data-about-version]').textContent = getAppVersionLabel();
        aboutDialog.querySelector('[data-about-build]').textContent = getAppBuildLabel();
        aboutDialog.querySelector('[data-about-runtime]').textContent = runtimeSummary;
        aboutDialog.querySelector('[data-about-version-detail]')?.replaceChildren(getAppVersionLabel());
        aboutDialog.querySelector('[data-about-build-detail]')?.replaceChildren(getAppBuildLabel());
        aboutDialog.querySelector('[data-about-runtime-detail]')?.replaceChildren(runtimeSummary);
        aboutDialog.querySelector('[data-about-license-detail]')?.replaceChildren(ABOUT_LICENSE);
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
            if (menuHookRetryTimer) {
                return;
            }
            menuHookRetryTimer = globalThis.setTimeout(() => {
                menuHookRetryTimer = null;
                void setupTauriMenuHook();
            }, 500);
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
