import { getVmAccessor, safeVmMethodCall } from './accessors.js';

function scheduleOnNextFrame(callback) {
    if (typeof globalThis.requestAnimationFrame === 'function') {
        const frameId = globalThis.requestAnimationFrame(callback);
        return () => globalThis.cancelAnimationFrame?.(frameId);
    }

    let cancelled = false;
    globalThis.queueMicrotask(() => {
        if (!cancelled) {
            callback();
        }
    });
    return () => {
        cancelled = true;
    };
}

function hasMethod(target, methodName) {
    try {
        return typeof target?.[methodName] === 'function';
    } catch {
        return false;
    }
}

function cacheForInstance(cache, instance) {
    if (!instance || (typeof instance !== 'object' && typeof instance !== 'function')) {
        return null;
    }
    let instanceCache = cache.get(instance);
    if (!instanceCache) {
        instanceCache = new Map();
        cache.set(instance, instanceCache);
    }
    return instanceCache;
}

function createInitialStats() {
    return {
        accessors: {
            cacheHits: 0,
            cacheMisses: 0,
            listResolutions: 0,
            propertyResolutions: 0,
        },
        capabilities: {
            missingOff: 0,
            missingOn: 0,
            onAndOff: 0,
        },
        cleanupErrors: 0,
        notifications: {
            flushes: 0,
            list: 0,
            value: 0,
        },
        subscriptions: {
            active: 0,
            attempted: 0,
            fallback: 0,
            list: 0,
            reactive: 0,
            value: 0,
        },
    };
}

/**
 * Owns reactive ViewModel accessor subscriptions for one loaded Rive session.
 * Call cleanup() before replacing or deleting the owning Rive instance.
 */
export function createReactiveVmSubscriptionSession({
    onListInvalidated = () => {},
    onValueInvalidated = () => {},
    schedule = scheduleOnNextFrame,
} = {}) {
    let accessorCache = new WeakMap();
    const activeByAccessor = new Map();
    const fallbackReports = [];
    const pendingListInvalidations = new Map();
    const pendingValueInvalidations = new Map();
    const stats = createInitialStats();
    let cancelScheduledFlush = null;
    let closed = false;

    function resolveCached(instance, cacheKey, resolver, resolutionType) {
        const instanceCache = cacheForInstance(accessorCache, instance);
        stats.accessors[resolutionType] += 1;
        if (!instanceCache) {
            stats.accessors.cacheMisses += 1;
            return { accessor: null, cacheHit: false, kind: null };
        }
        if (instanceCache.has(cacheKey)) {
            stats.accessors.cacheHits += 1;
            return { ...instanceCache.get(cacheKey), cacheHit: true };
        }

        stats.accessors.cacheMisses += 1;
        const resolved = resolver() || { accessor: null, kind: null };
        const cached = {
            accessor: resolved.accessor || null,
            kind: resolved.kind || null,
        };
        instanceCache.set(cacheKey, cached);
        return { ...cached, cacheHit: false };
    }

    function getCachedPropertyAccessor(instance, propertyName, expectedKind = null) {
        const cacheKey = `property:${expectedKind || '*'}:${propertyName || ''}`;
        return resolveCached(instance, cacheKey, () => {
            const resolved = getVmAccessor(instance, propertyName);
            if (!resolved || (expectedKind && resolved.kind !== expectedKind)) {
                return null;
            }
            return resolved;
        }, 'propertyResolutions');
    }

    function getCachedListAccessor(instance, propertyName) {
        const cacheKey = `list:${propertyName || ''}`;
        return resolveCached(instance, cacheKey, () => ({
            accessor: safeVmMethodCall(instance, 'list', propertyName),
            kind: 'list',
        }), 'listResolutions');
    }

    function flushPendingInvalidations() {
        if (closed) {
            return;
        }

        const valueInvalidations = [...pendingValueInvalidations.values()];
        const listInvalidations = [...pendingListInvalidations.values()];
        pendingValueInvalidations.clear();
        pendingListInvalidations.clear();
        if (!valueInvalidations.length && !listInvalidations.length) {
            return;
        }

        stats.notifications.flushes += 1;
        let firstError;
        let hasError = false;
        if (valueInvalidations.length) {
            try {
                onValueInvalidated(valueInvalidations);
            } catch (error) {
                firstError = error;
                hasError = true;
            }
        }
        if (listInvalidations.length) {
            try {
                onListInvalidated(listInvalidations);
            } catch (error) {
                if (!hasError) {
                    firstError = error;
                    hasError = true;
                }
            }
        }
        if (hasError) {
            throw firstError;
        }
    }

    function flush() {
        const cancel = cancelScheduledFlush;
        cancelScheduledFlush = null;
        cancel?.();
        flushPendingInvalidations();
    }

    function ensureFlushScheduled() {
        if (cancelScheduledFlush || closed) {
            return;
        }
        let callbackRanSynchronously = false;
        const cancellation = schedule(() => {
            callbackRanSynchronously = true;
            cancelScheduledFlush = null;
            flushPendingInvalidations();
        });
        if (callbackRanSynchronously) {
            return;
        }
        if (typeof cancellation === 'function') {
            cancelScheduledFlush = cancellation;
        } else if (cancellation && typeof cancellation.cancel === 'function') {
            cancelScheduledFlush = () => cancellation.cancel();
        } else {
            cancelScheduledFlush = () => {};
        }
    }

    function queueInvalidation(record, args) {
        if (closed || !record.active) {
            return;
        }
        const target = record.channel === 'list'
            ? pendingListInvalidations
            : pendingValueInvalidations;
        const existing = target.get(record);
        const invalidation = existing || {
            accessor: record.accessor,
            count: 0,
            kind: record.kind,
            path: record.path,
            propertyName: record.propertyName,
        };
        invalidation.args = args;
        invalidation.count += 1;
        if (record.channel === 'value') {
            invalidation.hasValue = args.length > 0;
            invalidation.value = args[0];
        }
        target.set(record, invalidation);
        stats.notifications[record.channel] += 1;
        ensureFlushScheduled();
    }

    function reportFallback({ accessor = null, channel, kind, path, propertyName, reason }) {
        const report = {
            accessor,
            fallback: true,
            kind,
            path,
            propertyName,
            reactive: false,
            reason,
            unsubscribe: () => {},
        };
        fallbackReports.push({ channel, kind, path, propertyName, reason });
        stats.subscriptions.fallback += 1;
        return report;
    }

    function unsubscribeRecord(record) {
        if (!record?.active) {
            return;
        }
        record.active = false;
        pendingListInvalidations.delete(record);
        pendingValueInvalidations.delete(record);
        try {
            record.accessor.off(record.callback);
        } catch {
            stats.cleanupErrors += 1;
        }
        if (activeByAccessor.get(record.accessor) === record) {
            activeByAccessor.delete(record.accessor);
        }
        stats.subscriptions.active = Math.max(0, stats.subscriptions.active - 1);
    }

    function subscribe({ accessor, channel, kind, path, propertyName }) {
        stats.subscriptions.attempted += 1;
        if (closed) {
            return reportFallback({ accessor, channel, kind, path, propertyName, reason: 'session-closed' });
        }
        if (!accessor) {
            return reportFallback({ accessor, channel, kind, path, propertyName, reason: 'missing-accessor' });
        }

        const existing = activeByAccessor.get(accessor);
        if (existing?.active) {
            return {
                ...existing.report,
                duplicate: true,
            };
        }

        const supportsOn = hasMethod(accessor, 'on');
        const supportsOff = hasMethod(accessor, 'off');
        if (!supportsOn) {
            stats.capabilities.missingOn += 1;
        }
        if (!supportsOff) {
            stats.capabilities.missingOff += 1;
        }
        if (!supportsOn || !supportsOff) {
            const reason = !supportsOn && !supportsOff
                ? 'missing-on-and-off'
                : (!supportsOn ? 'missing-on' : 'missing-off');
            return reportFallback({ accessor, channel, kind, path, propertyName, reason });
        }
        stats.capabilities.onAndOff += 1;

        const record = {
            accessor,
            active: true,
            callback: null,
            channel,
            kind,
            path,
            propertyName,
            report: null,
        };
        record.callback = (...args) => queueInvalidation(record, args);
        try {
            accessor.on(record.callback);
        } catch {
            record.active = false;
            try {
                accessor.off(record.callback);
            } catch {
                stats.cleanupErrors += 1;
            }
            return reportFallback({ accessor, channel, kind, path, propertyName, reason: 'subscribe-failed' });
        }

        const report = {
            accessor,
            fallback: false,
            kind,
            path,
            propertyName,
            reactive: true,
            reason: null,
            unsubscribe: () => unsubscribeRecord(record),
        };
        record.report = report;
        activeByAccessor.set(accessor, record);
        stats.subscriptions.active += 1;
        stats.subscriptions.reactive += 1;
        stats.subscriptions[channel] += 1;
        return report;
    }

    function subscribeProperty({ accessor = null, instance = null, kind = null, path = '', propertyName = '' } = {}) {
        const resolved = accessor
            ? { accessor, kind }
            : getCachedPropertyAccessor(instance, propertyName, kind);
        return subscribe({
            accessor: resolved.accessor,
            channel: 'value',
            kind: resolved.kind || kind || 'unknown',
            path: path || propertyName,
            propertyName,
        });
    }

    function subscribeList({ accessor = null, instance = null, path = '', propertyName = '' } = {}) {
        const resolved = accessor
            ? { accessor, kind: 'list' }
            : getCachedListAccessor(instance, propertyName);
        return subscribe({
            accessor: resolved.accessor,
            channel: 'list',
            kind: 'list',
            path: path || propertyName,
            propertyName,
        });
    }

    function cleanup() {
        if (closed) {
            return;
        }
        closed = true;
        cancelScheduledFlush?.();
        cancelScheduledFlush = null;
        pendingListInvalidations.clear();
        pendingValueInvalidations.clear();
        [...activeByAccessor.values()].forEach(unsubscribeRecord);
        activeByAccessor.clear();
        accessorCache = new WeakMap();
    }

    function getCapabilityStats() {
        return {
            accessors: { ...stats.accessors },
            capabilities: { ...stats.capabilities },
            cleanupErrors: stats.cleanupErrors,
            closed,
            notifications: { ...stats.notifications },
            subscriptions: { ...stats.subscriptions },
        };
    }

    function getFallbackReports() {
        return fallbackReports.map((report) => ({ ...report }));
    }

    return {
        cleanup,
        flush,
        getCachedListAccessor,
        getCachedPropertyAccessor,
        getCapabilityStats,
        getFallbackReports,
        subscribeList,
        subscribeProperty,
    };
}
