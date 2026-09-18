import { MIN_SCRIPTING_RUNTIME_VERSION } from '../../core/constants.js';
import { isSemverAtLeast } from './runtime-utils.js';

export function createRuntimeWarningReporter({
    getRuntimeVersion,
    logEvent,
    runtimeWarningsShown,
    showError,
} = {}) {
    function warnIfRuntimeLacksScripting(runtimeName) {
        const version = getRuntimeVersion(runtimeName);
        if (!version || isSemverAtLeast(version, MIN_SCRIPTING_RUNTIME_VERSION)) return;
        const key = `${runtimeName}@${version}`;
        if (runtimeWarningsShown.has(key)) return;
        runtimeWarningsShown.add(key);
        showError(`Runtime ${key} is below ${MIN_SCRIPTING_RUNTIME_VERSION}; VM scripting may be unavailable.`);
    }

    function warnIfRuntimeHasAuthoredLayoutRisk(runtimeName) {
        const version = getRuntimeVersion(runtimeName);
        if (version !== '2.40.0') return;
        const key = `authored-layout:${runtimeName}@${version}`;
        if (runtimeWarningsShown.has(key)) return;
        runtimeWarningsShown.add(key);
        const message = `Runtime ${runtimeName}@${version} has a known authored-layout regression that can displace nested images. Use 2.39.2 unless you are explicitly testing this runtime.`;
        showError(message);
        logEvent('native', 'runtime-layout-risk', message);
    }

    return { warnIfRuntimeHasAuthoredLayoutRisk, warnIfRuntimeLacksScripting };
}
