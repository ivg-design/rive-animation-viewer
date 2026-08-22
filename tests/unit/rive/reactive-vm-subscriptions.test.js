import { createReactiveVmSubscriptionSession } from '../../../src/app/rive/view-model/reactive-subscriptions.js';

function createManualScheduler() {
    const tasks = [];
    return {
        flush() {
            const pending = tasks.splice(0);
            pending.forEach((task) => {
                if (!task.cancelled) {
                    task.callback();
                }
            });
        },
        get pendingCount() {
            return tasks.filter((task) => !task.cancelled).length;
        },
        schedule(callback) {
            const task = { callback, cancelled: false };
            tasks.push(task);
            return () => {
                task.cancelled = true;
            };
        },
    };
}

function createReactiveAccessor() {
    const listeners = new Set();
    return {
        emit(...args) {
            [...listeners].forEach((listener) => listener(...args));
        },
        off(callback) {
            listeners.delete(callback);
        },
        on(callback) {
            listeners.add(callback);
        },
        get listenerCount() {
            return listeners.size;
        },
    };
}

describe('reactive ViewModel subscriptions', () => {
    it('caches property and list accessor resolution per ViewModel instance', () => {
        const numberAccessor = createReactiveAccessor();
        const listAccessor = createReactiveAccessor();
        const instance = {
            list: vi.fn(() => listAccessor),
            number: vi.fn(() => numberAccessor),
        };
        const session = createReactiveVmSubscriptionSession();

        expect(session.getCachedPropertyAccessor(instance, 'speed', 'number')).toMatchObject({
            accessor: numberAccessor,
            cacheHit: false,
            kind: 'number',
        });
        expect(session.getCachedPropertyAccessor(instance, 'speed', 'number')).toMatchObject({
            accessor: numberAccessor,
            cacheHit: true,
            kind: 'number',
        });
        expect(session.getCachedListAccessor(instance, 'rows')).toMatchObject({
            accessor: listAccessor,
            cacheHit: false,
            kind: 'list',
        });
        expect(session.getCachedListAccessor(instance, 'rows')).toMatchObject({
            accessor: listAccessor,
            cacheHit: true,
            kind: 'list',
        });

        expect(instance.number).toHaveBeenCalledTimes(1);
        expect(instance.list).toHaveBeenCalledTimes(1);
        expect(session.getCapabilityStats().accessors).toEqual({
            cacheHits: 2,
            cacheMisses: 2,
            listResolutions: 2,
            propertyResolutions: 2,
        });
    });

    it('coalesces value and list notifications into one scheduled flush', () => {
        const scheduler = createManualScheduler();
        const numberAccessor = createReactiveAccessor();
        const listAccessor = createReactiveAccessor();
        const valueBatches = [];
        const listBatches = [];
        const session = createReactiveVmSubscriptionSession({
            onListInvalidated: (entries) => listBatches.push(entries),
            onValueInvalidated: (entries) => valueBatches.push(entries),
            schedule: scheduler.schedule,
        });

        expect(session.subscribeProperty({
            accessor: numberAccessor,
            kind: 'number',
            path: 'car/speed',
            propertyName: 'speed',
        }).reactive).toBe(true);
        expect(session.subscribeList({
            accessor: listAccessor,
            path: 'leaderboard/rows',
            propertyName: 'rows',
        }).reactive).toBe(true);

        numberAccessor.emit(10);
        numberAccessor.emit(20);
        listAccessor.emit();
        listAccessor.emit();

        expect(scheduler.pendingCount).toBe(1);
        expect(valueBatches).toEqual([]);
        expect(listBatches).toEqual([]);

        scheduler.flush();

        expect(valueBatches).toHaveLength(1);
        expect(valueBatches[0]).toEqual([
            expect.objectContaining({
                count: 2,
                hasValue: true,
                kind: 'number',
                path: 'car/speed',
                value: 20,
            }),
        ]);
        expect(listBatches).toHaveLength(1);
        expect(listBatches[0]).toEqual([
            expect.objectContaining({ count: 2, kind: 'list', path: 'leaderboard/rows' }),
        ]);
        expect(session.getCapabilityStats().notifications).toEqual({
            flushes: 1,
            list: 2,
            value: 2,
        });
    });

    it('reports per-accessor fallbacks without creating unremovable listeners', () => {
        const missingOff = { on: vi.fn() };
        const missingOn = { off: vi.fn() };
        const throwing = {
            off: vi.fn(),
            on: vi.fn(() => {
                throw new Error('unsupported');
            }),
        };
        const session = createReactiveVmSubscriptionSession();

        expect(session.subscribeProperty({ accessor: missingOff, path: 'a', propertyName: 'a' })).toMatchObject({
            fallback: true,
            reason: 'missing-off',
        });
        expect(session.subscribeProperty({ accessor: missingOn, path: 'b', propertyName: 'b' })).toMatchObject({
            fallback: true,
            reason: 'missing-on',
        });
        expect(session.subscribeList({ accessor: throwing, path: 'rows', propertyName: 'rows' })).toMatchObject({
            fallback: true,
            reason: 'subscribe-failed',
        });
        expect(missingOff.on).not.toHaveBeenCalled();
        expect(throwing.off).toHaveBeenCalledTimes(1);
        expect(session.getFallbackReports()).toEqual([
            expect.objectContaining({ path: 'a', reason: 'missing-off' }),
            expect.objectContaining({ path: 'b', reason: 'missing-on' }),
            expect.objectContaining({ path: 'rows', reason: 'subscribe-failed' }),
        ]);
        expect(session.getCapabilityStats()).toMatchObject({
            capabilities: { missingOff: 1, missingOn: 1, onAndOff: 1 },
            subscriptions: { active: 0, attempted: 3, fallback: 3, reactive: 0 },
        });
    });

    it('deduplicates active accessors and removes every callback during cleanup', () => {
        const scheduler = createManualScheduler();
        const accessor = createReactiveAccessor();
        const onValueInvalidated = vi.fn();
        const session = createReactiveVmSubscriptionSession({
            onValueInvalidated,
            schedule: scheduler.schedule,
        });

        const first = session.subscribeProperty({ accessor, kind: 'number', path: 'speed', propertyName: 'speed' });
        const duplicate = session.subscribeProperty({ accessor, kind: 'number', path: 'speed', propertyName: 'speed' });
        expect(first.reactive).toBe(true);
        expect(duplicate).toMatchObject({ duplicate: true, reactive: true });
        expect(accessor.listenerCount).toBe(1);

        accessor.emit(42);
        expect(scheduler.pendingCount).toBe(1);
        session.cleanup();
        session.cleanup();
        scheduler.flush();

        expect(accessor.listenerCount).toBe(0);
        expect(onValueInvalidated).not.toHaveBeenCalled();
        expect(session.getCapabilityStats()).toMatchObject({
            closed: true,
            subscriptions: { active: 0, reactive: 1 },
        });
        expect(session.subscribeProperty({ accessor, path: 'late', propertyName: 'late' })).toMatchObject({
            fallback: true,
            reason: 'session-closed',
        });
    });

    it('delivers list invalidations and preserves a falsy value-consumer error', () => {
        const scheduler = createManualScheduler();
        const valueAccessor = createReactiveAccessor();
        const listAccessor = createReactiveAccessor();
        const onListInvalidated = vi.fn();
        const session = createReactiveVmSubscriptionSession({
            onListInvalidated,
            onValueInvalidated: () => {
                throw 0;
            },
            schedule: scheduler.schedule,
        });
        session.subscribeProperty({ accessor: valueAccessor, path: 'value', propertyName: 'value' });
        session.subscribeList({ accessor: listAccessor, path: 'rows', propertyName: 'rows' });

        valueAccessor.emit(1);
        listAccessor.emit();

        let thrown = null;
        try {
            session.flush();
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBe(0);
        expect(onListInvalidated).toHaveBeenCalledOnce();
    });
});
