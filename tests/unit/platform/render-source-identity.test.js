import { webcrypto } from 'node:crypto';
import { createRenderSourceIdentityResolver } from '../../../src/app/platform/export/render-source-identity.js';
import { buildFileRuntimePreferenceId } from '../../../src/app/platform/runtime/runtime-utils.js';

function createResolver() {
    return createRenderSourceIdentityResolver({ cryptoApi: webcrypto });
}

describe('platform/render-source-identity', () => {
    it('is stable for the same path and same content across distinct buffers', async () => {
        const resolveIdentity = createResolver();
        const preferenceId = buildFileRuntimePreferenceId('demo.riv', 3, {
            sourcePath: '/Users/test/demo.riv',
        });

        const first = await resolveIdentity(Uint8Array.from([1, 2, 3]).buffer, preferenceId);
        const second = await resolveIdentity(Uint8Array.from([1, 2, 3]).buffer, preferenceId);

        expect(second).toBe(first);
        expect(first).toMatch(/^riv-source-v1:[0-9a-f]{64}$/);
        expect(first).not.toContain('/Users/test/demo.riv');
    });

    it('changes when content changes at the same path', async () => {
        const resolveIdentity = createResolver();
        const preferenceId = buildFileRuntimePreferenceId('demo.riv', 3, {
            sourcePath: '/Users/test/demo.riv',
        });

        const first = await resolveIdentity(Uint8Array.from([1, 2, 3]).buffer, preferenceId);
        const changed = await resolveIdentity(Uint8Array.from([1, 2, 4]).buffer, preferenceId);

        expect(changed).not.toBe(first);
    });

    it('isolates identical content opened from different paths', async () => {
        const resolveIdentity = createResolver();
        const bytes = Uint8Array.from([8, 6, 7, 5, 3, 0, 9]);
        const firstPath = buildFileRuntimePreferenceId('same.riv', bytes.byteLength, {
            sourcePath: '/Users/test/a/same.riv',
        });
        const secondPath = buildFileRuntimePreferenceId('same.riv', bytes.byteLength, {
            sourcePath: '/Users/test/b/same.riv',
        });

        const first = await resolveIdentity(bytes.slice().buffer, firstPath);
        const second = await resolveIdentity(bytes.slice().buffer, secondPath);

        expect(second).not.toBe(first);
    });

    it('is stable for repeated drag/drop metadata and content', async () => {
        const resolveIdentity = createResolver();
        const metadata = { lastModified: 1_777_000_123_456 };
        const firstPreference = buildFileRuntimePreferenceId('drop.riv', 4, metadata);
        const repeatedPreference = buildFileRuntimePreferenceId('drop.riv', 4, { ...metadata });

        expect(repeatedPreference).toBe(firstPreference);
        await expect(resolveIdentity(
            Uint8Array.from([4, 5, 6, 7]).buffer,
            repeatedPreference,
        )).resolves.toBe(await resolveIdentity(
            Uint8Array.from([4, 5, 6, 7]).buffer,
            firstPreference,
        ));
    });

    it('returns null for missing animation bytes', async () => {
        const resolveIdentity = createResolver();
        await expect(resolveIdentity(null, 'path:/private/demo.riv')).resolves.toBeNull();
    });
});
