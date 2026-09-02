export function normalizeStateMachineSelection(value) {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return [value];
    }
    return [];
}

export async function detectDefaultStateMachineName(
    runtime,
    { documentRef = globalThis.document, fileBuffer, fileUrl, artboardName } = {},
) {
    const fileApiDetected = await readDefaultStateMachineFromRiveFile(runtime, {
        fileBuffer,
        fileUrl,
        artboardName,
    });
    if (fileApiDetected.resolved) {
        return fileApiDetected.name;
    }

    return detectDefaultStateMachineFromProbeInstance(runtime, {
        documentRef,
        fileBuffer,
        fileUrl,
        artboardName,
    });
}

export async function detectDefaultStateMachineFromRiveFile(runtime, { fileBuffer, fileUrl, artboardName } = {}) {
    const result = await readDefaultStateMachineFromRiveFile(runtime, { fileBuffer, fileUrl, artboardName });
    return result.name;
}

async function readDefaultStateMachineFromRiveFile(runtime, { fileBuffer, fileUrl, artboardName } = {}) {
    const unavailable = { name: null, resolved: false };
    if (!runtime || typeof runtime.RiveFile !== 'function') {
        return unavailable;
    }

    let probeFile = null;
    let nativeArtboard = null;
    try {
        const fileConfig = (fileBuffer instanceof ArrayBuffer)
            ? { buffer: fileBuffer.slice(0) }
            : { src: fileUrl };
        probeFile = new runtime.RiveFile(fileConfig);
        if (typeof probeFile.init === 'function') {
            await probeFile.init();
        }

        // Modern public RiveFile wrappers expose the native file through
        // getInstance(), not artboard lookups. That call acquires one wrapper
        // reference; the single cleanup below releases it after the artboard.
        const hasArtboardLookup = ['artboardByName', 'defaultArtboard', 'artboardByIndex']
            .some((method) => typeof probeFile[method] === 'function');
        const file = hasArtboardLookup ? probeFile : probeFile.getInstance?.();
        if (!file) return unavailable;
        let artboard = null;
        if (artboardName && typeof file.artboardByName === 'function') {
            artboard = file.artboardByName(artboardName);
        }
        if (!artboard && typeof file.defaultArtboard === 'function') {
            artboard = file.defaultArtboard();
        }
        if (!artboard && typeof file.artboardByIndex === 'function') {
            artboard = file.artboardByIndex(0);
        }
        if (file !== probeFile) nativeArtboard = artboard;
        if (!artboard) {
            return unavailable;
        }

        if (typeof artboard.stateMachineCount === 'function' && typeof artboard.stateMachineByIndex === 'function') {
            const count = artboard.stateMachineCount();
            // A known-empty artboard is a successful metadata result. Do not
            // construct a Rive player just to reconfirm that it has no SM.
            if (count === 0) return { name: null, resolved: true };
            if (count > 0) {
                const stateMachine = artboard.stateMachineByIndex(0);
                if (stateMachine?.name) {
                    return { name: stateMachine.name, resolved: true };
                }
            }
        }

        if (Array.isArray(artboard.stateMachineNames)) {
            return { name: artboard.stateMachineNames[0] || null, resolved: true };
        }
    } catch (error) {
        console.warn('[rive-viewer] RiveFile state machine detection failed:', error);
    } finally {
        try {
            nativeArtboard?.delete?.();
        } catch {
            /* noop */
        }
        try {
            probeFile?.cleanup?.();
        } catch {
            /* noop */
        }
    }
    return unavailable;
}

export function detectDefaultStateMachineFromProbeInstance(
    runtime,
    { documentRef = globalThis.document, fileBuffer, fileUrl, artboardName } = {},
) {
    if (!runtime || typeof runtime.Rive !== 'function') {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        let probeInstance = null;
        let settled = false;
        let timeoutId = null;
        const probeCanvas = documentRef.createElement('canvas');
        probeCanvas.width = 1;
        probeCanvas.height = 1;

        const finalize = (name) => {
            if (settled) {
                return;
            }
            settled = true;
            try {
                probeInstance?.cleanup?.();
            } catch {
                /* noop */
            }
            if (typeof name === 'string' && name.trim().length > 0) {
                resolve(name.trim());
            } else {
                resolve(null);
            }
        };

        const finish = (name) => {
            clearTimeout(timeoutId);
            finalize(name);
        };

        try {
            const probeConfig = {
                autoplay: false,
                autoBind: false,
                canvas: probeCanvas,
                onLoad: () => {
                    const names = Array.isArray(probeInstance?.stateMachineNames)
                        ? probeInstance.stateMachineNames
                        : [];
                    finish(names[0] || null);
                },
                onLoadError: (error) => {
                    console.warn('[rive-viewer] probe instance onLoadError:', error);
                    finish(null);
                },
            };

            if (fileBuffer instanceof ArrayBuffer) {
                probeConfig.buffer = fileBuffer.slice(0);
            } else {
                probeConfig.src = fileUrl;
            }
            if (artboardName) {
                probeConfig.artboard = artboardName;
            }

            probeInstance = new runtime.Rive(probeConfig);
        } catch (error) {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            console.warn('[rive-viewer] probe instance state machine detection failed:', error);
            finalize(null);
        }

        if (settled) {
            return;
        }

        timeoutId = setTimeout(() => {
            console.warn('[rive-viewer] probe instance detection timed out');
            finalize(null);
        }, 5000);
    });
}
