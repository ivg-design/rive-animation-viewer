function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
function argbToColorMeta(value) {
    var rawValue = Number.isFinite(Number(value)) ? Number(value) >>> 0 : 0xff000000;
    var alpha = (rawValue >>> 24) & 255;
    var red = (rawValue >>> 16) & 255;
    var green = (rawValue >>> 8) & 255;
    var blue = rawValue & 255;
    return { hex: '#' + toHexByte(red) + toHexByte(green) + toHexByte(blue), alphaPercent: Math.round((alpha / 255) * 100) };
}
function toHexByte(value) {
    return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}
function hexToRgb(hex) {
    var cleanHex = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(cleanHex)) return { r: 0, g: 0, b: 0 };
    return {
        r: parseInt(cleanHex.slice(0, 2), 16),
        g: parseInt(cleanHex.slice(2, 4), 16),
        b: parseInt(cleanHex.slice(4, 6), 16),
    };
}
function rgbAlphaToArgb(red, green, blue, alpha) {
    return (
        ((clamp(alpha, 0, 255) & 255) << 24) |
        ((clamp(red, 0, 255) & 255) << 16) |
        ((clamp(green, 0, 255) & 255) << 8) |
        (clamp(blue, 0, 255) & 255)
    ) >>> 0;
}
