        function formatVmNumber(value) {
            var numericValue = Number(value);
            return Number.isFinite(numericValue) ? numericValue.toFixed(2) : '0.00';
        }

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
            if (node && node.kind === 'global-view-models') section.classList.add('vm-global-view-models');
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
                numberInput.value = formatVmNumber(accessor && accessor.value);
                numberInput.disabled = isDisabled;
                numberInput.addEventListener('change', function () {
                    var nextValue = Number(numberInput.value);
                    if (!Number.isFinite(nextValue)) return;
                    // Display a stable two-decimal value while preserving the
                    // full-precision number written to the runtime accessor.
                    numberInput.value = formatVmNumber(nextValue);
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'number', source: descriptor.source, globalViewModelName: descriptor.globalViewModelName, stateMachineName: descriptor.stateMachineName });
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
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'boolean', source: descriptor.source, globalViewModelName: descriptor.globalViewModelName, stateMachineName: descriptor.stateMachineName });
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
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'string', source: descriptor.source, globalViewModelName: descriptor.globalViewModelName, stateMachineName: descriptor.stateMachineName });
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
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'enum', source: descriptor.source, globalViewModelName: descriptor.globalViewModelName, stateMachineName: descriptor.stateMachineName });
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
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'color', source: descriptor.source, globalViewModelName: descriptor.globalViewModelName, stateMachineName: descriptor.stateMachineName });
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

            } else if (descriptor.kind === 'image') {
                var imageControl = document.createElement('div');
                imageControl.className = 'vm-image-control';

                var embeddedAssets = getEmbeddedImageAssets();
                var assetSelect = document.createElement('select');
                assetSelect.className = 'vm-image-asset-select';
                assetSelect.setAttribute('aria-label', 'Image source for ' + descriptor.name);
                var assetPlaceholder = document.createElement('option');
                assetPlaceholder.value = '';
                assetPlaceholder.textContent = 'Select image…';
                assetPlaceholder.disabled = true;
                assetPlaceholder.selected = true;
                assetSelect.appendChild(assetPlaceholder);
                embeddedAssets.forEach(function (asset, index) {
                    var option = document.createElement('option');
                    option.value = 'embedded:' + index;
                    option.textContent = asset.label || asset.name;
                    assetSelect.appendChild(option);
                });
                var openImageOption = document.createElement('option');
                openImageOption.value = '__open__';
                openImageOption.textContent = 'Open file…';
                assetSelect.appendChild(openImageOption);
                var clearImageOption = document.createElement('option');
                clearImageOption.value = '__clear__';
                clearImageOption.textContent = 'Clear';
                assetSelect.appendChild(clearImageOption);

                var imageInput = document.createElement('input');
                imageInput.type = 'file';
                imageInput.accept = 'image/*';
                imageInput.className = 'vm-image-file-input';
                imageInput.hidden = true;
                imageInput.tabIndex = -1;

                var canDecodeImage = typeof (loadedRiveRuntime && loadedRiveRuntime.decodeImage) === 'function';
                var imageRequestSequence = 0;
                imageInput.disabled = isDisabled || !canDecodeImage;
                assetSelect.disabled = isDisabled;
                openImageOption.disabled = !canDecodeImage;
                embeddedAssets.forEach(function (_asset, index) {
                    assetSelect.options[index + 1].disabled = !canDecodeImage;
                });

                var applyImageBytes = function (bytes, sourceLabel, requestId) {
                    var runtime = loadedRiveRuntime;
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'image', source: descriptor.source, globalViewModelName: descriptor.globalViewModelName, stateMachineName: descriptor.stateMachineName });
                    if (!runtime || typeof runtime.decodeImage !== 'function' || !live) return Promise.resolve(false);
                    var decodedImage = null;
                    return Promise.resolve().then(function () {
                        return runtime.decodeImage(new Uint8Array(bytes));
                    }).then(function (image) {
                        if (!image) throw new Error('The runtime could not decode this image.');
                        decodedImage = image;
                        if (requestId !== imageRequestSequence) return false;
                        live.value = image;
                        logEvent('ui', 'vm-image', 'Set ' + descriptor.path + ' image from ' + sourceLabel + '.');
                        return true;
                    }).catch(function (error) {
                        logEvent('ui', 'vm-image-error', 'Unable to set ' + descriptor.path + ' image: ' + (error.message || error));
                        return false;
                    }).finally(function () {
                        if (decodedImage && typeof decodedImage.unref === 'function') decodedImage.unref();
                    });
                };

                assetSelect.addEventListener('change', function () {
                    if (assetSelect.value === '__open__') {
                        imageRequestSequence += 1;
                        assetSelect.value = '';
                        imageInput.click();
                        return;
                    }
                    if (assetSelect.value === '__clear__') {
                        imageRequestSequence += 1;
                        var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'image', source: descriptor.source, globalViewModelName: descriptor.globalViewModelName, stateMachineName: descriptor.stateMachineName });
                        if (!live) return;
                        live.value = null;
                        imageInput.value = '';
                        var staleFileOption = assetSelect.querySelector('option[data-image-file-option]');
                        if (staleFileOption) staleFileOption.remove();
                        assetSelect.value = '';
                        logEvent('ui', 'vm-image', 'Cleared ' + descriptor.path + ' image.');
                        return;
                    }
                    var selectedIndex = parseInt(assetSelect.value.replace(/^embedded:/, ''), 10);
                    var selected = Number.isInteger(selectedIndex) ? embeddedAssets[selectedIndex] : null;
                    if (selected) {
                        var requestId = ++imageRequestSequence;
                        applyImageBytes(selected.bytes, 'embedded asset ' + selected.name, requestId);
                    }
                });
                imageInput.addEventListener('change', function () {
                    var file = imageInput.files && imageInput.files[0];
                    if (!file) return;
                    var requestId = ++imageRequestSequence;
                    file.arrayBuffer().then(function (buffer) {
                        return applyImageBytes(buffer, file.name, requestId);
                    }).then(function (applied) {
                        if (!applied) return;
                        var fileOption = assetSelect.querySelector('option[data-image-file-option]');
                        if (!fileOption) {
                            fileOption = document.createElement('option');
                            fileOption.value = '__file__';
                            fileOption.setAttribute('data-image-file-option', 'true');
                            assetSelect.insertBefore(fileOption, openImageOption);
                        }
                        fileOption.textContent = file.name;
                        assetSelect.value = '__file__';
                    }).catch(function (error) {
                        logEvent('ui', 'vm-image-error', 'Unable to read ' + file.name + ': ' + (error.message || error));
                    });
                });
                registerVmControlBinding(descriptor, {
                    assetSelect: assetSelect,
                    embeddedAssetCount: embeddedAssets.length,
                    input: imageInput,
                    kind: 'image',
                });
                imageControl.appendChild(assetSelect);
                imageControl.appendChild(imageInput);
                inputContainer.appendChild(imageControl);

            } else if (descriptor.kind === 'trigger') {
                var button = document.createElement('button');
                button.type = 'button';
                button.textContent = 'Fire';
                button.disabled = isDisabled;
                button.addEventListener('click', function () {
                    var live = resolveControlAccessor({ path: descriptor.path, name: descriptor.name, kind: 'trigger', source: descriptor.source, globalViewModelName: descriptor.globalViewModelName, stateMachineName: descriptor.stateMachineName });

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
