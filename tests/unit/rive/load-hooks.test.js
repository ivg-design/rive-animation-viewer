import { runUserOnLoadWithVmRestore } from '../../../src/app/rive/instance/load-hooks.js';

describe('rive/instance/load-hooks', () => {
    it('restores immediately after a manual ViewModel bind and before user writes continue', () => {
        const order = [];
        const board = { name: 'Board' };
        const riveInstance = {
            viewModelInstance: null,
            bindViewModelInstance(instance) {
                this.viewModelInstance = instance;
            },
        };
        const originalBind = riveInstance.bindViewModelInstance;

        runUserOnLoadWithVmRestore({
            beforeUserOnLoad: () => {
                order.push(`restore:${riveInstance.viewModelInstance?.name || 'unbound'}`);
            },
            riveInstance,
            userOnLoad: () => {
                order.push('user:before-bind');
                riveInstance.bindViewModelInstance(board);
                order.push('user:after-bind');
            },
        });

        expect(order).toEqual([
            'restore:unbound',
            'user:before-bind',
            'restore:Board',
            'user:after-bind',
        ]);
        expect(riveInstance.bindViewModelInstance).toBe(originalBind);
    });
});
