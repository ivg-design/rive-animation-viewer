        function getDepthColor(depth) {
            return VM_DEPTH_COLORS[depth % VM_DEPTH_COLORS.length];
        }

        function countAllInputs(node) {
            var total = node.inputs ? node.inputs.length : 0;
            if (node.children) {
                node.children.forEach(function (child) { total += countAllInputs(child); });
            }
            return total;
        }

        function createVmSectionElement(node, isTopLevel, depth) {
            var section = document.createElement('details');
            section.className = 'vm-section';
            section.open = Boolean(isTopLevel);

            var depthColor = getDepthColor(depth);

            var summary = document.createElement('summary');
            summary.className = 'vm-section-header';

            var chevron = document.createElement('i');
            chevron.setAttribute('data-lucide', 'chevron-down');
            chevron.className = 'lucide-12 vm-section-chevron';

            var sectionBar = document.createElement('span');
            sectionBar.className = 'vm-section-bar';
            sectionBar.style.background = depthColor;

            var titleText = document.createElement('span');
            titleText.textContent = node.label.toUpperCase();

            var inputCountBadge = document.createElement('span');
            inputCountBadge.className = 'vm-section-count';
            inputCountBadge.textContent = String(countAllInputs(node));

            summary.appendChild(chevron);
            summary.appendChild(sectionBar);
            summary.appendChild(titleText);
            summary.appendChild(inputCountBadge);
            section.appendChild(summary);

            var body = document.createElement('div');
            body.className = 'vm-section-body';
            body.dataset.depth = depth;
            body.style.setProperty('--depth-color', depthColor);

            // Render this node's direct inputs
            if (node.inputs && node.inputs.length) {
                node.inputs.forEach(function (input) {
                    body.appendChild(createVmControlRow(input));
                });
            }

            // Render nested children as sub-sections
            if (node.children && node.children.length) {
                node.children.forEach(function (child) {
                    if ((child.inputs && child.inputs.length) || (child.children && child.children.length)) {
                        body.appendChild(createVmSectionElement(child, false, depth + 1));
                    }
                });
            }

            if ((!node.inputs || !node.inputs.length) && (!node.children || !node.children.length)) {
                var emptyMsg = document.createElement('p');
                emptyMsg.className = 'empty-state';
                emptyMsg.textContent = 'No controls.';
                body.appendChild(emptyMsg);
            }

            section.appendChild(body);
            return section;
        }

        function createVmControlRow(descriptor) {
            var row = document.createElement('div');
            row.className = 'vm-control-row';

            var label = document.createElement('div');
            label.className = 'vm-control-label';
            label.textContent = descriptor.name + ' (' + descriptor.kind + ')';
            label.title = descriptor.path;

            var inputContainer = document.createElement('div');
            inputContainer.className = 'vm-control-input';

            var accessor = resolveControlAccessor(descriptor);
            var isDisabled = !accessor;

            if (descriptor.kind === 'number') {
                var numberInput = document.createElement('input');
                numberInput.type = 'number';
                numberInput.step = 'any';
                numberInput.value = Number.isFinite(accessor && accessor.value) ? String(accessor.value) : '0';
                numberInput.disabled = isDisabled;
                numberInput.addEventListener('change', function () {
                    var nextValue = Number(numberInput.value);
                    if (!Number.isFinite(nextValue)) return;
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'number', source: descriptor.source, stateMachineName: descriptor.stateMachineName });
                    if (live) {
                        live.value = nextValue;
                        var numberSource = descriptor.source === 'state-machine' ? 'sm-number' : 'vm-number';
                        logEvent('ui', numberSource, 'Set ' + descriptor.path + ' = ' + nextValue);
                    }
                });
                registerVmControlBinding(descriptor, { kind: 'number', input: numberInput });
                inputContainer.appendChild(numberInput);

            } else if (descriptor.kind === 'boolean') {
                var checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = Boolean(accessor && accessor.value);
                checkbox.disabled = isDisabled;
                checkbox.addEventListener('change', function () {
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'boolean', source: descriptor.source, stateMachineName: descriptor.stateMachineName });
                    if (live) {
                        live.value = checkbox.checked;
                        var boolSource = descriptor.source === 'state-machine' ? 'sm-boolean' : 'vm-boolean';
                        logEvent('ui', boolSource, 'Set ' + descriptor.path + ' = ' + checkbox.checked);
                    }
                });
                registerVmControlBinding(descriptor, { kind: 'boolean', input: checkbox });
                inputContainer.appendChild(checkbox);

            } else if (descriptor.kind === 'string') {
                var textInput = document.createElement('input');
                textInput.type = 'text';
                textInput.value = (accessor && typeof accessor.value === 'string') ? accessor.value : '';
                textInput.disabled = isDisabled;
                textInput.addEventListener('change', function () {
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'string', source: descriptor.source, stateMachineName: descriptor.stateMachineName });
                    if (live) {
                        live.value = textInput.value;
                        logEvent('ui', 'vm-string', 'Set ' + descriptor.path + ' = ' + textInput.value);
                    }
                });
                registerVmControlBinding(descriptor, { kind: 'string', input: textInput });
                inputContainer.appendChild(textInput);

            } else if (descriptor.kind === 'enum') {
                var select = document.createElement('select');
                var values = (accessor && Array.isArray(accessor.values)) ? accessor.values : [];
                values.forEach(function (val) {
                    var option = document.createElement('option');
                    option.value = val;
                    option.textContent = val;
                    select.appendChild(option);
                });
                if (values.length === 0) {
                    var fallback = document.createElement('option');
                    fallback.value = '';
                    fallback.textContent = '(no enum values)';
                    select.appendChild(fallback);
                }
                if (accessor && typeof accessor.value === 'string') select.value = accessor.value;
                select.disabled = isDisabled || values.length === 0;
                select.addEventListener('change', function () {
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'enum', source: descriptor.source, stateMachineName: descriptor.stateMachineName });
                    if (live) {
                        live.value = select.value;
                        logEvent('ui', 'vm-enum', 'Set ' + descriptor.path + ' = ' + select.value);
                    }
                });
                registerVmControlBinding(descriptor, { kind: 'enum', input: select });
                inputContainer.appendChild(select);

            } else if (descriptor.kind === 'color') {
                var colorWrap = document.createElement('div');
                colorWrap.className = 'vm-color-control';

                var colorInput = document.createElement('input');
                colorInput.type = 'color';
                var alphaInput = document.createElement('input');
                alphaInput.type = 'number';
                alphaInput.min = '0';
                alphaInput.max = '100';
                alphaInput.step = '1';

                var colorMeta = argbToColorMeta(accessor && accessor.value);
                colorInput.value = colorMeta.hex;
                alphaInput.value = String(colorMeta.alphaPercent);
                colorInput.disabled = isDisabled;
                alphaInput.disabled = isDisabled;

                var applyColor = function () {
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'color', source: descriptor.source, stateMachineName: descriptor.stateMachineName });
                    if (!live) return;
                    var rgb = hexToRgb(colorInput.value);
                    var alphaPercent = clamp(Number(alphaInput.value), 0, 100);
                    alphaInput.value = String(Math.round(alphaPercent));
                    var alpha = Math.round((alphaPercent / 100) * 255);
                    if (typeof live.argb === 'function') {
                        live.argb(alpha, rgb.r, rgb.g, rgb.b);
                    } else {
                        live.value = rgbAlphaToArgb(rgb.r, rgb.g, rgb.b, alpha);
                    }
                    logEvent('ui', 'vm-color', 'Set ' + descriptor.path + ' color to ' + colorInput.value + ' (' + alphaPercent + '%).');
                };

                colorInput.addEventListener('input', applyColor);
                alphaInput.addEventListener('change', applyColor);
                registerVmControlBinding(descriptor, { kind: 'color', colorInput: colorInput, alphaInput: alphaInput });

                colorWrap.appendChild(colorInput);
                colorWrap.appendChild(alphaInput);
                inputContainer.appendChild(colorWrap);

            } else if (descriptor.kind === 'trigger') {
                var button = document.createElement('button');
                button.type = 'button';
                button.textContent = 'Fire';
                button.disabled = isDisabled;
                button.addEventListener('click', function () {
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'trigger', source: descriptor.source, stateMachineName: descriptor.stateMachineName });

                    // Ensure animation is playing for trigger to take effect
                    if (riveInstance && riveInstance.isPaused) {
                        riveInstance.play();
                    }

                    var firedVmTrigger = false;
                    if (live && typeof live.trigger === 'function') {
                        live.trigger();
                        firedVmTrigger = true;
                    } else if (live && typeof live.fire === 'function') {
                        live.fire();
                        firedVmTrigger = true;
                    }

                    var firedSmCount = 0;
                    if (descriptor.source !== 'state-machine') {
                        firedSmCount = fireStateMachineTriggerByName(descriptor.name);
                    }
                    if (firedVmTrigger || firedSmCount > 0) {
                        var suffix = firedSmCount > 0 ? ' (+' + firedSmCount + ' state machine trigger matches)' : '';
                        var triggerSource = descriptor.source === 'state-machine' ? 'sm-trigger' : 'vm-trigger';
                        logEvent('ui', triggerSource, 'Fired trigger ' + descriptor.path + suffix);
                    } else {
                        var missSource = descriptor.source === 'state-machine' ? 'sm-trigger-miss' : 'vm-trigger-miss';
                        logEvent('ui', missSource, 'No trigger accessor or state machine trigger matched ' + descriptor.path);
                    }
                });
                inputContainer.appendChild(button);
            }

            row.appendChild(label);
            row.appendChild(inputContainer);
            return row;
        }

