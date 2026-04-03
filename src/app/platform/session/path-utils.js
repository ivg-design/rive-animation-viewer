export function extractOpenedFilePath(payload) {
    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }
    if (Array.isArray(payload)) {
        const firstPath = payload.find((entry) => typeof entry === 'string' && entry.trim());
        return firstPath ? firstPath.trim() : '';
    }
    if (payload && typeof payload === 'object') {
        const candidate = payload.path ?? payload.filePath ?? payload.file ?? payload.paths;
        return extractOpenedFilePath(candidate);
    }
    return '';
}

export function normalizeOpenedFilePath(rawPath) {
    const path = String(rawPath || '').trim();
    if (!path) {
        return '';
    }

    if (/^file:\/\//i.test(path)) {
        try {
            const url = new URL(path);
            let decoded = decodeURIComponent(url.pathname || '');
            if (/^\/[a-zA-Z]:\//.test(decoded)) {
                decoded = decoded.slice(1);
            }
            return decoded || path;
        } catch {
            return path;
        }
    }

    return path;
}

export function getFileNameFromPath(filePath) {
    const normalized = String(filePath || '');
    const segments = normalized.split(/[\\/]+/);
    return segments[segments.length - 1] || normalized;
}
