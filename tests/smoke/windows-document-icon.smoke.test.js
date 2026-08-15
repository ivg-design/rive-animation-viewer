import { verifyWindowsDocumentIcon } from '../../scripts/verify-windows-document-icon.mjs';

describe('Windows Rive document icon packaging', () => {
    it('ships and registers a dedicated multi-resolution icon for NSIS and MSI', () => {
        expect(verifyWindowsDocumentIcon()).toEqual(expect.objectContaining({
            frames: 10,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }));
    });
});
