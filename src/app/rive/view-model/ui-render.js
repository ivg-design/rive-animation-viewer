import {
    argbToColorMeta,
    clamp,
    hexToRgb,
    rgbAlphaToArgb,
} from './color-utils.js';
import { shouldResumePlaybackForTrigger } from './accessors.js';
import { countAllInputs } from './hierarchy.js';
import { appendVmImageControl } from './image-control.js';
import { dispatchVmControlMutation } from '../control-events.js';
import { updateStringInputRows } from './ui/binding-sync.js';

export function createVmControlRowFactory({
    documentRef,
    canMutateRemoteControls = () => true,
    fireStateMachineTriggerByName,
    getRiveInstance,
    getEmbeddedImageAssets = () => [],
    getLoadedRuntime = () => null,
    getVmControlRenderEpoch = () => 0,
    isAuthoritativeChildMode = false,
    logEvent,
    onRemoteMutationFailure = () => {},
    pickImageFile = null,
    registerVmControlBinding,
    resolveControlAccessor,
    resolveVmAccessor,
}) {
    const relayRemoteMutation = (detail) => {
        if (!isAuthoritativeChildMode) return false;
        if (!canMutateRemoteControls()) {
            onRemoteMutationFailure('Playback controls are unavailable while the renderer is recovering.');
            // Consume the change event so it cannot write the hidden parent.
            return true;
        }
        if (!dispatchVmControlMutation(documentRef, detail)) {
            onRemoteMutationFailure('Unable to send the control change to the playback surface.');
        }
        return true;
    };

    return function createVmControlRow(descriptor) {
        const row = documentRef.createElement('div');
        row.className = 'vm-control-row';

        const label = documentRef.createElement('div');
        label.className = 'vm-control-label';
        label.textContent = `${descriptor.name} (${descriptor.kind})`;
        label.title = descriptor.path;

        const inputContainer = documentRef.createElement('div');
        inputContainer.className = 'vm-control-input';

        const accessor = resolveControlAccessor(descriptor);
        const isDisabled = !accessor;

        if (descriptor.kind === 'number') {
            const numberInput = documentRef.createElement('input');
            numberInput.type = 'number';
            numberInput.step = 'any';
            numberInput.value = Number.isFinite(accessor?.value) ? String(accessor.value) : '0';
            numberInput.disabled = isDisabled;
            numberInput.addEventListener('change', () => {
                const nextValue = Number(numberInput.value);
                if (!Number.isFinite(nextValue)) {
                    return;
                }
                if (relayRemoteMutation({ descriptor, kind: 'number', value: nextValue })) {
                    logEvent('ui', 'vm-number', `Requested ${descriptor.path} = ${nextValue}`);
                    return;
                }
                const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'number' });
                if (liveAccessor) {
                    liveAccessor.value = nextValue;
                    const source = descriptor.source === 'state-machine' ? 'sm-number' : 'vm-number';
                    logEvent('ui', source, `Set ${descriptor.path} = ${nextValue}`);
                    dispatchVmControlMutation(documentRef, { descriptor, kind: 'number', value: nextValue });
                }
            });
            registerVmControlBinding(descriptor, { input: numberInput, kind: 'number' });
            inputContainer.appendChild(numberInput);
        } else if (descriptor.kind === 'boolean') {
            const checkbox = documentRef.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = Boolean(accessor?.value);
            checkbox.disabled = isDisabled;
            checkbox.addEventListener('change', () => {
                if (relayRemoteMutation({ descriptor, kind: 'boolean', value: checkbox.checked })) {
                    logEvent('ui', 'vm-boolean', `Requested ${descriptor.path} = ${checkbox.checked}`);
                    return;
                }
                const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'boolean' });
                if (liveAccessor) {
                    liveAccessor.value = checkbox.checked;
                    const source = descriptor.source === 'state-machine' ? 'sm-boolean' : 'vm-boolean';
                    logEvent('ui', source, `Set ${descriptor.path} = ${checkbox.checked}`);
                    dispatchVmControlMutation(documentRef, { descriptor, kind: 'boolean', value: checkbox.checked });
                }
            });
            registerVmControlBinding(descriptor, { input: checkbox, kind: 'boolean' });
            inputContainer.appendChild(checkbox);
        } else if (descriptor.kind === 'string') {
            const textInput = documentRef.createElement('textarea');
            textInput.value = typeof accessor?.value === 'string' ? accessor.value : '';
            updateStringInputRows(textInput, textInput.value);
            textInput.disabled = isDisabled;
            textInput.addEventListener('input', () => {
                updateStringInputRows(textInput, textInput.value);
            });
            textInput.addEventListener('change', () => {
                if (relayRemoteMutation({ descriptor, kind: 'string', value: textInput.value })) {
                    logEvent('ui', 'vm-string', `Requested ${descriptor.path} = ${textInput.value}`);
                    return;
                }
                const liveAccessor = resolveVmAccessor(descriptor.path, 'string');
                if (liveAccessor) {
                    liveAccessor.value = textInput.value;
                    logEvent('ui', 'vm-string', `Set ${descriptor.path} = ${textInput.value}`);
                    dispatchVmControlMutation(documentRef, { descriptor, kind: 'string', value: textInput.value });
                }
            });
            registerVmControlBinding(descriptor, { input: textInput, kind: 'string' });
            inputContainer.appendChild(textInput);
        } else if (descriptor.kind === 'enum') {
            const select = documentRef.createElement('select');
            let enumInteractionActive = false;
            let onEnumInteractionEnd = () => {};
            const beginEnumInteraction = () => {
                enumInteractionActive = true;
            };
            const endEnumInteraction = () => {
                if (!enumInteractionActive) return;
                enumInteractionActive = false;
                onEnumInteractionEnd();
            };
            const values = Array.isArray(accessor?.values) ? accessor.values : [];
            values.forEach((value) => {
                const option = documentRef.createElement('option');
                option.value = value;
                option.textContent = value;
                select.appendChild(option);
            });
            if (!values.length) {
                const fallback = documentRef.createElement('option');
                fallback.value = '';
                fallback.textContent = '(no enum values)';
                select.appendChild(fallback);
            }
            if (typeof accessor?.value === 'string') {
                select.value = accessor.value;
            }
            select.disabled = isDisabled || values.length === 0;
            select.addEventListener('pointerdown', beginEnumInteraction);
            select.addEventListener('mousedown', beginEnumInteraction);
            select.addEventListener('touchstart', beginEnumInteraction, { passive: true });
            select.addEventListener('focus', beginEnumInteraction);
            select.addEventListener('keydown', (event) => {
                if ([' ', 'ArrowDown', 'ArrowUp', 'Enter', 'F4'].includes(event.key)) beginEnumInteraction();
            });
            select.addEventListener('blur', endEnumInteraction);
            select.addEventListener('change', () => {
                if (relayRemoteMutation({ descriptor, kind: 'enum', value: select.value })) {
                    logEvent('ui', 'vm-enum', `Requested ${descriptor.path} = ${select.value}`);
                    endEnumInteraction();
                    return;
                }
                const liveAccessor = resolveVmAccessor(descriptor.path, 'enum');
                if (liveAccessor) {
                    liveAccessor.value = select.value;
                    logEvent('ui', 'vm-enum', `Set ${descriptor.path} = ${select.value}`);
                    dispatchVmControlMutation(documentRef, { descriptor, kind: 'enum', value: select.value });
                }
                endEnumInteraction();
            });
            registerVmControlBinding(descriptor, {
                input: select,
                isInteractionActive: () => enumInteractionActive,
                kind: 'enum',
                setInteractionEndHandler: (handler) => {
                    onEnumInteractionEnd = typeof handler === 'function' ? handler : () => {};
                },
            });
            inputContainer.appendChild(select);
        } else if (descriptor.kind === 'color') {
            const colorWrap = documentRef.createElement('div');
            colorWrap.className = 'vm-color-control';

            const colorInput = documentRef.createElement('input');
            colorInput.type = 'color';
            const alphaInput = documentRef.createElement('input');
            alphaInput.type = 'number';
            alphaInput.min = '0';
            alphaInput.max = '100';
            alphaInput.step = '1';

            const colorMeta = argbToColorMeta(accessor?.value);
            colorInput.value = colorMeta.hex;
            alphaInput.value = String(colorMeta.alphaPercent);
            colorInput.disabled = isDisabled;
            alphaInput.disabled = isDisabled;

            const applyColor = () => {
                const rgb = hexToRgb(colorInput.value);
                const alphaPercent = clamp(Number(alphaInput.value), 0, 100);
                alphaInput.value = String(Math.round(alphaPercent));
                const alpha = Math.round((alphaPercent / 100) * 255);
                const colorValue = rgbAlphaToArgb(rgb.r, rgb.g, rgb.b, alpha);
                if (relayRemoteMutation({ descriptor, kind: 'color', value: colorValue })) {
                    logEvent('ui', 'vm-color', `Requested ${descriptor.path} color ${colorInput.value} (${alphaPercent}%).`);
                    return;
                }
                const liveAccessor = resolveVmAccessor(descriptor.path, 'color');
                if (!liveAccessor) {
                    return;
                }
                if (typeof liveAccessor.argb === 'function') {
                    liveAccessor.argb(alpha, rgb.r, rgb.g, rgb.b);
                    logEvent('ui', 'vm-color', `Set ${descriptor.path} color to ${colorInput.value} (${alphaPercent}%).`);
                    dispatchVmControlMutation(documentRef, {
                        descriptor,
                        kind: 'color',
                        value: rgbAlphaToArgb(rgb.r, rgb.g, rgb.b, alpha),
                    });
                    return;
                }
                liveAccessor.value = colorValue;
                logEvent('ui', 'vm-color', `Set ${descriptor.path} color to ${colorInput.value} (${alphaPercent}%).`);
                dispatchVmControlMutation(documentRef, { descriptor, kind: 'color', value: colorValue });
            };

            colorInput.addEventListener('input', applyColor);
            alphaInput.addEventListener('change', applyColor);
            registerVmControlBinding(descriptor, {
                alphaInput,
                colorInput,
                kind: 'color',
            });

            colorWrap.appendChild(colorInput);
            colorWrap.appendChild(alphaInput);
            inputContainer.appendChild(colorWrap);
        } else if (descriptor.kind === 'image') {
            const renderEpoch = getVmControlRenderEpoch();
            appendVmImageControl({
                canMutateRemoteControls,
                descriptor,
                documentRef,
                getLoadedRuntime,
                getEmbeddedImageAssets,
                inputContainer,
                isControlCurrent: () => getVmControlRenderEpoch() === renderEpoch,
                isAuthoritativeChildMode,
                logEvent,
                onRemoteMutationFailure,
                pickImageFile,
                registerVmControlBinding,
                resolveControlAccessor,
            });
        } else if (descriptor.kind === 'trigger') {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.textContent = 'Fire';
            button.disabled = isDisabled;
            button.addEventListener('click', () => {
                if (relayRemoteMutation({
                    action: 'fire',
                    descriptor,
                    kind: 'trigger',
                })) {
                    logEvent('ui', 'vm-trigger', `Requested trigger ${descriptor.path}`);
                    return;
                }
                const liveAccessor = resolveControlAccessor({ ...descriptor, kind: 'trigger' });
                const riveInstance = getRiveInstance();
                if (shouldResumePlaybackForTrigger(riveInstance)) {
                    riveInstance.play();
                }

                let firedVmTrigger = false;
                let firedStateMachineCount = 0;
                if (liveAccessor && typeof liveAccessor.trigger === 'function') {
                    liveAccessor.trigger();
                    firedVmTrigger = true;
                } else if (liveAccessor && typeof liveAccessor.fire === 'function') {
                    liveAccessor.fire();
                    firedVmTrigger = true;
                }

                if (descriptor.source !== 'state-machine') {
                    firedStateMachineCount = fireStateMachineTriggerByName(descriptor.name);
                }
                if (firedVmTrigger || firedStateMachineCount > 0) {
                    const suffix = firedStateMachineCount > 0 ? ` (+${firedStateMachineCount} state machine trigger matches)` : '';
                    const source = descriptor.source === 'state-machine' ? 'sm-trigger' : 'vm-trigger';
                    logEvent('ui', source, `Fired trigger ${descriptor.path}${suffix}`);
                    dispatchVmControlMutation(documentRef, {
                        action: 'fire',
                        descriptor,
                        kind: 'trigger',
                    });
                } else {
                    const source = descriptor.source === 'state-machine' ? 'sm-trigger-miss' : 'vm-trigger-miss';
                    logEvent('ui', source, `No trigger accessor or state machine trigger matched ${descriptor.path}`);
                }
            });
            registerVmControlBinding(descriptor, { button, kind: 'trigger' });
            inputContainer.appendChild(button);
        }

        row.appendChild(label);
        row.appendChild(inputContainer);
        return row;
    };
}

export function createVmSectionElementFactory({
    documentRef,
    createVmControlRow,
    getDepthColor,
    getSectionDisclosureKey = (node) => `${node?.kind || 'vm'}:${node?.path || '<unknown>'}`,
    getSectionOpenState = (_node, isTopLevel) => Boolean(isTopLevel),
}) {
    return function createVmSectionElement(node, isTopLevel = false, depth = 0) {
        const section = documentRef.createElement('details');
        section.className = 'vm-section';
        // The controller owns the state because this factory is deliberately
        // stateless. Rebuilding a compatible canonical hierarchy must not
        // make a user reopen every nested/list branch.
        section.dataset.vmDisclosureKey = getSectionDisclosureKey(node);
        section.open = Boolean(getSectionOpenState(node, isTopLevel));

        const depthColor = getDepthColor(depth);
        const summary = documentRef.createElement('summary');
        summary.className = 'vm-section-header';

        const sectionBar = documentRef.createElement('span');
        sectionBar.className = 'vm-section-bar';
        sectionBar.style.background = depthColor;

        const titleText = documentRef.createElement('span');
        titleText.textContent = node.label;

        const inputCountBadge = documentRef.createElement('span');
        inputCountBadge.className = 'vm-section-count';
        inputCountBadge.textContent = String(countAllInputs(node));

        const chevron = documentRef.createElement('i');
        chevron.setAttribute('data-lucide', 'chevron-down');
        chevron.className = 'lucide-12 vm-section-chevron';

        summary.appendChild(chevron);
        summary.appendChild(sectionBar);
        summary.appendChild(titleText);
        summary.appendChild(inputCountBadge);
        section.appendChild(summary);

        const body = documentRef.createElement('div');
        body.className = 'vm-section-body';
        body.dataset.depth = String(depth);
        body.style.setProperty('--depth-color', depthColor);

        if (node.inputs.length) {
            node.inputs.forEach((input) => {
                body.appendChild(createVmControlRow(input));
            });
        }

        if (node.children.length) {
            node.children.forEach((child) => {
                if (child.inputs.length || child.children.length) {
                    body.appendChild(createVmSectionElement(child, false, depth + 1));
                }
            });
        }

        if (!node.inputs.length && !node.children.length) {
            const emptyMessage = documentRef.createElement('p');
            emptyMessage.className = 'empty-state';
            emptyMessage.textContent = 'No controls.';
            body.appendChild(emptyMessage);
        }

        section.appendChild(body);
        return section;
    };
}
