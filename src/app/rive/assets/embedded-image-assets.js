function readAssetField(asset, fieldName) {
    try {
        const value = asset?.[fieldName];
        return typeof value === 'function' ? value.call(asset) : value;
    } catch {
        return null;
    }
}

function copyAssetBytes(bytes) {
    if (bytes instanceof Uint8Array) {
        return new Uint8Array(bytes);
    }
    if (ArrayBuffer.isView(bytes)) {
        return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    if (bytes instanceof ArrayBuffer) {
        return new Uint8Array(bytes.slice(0));
    }
    return null;
}

function bytesMatch(bytes, offset, signature) {
    return signature.every((value, index) => bytes[offset + index] === value);
}

export function detectEmbeddedImageMimeType(bytes) {
    if (bytes?.length >= 12 && bytesMatch(bytes, 0, [0x89, 0x50, 0x4e, 0x47])) {
        return 'image/png';
    }
    if (bytes?.length >= 12
        && bytesMatch(bytes, 0, [0x52, 0x49, 0x46, 0x46])
        && bytesMatch(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
        return 'image/webp';
    }
    if (bytes?.length >= 3 && bytesMatch(bytes, 0, [0xff, 0xd8, 0xff])) {
        return 'image/jpeg';
    }
    if (bytes?.length >= 12 && bytesMatch(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
        const brand = String.fromCharCode(...bytes.slice(8, 12));
        if (brand === 'avif' || brand === 'avis') return 'image/avif';
    }
    return 'application/octet-stream';
}

export function createEmbeddedImageAssetCatalog() {
    const assets = new Map();
    let anonymousSequence = 0;

    return {
        capture(asset, bytes) {
            const isImage = Boolean(readAssetField(asset, 'isImage'));
            const copiedBytes = copyAssetBytes(bytes);
            if (!isImage || !copiedBytes?.length) {
                return false;
            }

            const name = String(readAssetField(asset, 'name') || '').trim();
            if (!name) {
                return false;
            }
            const extension = String(readAssetField(asset, 'fileExtension') || '').trim();
            const uniqueFilename = String(readAssetField(asset, 'uniqueFilename') || '').trim();
            const assetId = String(readAssetField(asset, 'id') || '').trim();
            const key = uniqueFilename || assetId || `anonymous-image-${anonymousSequence++}`;
            assets.set(key, {
                bytes: copiedBytes,
                extension,
                key,
                mimeType: detectEmbeddedImageMimeType(copiedBytes),
                name,
                uniqueFilename,
            });
            return true;
        },

        list() {
            const entries = Array.from(assets.values());
            const nameCounts = new Map();
            return entries.map((entry) => {
                const occurrence = (nameCounts.get(entry.name) || 0) + 1;
                nameCounts.set(entry.name, occurrence);
                return {
                    ...entry,
                    label: occurrence === 1 ? entry.name : `${entry.name} (${occurrence})`,
                };
            });
        },

        reset() {
            assets.clear();
            anonymousSequence = 0;
        },
    };
}

export function composeEmbeddedImageAssetLoader(catalog, userAssetLoader) {
    return function embeddedImageAssetLoader(asset, bytes) {
        catalog?.capture?.(asset, bytes);
        return typeof userAssetLoader === 'function'
            ? userAssetLoader.apply(this, arguments)
            : false;
    };
}
