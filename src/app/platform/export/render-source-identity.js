const SOURCE_IDENTITY_DOMAIN = 'rav-render-source-v1';

function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function joinIdentityMaterial(preferenceBytes, contentDigest) {
    const material = new Uint8Array(
        SOURCE_IDENTITY_DOMAIN.length + 1 + 4 + preferenceBytes.length + contentDigest.length,
    );
    let offset = 0;
    for (let index = 0; index < SOURCE_IDENTITY_DOMAIN.length; index += 1) {
        material[offset++] = SOURCE_IDENTITY_DOMAIN.charCodeAt(index);
    }
    material[offset++] = 0;
    new DataView(material.buffer).setUint32(offset, preferenceBytes.length, false);
    offset += 4;
    material.set(preferenceBytes, offset);
    offset += preferenceBytes.length;
    material.set(contentDigest, offset);
    return material;
}

export function createRenderSourceIdentityResolver({
    cryptoApi = globalThis.crypto,
    TextEncoderCtor = globalThis.TextEncoder,
} = {}) {
    const contentDigests = new WeakMap();
    const encoder = new TextEncoderCtor();

    async function digest(bytes) {
        if (!cryptoApi?.subtle?.digest) {
            throw new Error('Secure source identity hashing is unavailable.');
        }
        return new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
    }

    function resolveContentDigest(buffer) {
        if (!contentDigests.has(buffer)) {
            contentDigests.set(buffer, digest(buffer));
        }
        return contentDigests.get(buffer);
    }

    return async (buffer, preferenceId = null) => {
        if (!(buffer instanceof ArrayBuffer)) return null;
        const normalizedPreferenceId = String(preferenceId || '').trim();
        const preferenceBytes = encoder.encode(normalizedPreferenceId);
        const contentDigest = await resolveContentDigest(buffer);
        const sourceDigest = await digest(joinIdentityMaterial(preferenceBytes, contentDigest));
        return `riv-source-v1:${toHex(sourceDigest)}`;
    };
}
