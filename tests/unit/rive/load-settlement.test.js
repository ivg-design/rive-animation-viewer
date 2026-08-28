import { normalizeLoadErrorMessage } from '../../../src/app/rive/instances/load-settlement.js';

describe('rive/load-settlement', () => {
    it('keeps Error messages readable and does not coerce structured errors to object text', () => {
        expect(normalizeLoadErrorMessage(new Error('invalid Rive file'))).toBe('invalid Rive file');
        expect(normalizeLoadErrorMessage({ message: 'runtime rejected the file' })).toBe('runtime rejected the file');
        expect(normalizeLoadErrorMessage({ error: { reason: 'unsupported version' } })).toBe('unsupported version');
        expect(normalizeLoadErrorMessage({ detail: 'opaque payload' })).toBe('Animation load failed.');
        expect(normalizeLoadErrorMessage({})).not.toContain('[object Object]');
    });

    it('uses a caller-provided fallback for empty or missing structured messages', () => {
        expect(normalizeLoadErrorMessage(null, 'Could not open file.')).toBe('Could not open file.');
        expect(normalizeLoadErrorMessage({ message: '' }, 'Could not open file.')).toBe('Could not open file.');
    });
});
