import { createVmControlsController } from '../../../src/app/rive/vm-controls.js';

function createObservableAccessor(value) {
    const listeners = new Set();
    let currentValue = value;
    let readCount = 0;
    return {
        emit() {
            [...listeners].forEach((listener) => listener(currentValue));
        },
        get listenerCount() {
            return listeners.size;
        },
        get readCount() {
            return readCount;
        },
        resetReadCount() {
            readCount = 0;
        },
        off(listener) {
            listeners.delete(listener);
        },
        on(listener) {
            listeners.add(listener);
        },
        get value() {
            readCount += 1;
            return currentValue;
        },
        set value(nextValue) {
            currentValue = nextValue;
        },
    };
}

function createManualScheduler() {
    const tasks = [];
    return {
        flush() {
            tasks.splice(0).forEach((task) => {
                if (!task.cancelled) task.callback();
            });
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

function createElements() {
    document.body.innerHTML = `
        <div id="main-grid"></div>
        <span id="vm-controls-count"></span>
        <p id="vm-controls-empty"></p>
        <div id="vm-controls-tree"></div>
    `;
    return {
        mainGrid: document.getElementById('main-grid'),
        vmControlsCount: document.getElementById('vm-controls-count'),
        vmControlsEmpty: document.getElementById('vm-controls-empty'),
        vmControlsTree: document.getElementById('vm-controls-tree'),
    };
}

describe('reactive ViewModel controller integration', () => {
    it('updates visible values and rebuilds list topology reactively without polling', () => {
        const elements = createElements();
        const scheduler = createManualScheduler();
        const count = createObservableAccessor(3);
        const firstSpeed = createObservableAccessor(12);
        const listListeners = new Set();
        const items = [{
            number: (name) => (name === 'speed' ? firstSpeed : null),
            properties: [{ name: 'speed' }],
        }];
        const list = {
            emit() {
                [...listListeners].forEach((listener) => listener());
            },
            instanceAt: (index) => items[index] || null,
            get length() {
                return items.length;
            },
            get listenerCount() {
                return listListeners.size;
            },
            off: (listener) => listListeners.delete(listener),
            on: (listener) => listListeners.add(listener),
        };
        const rootVm = {
            list: (name) => (name === 'items' ? list : null),
            number: (name) => (name === 'count' ? count : null),
            properties: [{ name: 'count' }, { name: 'items' }],
            viewModelName: 'RootVM',
        };
        const clearIntervalFn = vi.fn();
        const setIntervalFn = vi.fn();
        const controller = createVmControlsController({
            clearIntervalFn,
            elements,
            getRiveInstance: () => ({
                stateMachineNames: [],
                viewModelInstance: rootVm,
            }),
            scheduleReactiveFlush: scheduler.schedule,
            setIntervalFn,
            syncMode: 'reactive',
        });

        controller.renderVmInputControls();

        const findNumberInput = (path) => Array.from(elements.vmControlsTree.querySelectorAll('.vm-control-row'))
            .find((row) => row.querySelector('.vm-control-label')?.title === path)
            ?.querySelector('input[type="number"]');
        const countInput = findNumberInput('count');
        expect(countInput.value).toBe('3');
        expect(setIntervalFn).not.toHaveBeenCalled();
        expect(controller.getVmSyncDiagnostics()).toMatchObject({
            fallbackBindingCount: 0,
            fallbackTopology: false,
            timerActive: false,
            topologyStrategy: 'reactive',
            valueStrategy: 'reactive',
        });
        expect(count.listenerCount).toBe(1);
        expect(list.listenerCount).toBe(1);

        count.resetReadCount();
        firstSpeed.resetReadCount();
        count.value = 9;
        count.emit();
        expect(countInput.value).toBe('3');
        scheduler.flush();
        expect(countInput.value).toBe('9');
        expect(count.readCount).toBe(0);
        expect(firstSpeed.readCount).toBe(0);

        const secondSpeed = createObservableAccessor(24);
        items.push({
            number: (name) => (name === 'speed' ? secondSpeed : null),
            properties: [{ name: 'speed' }],
        });
        list.emit();
        scheduler.flush();

        expect(elements.vmControlsCount.textContent).toBe('3');
        expect(elements.vmControlsTree.textContent).toContain('items [2]');
        expect(findNumberInput('items/1/speed').value).toBe('24');
        expect(setIntervalFn).not.toHaveBeenCalled();

        controller.resetVmInputControls();
        expect(count.listenerCount).toBe(0);
        expect(list.listenerCount).toBe(0);
        expect(firstSpeed.listenerCount).toBe(0);
        expect(secondSpeed.listenerCount).toBe(0);
        expect(clearIntervalFn).not.toHaveBeenCalled();
        expect(controller.getVmSyncDiagnostics()).toMatchObject({
            reactive: {
                cleanupErrors: 0,
                closed: true,
                subscriptions: { active: 0 },
            },
        });
    });

    it('polls scalar values while keeping list topology reactive in auto mode', () => {
        const elements = createElements();
        const scheduler = createManualScheduler();
        const count = createObservableAccessor(3);
        const listListeners = new Set();
        const items = [];
        const list = {
            emit() {
                [...listListeners].forEach((listener) => listener());
            },
            instanceAt: (index) => items[index] || null,
            get length() {
                return items.length;
            },
            get listenerCount() {
                return listListeners.size;
            },
            off: (listener) => listListeners.delete(listener),
            on: (listener) => listListeners.add(listener),
        };
        const rootVm = {
            list: (name) => (name === 'items' ? list : null),
            number: (name) => (name === 'count' ? count : null),
            properties: [{ name: 'count' }, { name: 'items' }],
            viewModelName: 'RootVM',
        };
        let poll;
        const setIntervalFn = vi.fn((callback) => {
            poll = callback;
            return 'scalar-poll-timer';
        });
        const controller = createVmControlsController({
            elements,
            getRiveInstance: () => ({
                stateMachineNames: [],
                viewModelInstance: rootVm,
            }),
            scheduleReactiveFlush: scheduler.schedule,
            setIntervalFn,
        });

        controller.renderVmInputControls();

        const findNumberInput = (path) => Array.from(elements.vmControlsTree.querySelectorAll('.vm-control-row'))
            .find((row) => row.querySelector('.vm-control-label')?.title === path)
            ?.querySelector('input[type="number"]');
        const countInput = findNumberInput('count');
        expect(countInput.value).toBe('3');
        expect(count.listenerCount).toBe(0);
        expect(list.listenerCount).toBe(1);
        expect(setIntervalFn).toHaveBeenCalledOnce();
        expect(controller.getVmSyncDiagnostics()).toMatchObject({
            fallbackBindingCount: 1,
            fallbackTopology: false,
            mode: 'auto',
            timerActive: true,
            topologyStrategy: 'reactive',
            valueStrategy: 'polling',
            reactive: {
                subscriptions: {
                    list: 1,
                    value: 0,
                },
            },
        });

        count.value = 9;
        count.emit();
        scheduler.flush();
        expect(countInput.value).toBe('3');
        poll();
        expect(countInput.value).toBe('9');

        const speed = createObservableAccessor(24);
        items.push({
            number: (name) => (name === 'speed' ? speed : null),
            properties: [{ name: 'speed' }],
        });
        list.emit();
        scheduler.flush();

        expect(elements.vmControlsTree.textContent).toContain('items [1]');
        expect(findNumberInput('items/0/speed').value).toBe('24');
        expect(count.listenerCount).toBe(0);
        expect(speed.listenerCount).toBe(0);
        expect(list.listenerCount).toBe(1);
        expect(controller.getVmSyncDiagnostics()).toMatchObject({
            fallbackBindingCount: 2,
            topologyStrategy: 'reactive',
            valueStrategy: 'polling',
        });
    });

    it('keeps explicit polling mode free of scalar and list subscriptions', () => {
        const elements = createElements();
        const count = createObservableAccessor(1);
        const listListeners = new Set();
        const list = {
            instanceAt: () => null,
            length: 0,
            get listenerCount() {
                return listListeners.size;
            },
            off: (listener) => listListeners.delete(listener),
            on: (listener) => listListeners.add(listener),
        };
        const rootVm = {
            list: (name) => (name === 'items' ? list : null),
            number: (name) => (name === 'count' ? count : null),
            properties: [{ name: 'count' }, { name: 'items' }],
            viewModelName: 'RootVM',
        };
        const setIntervalFn = vi.fn(() => 'polling-mode-timer');
        const controller = createVmControlsController({
            elements,
            getRiveInstance: () => ({
                stateMachineNames: [],
                viewModelInstance: rootVm,
            }),
            setIntervalFn,
            syncMode: 'polling',
        });

        controller.renderVmInputControls();

        expect(count.listenerCount).toBe(0);
        expect(list.listenerCount).toBe(0);
        expect(setIntervalFn).toHaveBeenCalledOnce();
        expect(controller.getVmSyncDiagnostics()).toMatchObject({
            fallbackBindingCount: 1,
            fallbackTopology: true,
            mode: 'polling',
            timerActive: true,
            topologyStrategy: 'polling',
            valueStrategy: 'polling',
        });
    });

    it('reconciles a scalar value when its collapsed section is reopened', () => {
        const elements = createElements();
        const scheduler = createManualScheduler();
        const childValue = createObservableAccessor(1);
        const childVm = {
            number: (name) => (name === 'value' ? childValue : null),
            properties: [{ name: 'value' }],
        };
        const rootVm = {
            properties: [{ name: 'child' }],
            viewModel: (name) => (name === 'child' ? childVm : null),
            viewModelName: 'RootVM',
        };
        const controller = createVmControlsController({
            elements,
            getRiveInstance: () => ({
                stateMachineNames: [],
                viewModelInstance: rootVm,
            }),
            scheduleReactiveFlush: scheduler.schedule,
            setIntervalFn: vi.fn(),
            syncMode: 'reactive',
        });

        controller.renderVmInputControls();

        const row = Array.from(elements.vmControlsTree.querySelectorAll('.vm-control-row'))
            .find((candidate) => candidate.querySelector('.vm-control-label')?.title === 'child/value');
        const input = row.querySelector('input[type="number"]');
        const section = row.closest('details.vm-section');
        expect(section.open).toBe(false);
        expect(input.value).toBe('1');
        expect(childValue.listenerCount).toBe(0);

        childValue.value = 2;
        childValue.emit();
        scheduler.flush();
        expect(input.value).toBe('1');

        section.open = true;
        section.dispatchEvent(new Event('toggle'));
        expect(input.value).toBe('2');
        expect(childValue.listenerCount).toBe(1);

        childValue.off = vi.fn(() => {
            throw new Error('cleanup failed');
        });
        controller.resetVmInputControls();
        expect(controller.getVmSyncDiagnostics()).toMatchObject({
            reactive: {
                cleanupErrors: 1,
                closed: true,
                subscriptions: { active: 0 },
            },
        });
    });

    it('defers focused number, string, and color updates until editing finishes', async () => {
        const elements = createElements();
        const scheduler = createManualScheduler();
        const numberValue = createObservableAccessor(1);
        const stringValue = createObservableAccessor('before');
        const colorValue = createObservableAccessor(0xff000000);
        const rootVm = {
            color: (name) => (name === 'color' ? colorValue : null),
            number: (name) => (name === 'number' ? numberValue : null),
            properties: [{ name: 'number' }, { name: 'string' }, { name: 'color' }],
            string: (name) => (name === 'string' ? stringValue : null),
            viewModelName: 'RootVM',
        };
        const controller = createVmControlsController({
            elements,
            getRiveInstance: () => ({
                stateMachineNames: [],
                viewModelInstance: rootVm,
            }),
            scheduleReactiveFlush: scheduler.schedule,
            setIntervalFn: vi.fn(),
            syncMode: 'reactive',
        });

        controller.renderVmInputControls();

        const rowFor = (path) => Array.from(elements.vmControlsTree.querySelectorAll('.vm-control-row'))
            .find((row) => row.querySelector('.vm-control-label')?.title === path);
        const numberInput = rowFor('number').querySelector('input[type="number"]');
        const stringInput = rowFor('string').querySelector('textarea');
        const colorInput = rowFor('color').querySelector('input[type="color"]');

        numberInput.focus();
        numberValue.value = 2;
        numberValue.emit();
        scheduler.flush();
        expect(numberInput.value).toBe('1');
        numberInput.value = '3';
        numberInput.dispatchEvent(new Event('change'));
        numberInput.blur();
        await Promise.resolve();
        expect(numberValue.value).toBe(3);
        expect(numberInput.value).toBe('3');

        stringInput.focus();
        stringValue.value = 'after';
        stringValue.emit();
        scheduler.flush();
        expect(stringInput.value).toBe('before');
        stringInput.blur();
        await Promise.resolve();
        expect(stringInput.value).toBe('after');

        colorInput.focus();
        colorValue.value = 0xff112233;
        colorValue.emit();
        scheduler.flush();
        expect(colorInput.value).toBe('#000000');
        colorInput.blur();
        await Promise.resolve();
        expect(colorInput.value).toBe('#112233');
    });

    it('keeps explicit reactive mode free of polling fallbacks', () => {
        const elements = createElements();
        const scheduler = createManualScheduler();
        const reactiveValue = createObservableAccessor(1);
        let fallbackValue = 2;
        const fallbackAccessor = {
            get value() {
                return fallbackValue;
            },
            set value(nextValue) {
                fallbackValue = nextValue;
            },
        };
        const rootVm = {
            number: (name) => ({
                fallback: fallbackAccessor,
                reactive: reactiveValue,
            })[name] || null,
            properties: [{ name: 'reactive' }, { name: 'fallback' }],
            viewModelName: 'RootVM',
        };
        const setIntervalFn = vi.fn();
        const controller = createVmControlsController({
            elements,
            getRiveInstance: () => ({
                stateMachineNames: [],
                viewModelInstance: rootVm,
            }),
            scheduleReactiveFlush: scheduler.schedule,
            setIntervalFn,
            syncMode: 'reactive',
        });

        controller.renderVmInputControls();

        const findNumberInput = (path) => Array.from(elements.vmControlsTree.querySelectorAll('.vm-control-row'))
            .find((row) => row.querySelector('.vm-control-label')?.title === path)
            ?.querySelector('input[type="number"]');
        const reactiveInput = findNumberInput('reactive');
        const fallbackInput = findNumberInput('fallback');
        expect(controller.getVmSyncDiagnostics()).toMatchObject({
            fallbackBindingCount: 0,
            timerActive: false,
            valueStrategy: 'reactive',
        });
        expect(reactiveValue.listenerCount).toBe(1);
        expect(setIntervalFn).not.toHaveBeenCalled();

        reactiveValue.value = 10;
        reactiveValue.emit();
        fallbackAccessor.value = 20;
        scheduler.flush();
        expect(reactiveInput.value).toBe('10');
        expect(fallbackInput.value).toBe('2');
    });
});
