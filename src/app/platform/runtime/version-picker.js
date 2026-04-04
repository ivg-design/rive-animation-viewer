import {
    CURRENT_CUSTOM_RUNTIME_OPTION_VALUE,
    DEFAULT_RUNTIME_VERSION,
    FALLBACK_RUNTIME_VERSION_OPTIONS,
    RUNTIME_VERSION_OPTION_COUNT,
} from '../../core/constants.js';
import { fetchRuntimeVersionOptions } from './assets.js';
import { normalizeRuntimeVersionToken } from './runtime-utils.js';

export function createRuntimeVersionPickerController({
    applyRuntimeVersionToken,
    documentRef,
    elements,
    fetchImpl,
    logger,
    runtimeVersionOptionsState,
    setRuntimeVersionCustomVisibility,
    getRuntimeVersionToken,
    renderRuntimeVersionPickerOptions,
    showError,
} = {}) {
    return async function setupRuntimeVersionPicker() {
        const select = elements?.runtimeVersionSelect;
        if (!select) {
            return;
        }

        select.innerHTML = '<option value="latest">Loading versions…</option>';
        select.disabled = true;

        const applyCustom = async () => {
            const input = elements.runtimeVersionCustomInput;
            const value = String(input?.value || '').trim();
            if (!value) {
                showError('Enter a runtime version before applying custom.');
                return;
            }
            await applyRuntimeVersionToken(value, { source: 'custom' });
            renderRuntimeVersionPickerOptions();
        };

        select.addEventListener('change', async (event) => {
            const selected = event.target.value;
            if (selected === 'custom') {
                setRuntimeVersionCustomVisibility(true);
                elements.runtimeVersionCustomInput?.focus();
                return;
            }
            setRuntimeVersionCustomVisibility(false);
            const tokenToApply = selected === CURRENT_CUSTOM_RUNTIME_OPTION_VALUE
                ? normalizeRuntimeVersionToken(getRuntimeVersionToken())
                : selected;
            await applyRuntimeVersionToken(tokenToApply, { source: 'preset' });
            renderRuntimeVersionPickerOptions();
        });

        elements.runtimeVersionApplyButton?.addEventListener('click', () => {
            applyCustom().catch(() => {
                /* noop */
            });
        });

        elements.runtimeVersionCustomInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applyCustom().catch(() => {
                    /* noop */
                });
            }
        });

        try {
            const discovered = await fetchRuntimeVersionOptions({ fetchImpl });
            runtimeVersionOptionsState.latest = discovered.latest || DEFAULT_RUNTIME_VERSION;
            runtimeVersionOptionsState.versions = discovered.versions?.length
                ? discovered.versions
                : [DEFAULT_RUNTIME_VERSION];
        } catch (error) {
            logger.warn('[rive-viewer] failed to discover runtime versions, using fallback list:', error);
            runtimeVersionOptionsState.latest = FALLBACK_RUNTIME_VERSION_OPTIONS[0];
            runtimeVersionOptionsState.versions = FALLBACK_RUNTIME_VERSION_OPTIONS.slice(0, RUNTIME_VERSION_OPTION_COUNT);
        } finally {
            renderRuntimeVersionPickerOptions();
            select.disabled = false;
        }
    };
}
