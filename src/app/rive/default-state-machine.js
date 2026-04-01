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
    const fileApiDetected = await detectDefaultStateMachineFromRiveFile(runtime, {
        fileBuffer,
        fileUrl,
        artboardName,
    });
    if (fileApiDetected) {
        return fileApiDetected;
    }

    return detectDefaultStateMachineFromProbeInstance(runtime, {
        documentRef,
        fileBuffer,
        fileUrl,
        artboardName,
    });
}

export async function detectDefaultStateMachineFromRiveFile(runtime, { fileBuffer, fileUrl, artboardName } = {}) {
    if (!runtime || typeof runtime.RiveFile !== 'function') {
        return null;
    }

    let probeFile = null;
    try {
        const fileConfig = (fileBuffer instanceof ArrayBuffer)
            ? { buffer: fileBuffer.slice(0) }
            : { src: fileUrl };
        probeFile = new runtime.RiveFile(fileConfig);
        if (typeof probeFile.init === 'function') {
            await probeFile.init();
        }

        let artboard = null;
        if (artboardName && typeof probeFile.artboardByName === 'function') {
            artboard = probeFile.artboardByName(artboardName);
        }
        if (!artboard && typeof probeFile.defaultArtboard === 'function') {
            artboard = probeFile.defaultArtboard();
        }
        if (!artboard && typeof probeFile.artboardByIndex === 'function') {
            artboard = probeFile.artboardByIndex(0);
        }
        if (!artboard) {
            return null;
        }

        if (typeof artboard.stateMachineCount === 'function' && typeof artboard.stateMachineByIndex === 'function') {
            const count = artboard.stateMachineCount();
            if (count > 0) {
                const stateMachine = artboard.stateMachineByIndex(0);
                if (stateMachine?.name) {
                    return stateMachine.name;
                }
            }
        }

        if (Array.isArray(artboard.stateMachineNames) && artboard.stateMachineNames.length > 0) {
            return artboard.stateMachineNames[0];
        }
    } catch (error) {
        console.warn('[rive-viewer] RiveFile state machine detection failed:', error);
    } finally {
        try {
            probeFile?.cleanup?.();
        } catch {
            /* noop */
        }
    }
    return null;
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
