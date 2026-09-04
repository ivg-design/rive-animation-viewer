import { getInspectionMetadata } from '../../../rive/runtime-compatibility.js';

function namedEntries(entries) {
    return Array.isArray(entries)
        ? entries.map((entry) => typeof entry === 'string' ? entry : entry?.name).filter(Boolean)
        : [];
}

function missingTargetError(artboardName, requestedPlayback) {
    const label = requestedPlayback.type === 'animation' ? 'Animation' : 'State machine';
    return new Error(`${label} "${requestedPlayback.name}" was not found on artboard "${artboardName}"`);
}

export function assertKnownPlaybackTarget({
    artboardName,
    authoritative,
    requestedPlayback,
    windowRef,
}) {
    const instance = windowRef.riveInst;
    const inspection = instance ? getInspectionMetadata(instance) : null;
    const inspectedArtboards = Array.isArray(inspection?.artboards) ? inspection.artboards : [];
    if (inspectedArtboards.length) {
        const artboard = inspectedArtboards.find((entry) => (
            (typeof entry === 'string' ? entry : entry?.name) === artboardName
        ));
        if (!artboard) throw new Error(`Artboard "${artboardName}" was not found in the loaded file`);
        if (!requestedPlayback?.name) return;
        if (typeof artboard === 'string') {
            throw new Error(`Playback metadata for artboard "${artboardName}" is unavailable`);
        }
        const entries = requestedPlayback.type === 'animation'
            ? artboard.animations
            : artboard.stateMachines;
        if (!namedEntries(entries).includes(requestedPlayback.name)) {
            throw missingTargetError(artboardName, requestedPlayback);
        }
        return;
    }

    const canonical = authoritative?.canonicalState;
    const knownArtboards = namedEntries(canonical?.artboards);
    if (knownArtboards.length && !knownArtboards.includes(artboardName)) {
        throw new Error(`Artboard "${artboardName}" was not found in the loaded file`);
    }
    if (!requestedPlayback?.name) return;
    if (canonical?.artboard !== artboardName) {
        throw new Error(`Playback metadata for artboard "${artboardName}" is unavailable`);
    }
    const names = requestedPlayback.type === 'animation'
        ? namedEntries(canonical?.animationNames)
        : namedEntries(canonical?.stateMachines);
    if (!names.includes(requestedPlayback.name)) {
        throw missingTargetError(artboardName, requestedPlayback);
    }
}
