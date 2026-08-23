export function createLatestSelectionScheduler(setTimeoutFn) {
    let pendingTask = null;
    return function scheduleSelectionChange(callback) {
        if (pendingTask) pendingTask.cancelled = true;
        const task = { cancelled: false };
        pendingTask = task;
        const run = () => {
            if (task.cancelled) return;
            pendingTask = null;
            callback();
        };
        if (typeof setTimeoutFn === 'function') {
            setTimeoutFn(run, 0);
        } else {
            run();
        }
    };
}
