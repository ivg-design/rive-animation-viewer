import {
    DEFAULT_LAYOUT_ALIGNMENT,
    DEFAULT_LAYOUT_FIT,
    LAYOUT_ALIGNMENTS,
    LAYOUT_FITS,
} from './constants.js';

const FIT_ENUM_NAMES = Object.freeze({
    contain: 'Contain',
    cover: 'Cover',
    fill: 'Fill',
    fitWidth: 'FitWidth',
    fitHeight: 'FitHeight',
    scaleDown: 'ScaleDown',
    none: 'None',
    layout: 'Layout',
});

const ALIGNMENT_ENUM_NAMES = Object.freeze({
    topLeft: 'TopLeft',
    topCenter: 'TopCenter',
    topRight: 'TopRight',
    centerLeft: 'CenterLeft',
    center: 'Center',
    centerRight: 'CenterRight',
    bottomLeft: 'BottomLeft',
    bottomCenter: 'BottomCenter',
    bottomRight: 'BottomRight',
});

export function normalizeLayoutFit(value) {
    return LAYOUT_FITS.includes(value) ? value : DEFAULT_LAYOUT_FIT;
}

export function normalizeLayoutAlignment(value) {
    return LAYOUT_ALIGNMENTS.includes(value) ? value : DEFAULT_LAYOUT_ALIGNMENT;
}

export function getRiveFitEnumName(value) {
    return FIT_ENUM_NAMES[normalizeLayoutFit(value)];
}

export function getRiveAlignmentEnumName(value) {
    return ALIGNMENT_ENUM_NAMES[normalizeLayoutAlignment(value)];
}

export function resolveRiveFit(runtime, value) {
    const normalized = normalizeLayoutFit(value);
    const enumName = getRiveFitEnumName(normalized);
    return Object.prototype.hasOwnProperty.call(runtime?.Fit || {}, enumName)
        ? runtime.Fit[enumName]
        : normalized;
}

export function resolveRiveAlignment(runtime, value) {
    const normalized = normalizeLayoutAlignment(value);
    const enumName = getRiveAlignmentEnumName(normalized);
    return Object.prototype.hasOwnProperty.call(runtime?.Alignment || {}, enumName)
        ? runtime.Alignment[enumName]
        : normalized;
}

export function buildRiveFitExpression(runtimeNamespace, value) {
    return `${runtimeNamespace}.Fit.${getRiveFitEnumName(value)}`;
}

export function buildRiveAlignmentExpression(runtimeNamespace, value) {
    return `${runtimeNamespace}.Alignment.${getRiveAlignmentEnumName(value)}`;
}
