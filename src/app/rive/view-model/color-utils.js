export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function toHexByte(value) {
    return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

export function argbToColorMeta(value) {
    const rawValue = Number.isFinite(Number(value)) ? Number(value) >>> 0 : 0xff000000;
    const alpha = (rawValue >>> 24) & 255;
    const red = (rawValue >>> 16) & 255;
    const green = (rawValue >>> 8) & 255;
    const blue = rawValue & 255;

    return {
        alphaPercent: Math.round((alpha / 255) * 100),
        hex: `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`,
    };
}

export function hexToRgb(hex) {
    const cleanHex = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
        return { r: 0, g: 0, b: 0 };
    }

    return {
        r: parseInt(cleanHex.slice(0, 2), 16),
        g: parseInt(cleanHex.slice(2, 4), 16),
        b: parseInt(cleanHex.slice(4, 6), 16),
    };
}

export function rgbAlphaToArgb(red, green, blue, alpha) {
    return (
        ((clamp(alpha, 0, 255) & 255) << 24)
        | ((clamp(red, 0, 255) & 255) << 16)
        | ((clamp(green, 0, 255) & 255) << 8)
        | (clamp(blue, 0, 255) & 255)
    ) >>> 0;
}
