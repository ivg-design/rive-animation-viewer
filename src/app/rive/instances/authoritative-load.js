import { getStateMachineNames, normalizePlaybackConfig } from '../runtime-compatibility.js';

function hasAnimation(config) {
    return Array.isArray(config.animations)
        ? config.animations.some((entry) => typeof entry === 'string' && entry.trim())
        : typeof config.animations === 'string' && Boolean(config.animations.trim());
}

function defaultArtboard(metadata) {
    const artboards = Array.isArray(metadata?.artboards) ? metadata.artboards : [];
    return artboards.find((entry) => entry?.isDefault)?.name || artboards[0]?.name || null;
}

function buildAuthoritativeConfig(userConfig, configOverrides, forceAutoplay, runtimeVersion, metadata) {
    const { canvasSize: _ignoredCanvasSize, ...sanitized } = userConfig || {};
    let autoplay = forceAutoplay ? true : sanitized.autoplay !== false;
    if (configOverrides && Object.hasOwn(configOverrides, 'autoplay')) {
        autoplay = configOverrides.autoplay !== false;
    }
    const effective = { ...sanitized, autoplay };
    if (configOverrides && typeof configOverrides === 'object') {
        if (['stateMachine', 'stateMachines', 'animations'].some((key) => Object.hasOwn(configOverrides, key))) {
            delete effective.stateMachine;
            delete effective.stateMachines;
            delete effective.animations;
        }
        Object.assign(effective, configOverrides);
    }
    if (!effective.artboard) effective.artboard = defaultArtboard(metadata);
    return { autoplay, config: normalizePlaybackConfig(effective, runtimeVersion) };
}

export async function loadAuthoritativeRiveSurface({
    activateAuthoritativeSurface,
    configOverrides,
    detectDefaultStateMachineName,
    fileBuffer,
    fileName,
    fileUrl,
    forceAutoplay,
    getEditorConfig,
    inspectionMetadata,
    isCurrentLoad,
    populateArtboardSwitcher,
    runtimeAsset,
    runtimeVersion,
    syncArtboardStateAfterLoad,
    syncArtboardStateFromConfig,
} = {}) {
    const { autoplay, config } = buildAuthoritativeConfig(
        getEditorConfig(), configOverrides, forceAutoplay, runtimeVersion, inspectionMetadata,
    );
    let configuredStateMachines = getStateMachineNames(config);
    let configuredAnimation = hasAnimation(config);

    if (!configuredStateMachines.length && !configuredAnimation) {
        const detected = await detectDefaultStateMachineName(runtimeAsset, {
            artboardName: config.artboard,
            fileBuffer,
            fileUrl,
        });
        if (!isCurrentLoad()) return false;
        if (detected) config.stateMachines = detected;
        configuredStateMachines = getStateMachineNames(config);
        configuredAnimation = hasAnimation(config);
    }

    syncArtboardStateFromConfig({
        animations: config.animations,
        artboard: config.artboard,
        configuredStateMachines,
        hasConfiguredAnimation: configuredAnimation,
    });
    syncArtboardStateAfterLoad(null, config);
    populateArtboardSwitcher();

    const activated = await activateAuthoritativeSurface({ autoplay });
    if (!isCurrentLoad()) return false;
    if (!activated) throw new Error('The playback surface did not complete activation.');
    return { config, fileName };
}
