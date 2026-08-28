export function createLatestLoadTransition() {
    let latestId = 0;

    return {
        begin() {
            latestId += 1;
            return latestId;
        },
        isCurrent(id) {
            return id === latestId;
        },
    };
}

export function waitForRiveLoad(loadRiveAnimation, fileUrl, fileName, options = {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const resolveOnce = () => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };
        const rejectOnce = (error) => {
            if (!settled) {
                settled = true;
                reject(error || new Error('Animation load failed'));
            }
        };

        try {
            Promise.resolve(loadRiveAnimation(fileUrl, fileName, {
                ...options,
                onLoaded: resolveOnce,
                onLoadError: rejectOnce,
            })).catch(rejectOnce);
        } catch (error) {
            rejectOnce(error);
        }
    });
}
