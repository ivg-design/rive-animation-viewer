export function measureRenderSurfaceBounds(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return null;
    const bounds = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
    };
    if (!Object.values(bounds).every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null;
    return bounds;
}

export function renderSurfaceBoundsKey(bounds) {
    return bounds ? `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}` : null;
}
