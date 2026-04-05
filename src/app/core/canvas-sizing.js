import {
    CANVAS_SIZING_PREF_STORAGE_KEY,
    DEFAULT_CANVAS_HEIGHT,
    DEFAULT_CANVAS_WIDTH,
} from './constants.js';

const MIN_CANVAS_DIMENSION = 1;
const MAX_CANVAS_DIMENSION = 8192;
const DEFAULT_ASPECT_RATIO = DEFAULT_CANVAS_WIDTH / DEFAULT_CANVAS_HEIGHT;
const BASE_CANVAS_SIZING_STATE = {
    mode: 'auto',
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    lockAspectRatio: false,
    aspectRatio: DEFAULT_ASPECT_RATIO,
};

function clampDimension(value, fallback) {
    const numeric = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.min(MAX_CANVAS_DIMENSION, Math.max(MIN_CANVAS_DIMENSION, Math.round(numeric)));
}

function normalizeMode(value) {
    return value === 'fixed' ? 'fixed' : 'auto';
}

function parseAspectRatioString(value) {
    const normalized = String(value || '').trim();
    const match = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(normalized);
    if (!match) {
        return null;
    }
    const width = Number.parseFloat(match[1]);
    const height = Number.parseFloat(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }
    return width / height;
}

export function normalizeAspectRatioValue(value, fallback = DEFAULT_ASPECT_RATIO) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string') {
        return parseAspectRatioString(value) || fallback;
    }
    if (value && typeof value === 'object') {
        const width = Number(value.width);
        const height = Number(value.height);
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
            return width / height;
        }
    }
    return fallback;
}

export function normalizeCanvasSizingState(raw = {}, fallback = null) {
    const basis = fallback && typeof fallback === 'object'
        ? {
            mode: normalizeMode(fallback.mode),
            width: clampDimension(fallback.width, BASE_CANVAS_SIZING_STATE.width),
            height: clampDimension(fallback.height, BASE_CANVAS_SIZING_STATE.height),
            lockAspectRatio: Boolean(fallback.lockAspectRatio),
            aspectRatio: normalizeAspectRatioValue(
                fallback.aspectRatio,
                clampDimension(fallback.width, BASE_CANVAS_SIZING_STATE.width)
                    / clampDimension(fallback.height, BASE_CANVAS_SIZING_STATE.height),
            ),
        }
        : BASE_CANVAS_SIZING_STATE;

    const mode = normalizeMode(
        raw?.mode === undefined && (raw?.enabled === true || raw?.explicit === true)
            ? 'fixed'
            : raw?.mode,
    );
    const width = clampDimension(raw?.width ?? raw?.pixelWidth, basis.width);
    const height = clampDimension(raw?.height ?? raw?.pixelHeight, basis.height);
    const lockAspectRatio = Boolean(raw?.lockAspectRatio ?? raw?.lockAspect ?? raw?.aspectLocked ?? basis.lockAspectRatio);
    const aspectRatio = normalizeAspectRatioValue(
        raw?.aspectRatio,
        width > 0 && height > 0 ? width / height : basis.aspectRatio,
    );

    return {
        mode,
        width,
        height,
        lockAspectRatio,
        aspectRatio,
    };
}

export function buildCanvasSizingStateFromViewport(width, height, fallback = null) {
    const basis = normalizeCanvasSizingState(fallback || undefined);
    const normalizedWidth = clampDimension(width, basis.width);
    const normalizedHeight = clampDimension(height, basis.height);
    return {
        mode: 'fixed',
        width: normalizedWidth,
        height: normalizedHeight,
        lockAspectRatio: basis.lockAspectRatio,
        aspectRatio: normalizeAspectRatioValue(null, normalizedWidth / normalizedHeight),
    };
}

export function updateCanvasSizingDimension(state, dimension, nextValue) {
    const current = normalizeCanvasSizingState(state);
    const key = dimension === 'height' ? 'height' : 'width';
    const updatedValue = clampDimension(nextValue, current[key]);
    let width = current.width;
    let height = current.height;

    if (key === 'width') {
        width = updatedValue;
        if (current.lockAspectRatio && current.aspectRatio > 0) {
            height = clampDimension(Math.round(width / current.aspectRatio), current.height);
        }
    } else {
        height = updatedValue;
        if (current.lockAspectRatio && current.aspectRatio > 0) {
            width = clampDimension(Math.round(height * current.aspectRatio), current.width);
        }
    }

    return {
        ...current,
        width,
        height,
        aspectRatio: current.lockAspectRatio
            ? normalizeAspectRatioValue(null, current.aspectRatio)
            : normalizeAspectRatioValue(null, width / height),
    };
}

export function setCanvasSizingLock(state, enabled) {
    const current = normalizeCanvasSizingState(state);
    return {
        ...current,
        lockAspectRatio: Boolean(enabled),
        aspectRatio: normalizeAspectRatioValue(null, current.width / current.height),
    };
}

export function setCanvasSizingMode(state, mode) {
    const current = normalizeCanvasSizingState(state);
    return {
        ...current,
        mode: normalizeMode(mode),
    };
}

export function formatAspectRatioLabel(state) {
    const normalized = normalizeCanvasSizingState(state);
    const width = normalized.width;
    const height = normalized.height;
    const greatestCommonDivisor = (left, right) => {
        let a = Math.round(left);
        let b = Math.round(right);
        while (b !== 0) {
            const temp = b;
            b = a % b;
            a = temp;
        }
        return Math.max(1, a);
    };

    const divisor = greatestCommonDivisor(width, height);
    const reducedWidth = Math.round(width / divisor);
    const reducedHeight = Math.round(height / divisor);
    return `${reducedWidth}:${reducedHeight}`;
}

export function buildResolvedCanvasPixelSize(state, fallbackSize = {}) {
    const normalized = normalizeCanvasSizingState(state);
    if (normalized.mode === 'fixed') {
        return {
            width: normalized.width,
            height: normalized.height,
            fixed: true,
        };
    }

    const width = clampDimension(fallbackSize.width, DEFAULT_CANVAS_WIDTH);
    const height = clampDimension(fallbackSize.height, DEFAULT_CANVAS_HEIGHT);
    return {
        width,
        height,
        fixed: false,
    };
}

export function buildCenteredCanvasScrollOffsets({
    containerWidth,
    containerHeight,
    contentWidth,
    contentHeight,
} = {}) {
    const safeContainerWidth = clampDimension(containerWidth, DEFAULT_CANVAS_WIDTH);
    const safeContainerHeight = clampDimension(containerHeight, DEFAULT_CANVAS_HEIGHT);
    const safeContentWidth = clampDimension(contentWidth, safeContainerWidth);
    const safeContentHeight = clampDimension(contentHeight, safeContainerHeight);

    return {
        left: Math.max(0, Math.round((safeContentWidth - safeContainerWidth) / 2)),
        top: Math.max(0, Math.round((safeContentHeight - safeContainerHeight) / 2)),
    };
}

export function loadCanvasSizingPreference(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem?.(CANVAS_SIZING_PREF_STORAGE_KEY);
        if (!raw) {
            return normalizeCanvasSizingState();
        }
        return normalizeCanvasSizingState(JSON.parse(raw));
    } catch {
        return normalizeCanvasSizingState();
    }
}

export function persistCanvasSizingPreference(state, storage = globalThis.localStorage) {
    try {
        storage?.setItem?.(
            CANVAS_SIZING_PREF_STORAGE_KEY,
            JSON.stringify(normalizeCanvasSizingState(state)),
        );
    } catch {
        /* noop */
    }
}
