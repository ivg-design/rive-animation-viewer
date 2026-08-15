import {
    composeEmbeddedImageAssetLoader,
    createEmbeddedImageAssetCatalog,
    detectEmbeddedImageMimeType,
} from '../../../src/app/rive/assets/embedded-image-assets.js';

describe('embedded image asset catalog', () => {
    it('captures copied image bytes, filters invalid assets, and resets cleanly', () => {
        const catalog = createEmbeddedImageAssetCatalog();
        const source = new Uint8Array([1, 2, 3]);

        expect(catalog.capture({
            isImage: true,
            name: 'avatar',
            fileExtension: 'png',
            uniqueFilename: 'avatar-1.png',
        }, source)).toBe(true);
        expect(catalog.capture({ isImage: false, name: 'font' }, source)).toBe(false);
        expect(catalog.capture({ isImage: true, name: 'empty' }, new Uint8Array())).toBe(false);
        expect(catalog.capture({ isImage: true, name: '  ' }, source)).toBe(false);

        source[0] = 9;
        expect(catalog.list()).toEqual([{
            bytes: new Uint8Array([1, 2, 3]),
            extension: 'png',
            key: 'avatar-1.png',
            label: 'avatar',
            mimeType: 'application/octet-stream',
            name: 'avatar',
            uniqueFilename: 'avatar-1.png',
        }]);

        catalog.capture({
            isImage: true,
            name: 'avatar',
            fileExtension: 'webp',
            uniqueFilename: 'avatar-2.webp',
        }, new Uint8Array([4]));
        expect(catalog.list().map(({ key, label, name }) => ({ key, label, name }))).toEqual([
            { key: 'avatar-1.png', label: 'avatar', name: 'avatar' },
            { key: 'avatar-2.webp', label: 'avatar (2)', name: 'avatar' },
        ]);

        catalog.reset();
        expect(catalog.list()).toEqual([]);
    });

    it('detects raster formats from bytes instead of misleading extensions', () => {
        const webp = new Uint8Array([
            0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]);
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
        const avif = new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);

        expect(detectEmbeddedImageMimeType(webp)).toBe('image/webp');
        expect(detectEmbeddedImageMimeType(png)).toBe('image/png');
        expect(detectEmbeddedImageMimeType(jpeg)).toBe('image/jpeg');
        expect(detectEmbeddedImageMimeType(avif)).toBe('image/avif');
        expect(detectEmbeddedImageMimeType(new Uint8Array([1, 2, 3]))).toBe('application/octet-stream');
    });

    it('captures before preserving the user asset-loader receiver, arguments, and exact result', () => {
        const calls = [];
        const receiver = { marker: 'asset-loader-receiver' };
        const catalog = { capture: vi.fn(() => calls.push('capture')) };
        const userLoader = vi.fn(function userAssetLoader() {
            calls.push('user');
            expect(this).toBe(receiver);
            expect(Array.from(arguments)).toEqual([asset, bytes, 'extra-argument']);
            return Promise.resolve(true);
        });
        const loader = composeEmbeddedImageAssetLoader(catalog, userLoader);
        const asset = { isImage: true, name: 'trophy' };
        const bytes = new Uint8Array([5]);

        const result = loader.call(receiver, asset, bytes, 'extra-argument');
        expect(result).toBe(userLoader.mock.results[0].value);
        expect(calls).toEqual(['capture', 'user']);
        expect(catalog.capture).toHaveBeenCalledWith(asset, bytes);
        expect(composeEmbeddedImageAssetLoader(catalog)(asset, bytes)).toBe(false);
    });
});
