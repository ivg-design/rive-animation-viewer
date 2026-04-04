export function createStatusHelpers({ getStatusController } = {}) {
    function refreshInfoStrip() {
        getStatusController()?.refreshInfoStrip();
    }

    function updateInfo(message) {
        getStatusController()?.updateInfo(message);
    }

    function showError(message) {
        getStatusController()?.showError(message);
    }

    function hideError() {
        getStatusController()?.hideError();
    }

    function updateVersionInfo(statusMessage) {
        getStatusController()?.updateVersionInfo(statusMessage);
    }

    async function resolveAppVersion() {
        return getStatusController()?.resolveAppVersion();
    }

    return {
        hideError,
        refreshInfoStrip,
        resolveAppVersion,
        showError,
        updateInfo,
        updateVersionInfo,
    };
}
