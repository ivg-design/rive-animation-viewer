import {
    DEFAULT_RUNTIME_VERSION,
    DEFAULT_RUNTIME_VERSION_TOKEN,
} from '../../../src/app/core/constants.js';
import {
    buildFileRuntimePreferenceId,
    compareSemverDescending,
    extractVersionFromUrl,
    getEffectiveRuntimeVersionToken,
    getRuntimeCacheKey,
    getRuntimePackageName,
    getRuntimeSourceUrl,
    isSemverAtLeast,
    loadRuntimeMeta,
    loadRuntimeVersionByFile,
    loadRuntimeVersionPreference,
    normalizeFileRuntimePreferenceId,
    normalizeRuntimeVersionToken,
    parseSemverParts,
} from '../../../src/app/platform/runtime/runtime-utils.js';

describe('platform/runtime-utils', () => {
    it('normalizes runtime tokens and package names', () => {
        expect(getRuntimePackageName('webgl2')).toBe('@rive-app/webgl2');
        expect(getRuntimePackageName('unknown')).toBe('@rive-app/webgl2');

        expect(normalizeRuntimeVersionToken('')).toBe(DEFAULT_RUNTIME_VERSION_TOKEN);
        expect(normalizeRuntimeVersionToken('latest')).toBe(DEFAULT_RUNTIME_VERSION_TOKEN);
        expect(normalizeRuntimeVersionToken('custom')).toBe(DEFAULT_RUNTIME_VERSION_TOKEN);
        expect(normalizeRuntimeVersionToken(' 2.30.1 ')).toBe('2.30.1');
    });

    it('resolves effective runtime versions and source URLs', () => {
        expect(getEffectiveRuntimeVersionToken('2.30.0', '2.31.0')).toBe('2.30.0');
        expect(getEffectiveRuntimeVersionToken(DEFAULT_RUNTIME_VERSION_TOKEN, '2.31.0')).toBe('2.31.0');
        expect(getEffectiveRuntimeVersionToken(DEFAULT_RUNTIME_VERSION_TOKEN, 'not-a-semver')).toBe(DEFAULT_RUNTIME_VERSION);

        expect(getRuntimeCacheKey('webgl2', DEFAULT_RUNTIME_VERSION_TOKEN, '2.31.0')).toBe('webgl2@2.31.0');
        expect(getRuntimeSourceUrl('webgl2', DEFAULT_RUNTIME_VERSION_TOKEN, '2.31.0')).toBe(
            'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.31.0',
        );
    });

    it('loads the global runtime preference from storage', () => {
        const storage = {
            getItem: vi.fn(() => 'custom'),
        };

        expect(loadRuntimeVersionPreference(storage)).toBe(DEFAULT_RUNTIME_VERSION_TOKEN);

        storage.getItem.mockImplementation(() => {
            throw new Error('storage unavailable');
        });

        expect(loadRuntimeVersionPreference(storage)).toBe(DEFAULT_RUNTIME_VERSION_TOKEN);
    });

    it('builds stable file preference ids from path or file metadata', () => {
        expect(normalizeFileRuntimePreferenceId('  /Tmp/Demo.riv  ')).toBe('/tmp/demo.riv');

        expect(
            buildFileRuntimePreferenceId(
                'Demo.riv',
                42,
                {
                    sourcePath: ' /TMP/Demo.riv ',
                    lastModified: 100,
                },
                (value) => value.trim().toLowerCase(),
            ),
        ).toBe('path:/tmp/demo.riv');

        expect(
            buildFileRuntimePreferenceId('Demo.riv', 42, {
                lastModified: 100,
            }),
        ).toBe('name:demo.riv|size:42|modified:100');
    });

    it('loads file-scoped runtime preferences from storage', () => {
        const storage = {
            getItem: vi.fn(() => JSON.stringify({
                ' /TMP/One.riv ': 'latest',
                ' ': '2.30.0',
                'My File': '2.29.1',
            })),
        };

        expect(loadRuntimeVersionByFile(storage)).toEqual({
            '/tmp/one.riv': DEFAULT_RUNTIME_VERSION_TOKEN,
            'my file': '2.29.1',
        });

        storage.getItem.mockReturnValueOnce('[]');
        expect(loadRuntimeVersionByFile(storage)).toEqual({});

        storage.getItem.mockImplementation(() => {
            throw new Error('bad storage');
        });
        expect(loadRuntimeVersionByFile(storage)).toEqual({});
    });

    it('loads cached runtime metadata from storage', () => {
        const storage = {
            getItem: vi.fn(() => JSON.stringify({
                'webgl2@2.31.0': {
                    resolvedUrl: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.31.0',
                },
            })),
        };

        expect(loadRuntimeMeta(storage)).toEqual({
            'webgl2@2.31.0': {
                resolvedUrl: 'https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.31.0',
            },
        });

        storage.getItem.mockImplementation(() => {
            throw new Error('bad storage');
        });
        expect(loadRuntimeMeta(storage)).toEqual({});
    });

    it('compares and parses semver strings consistently', () => {
        expect(['2.29.0', '2.31.0', '2.30.0'].sort(compareSemverDescending)).toEqual([
            '2.31.0',
            '2.30.0',
            '2.29.0',
        ]);
        expect(compareSemverDescending('alpha', 'beta')).toBeLessThan(0);

        expect(parseSemverParts('2.31.4')).toEqual([2, 31, 4]);
        expect(parseSemverParts('rive-2.31.4-beta')).toEqual([2, 31, 4]);
        expect(parseSemverParts('not-a-version')).toBeNull();
    });

    it('treats unknown versions as non-blocking in semver guards', () => {
        expect(isSemverAtLeast('2.31.0', '2.30.0')).toBe(true);
        expect(isSemverAtLeast('2.29.0', '2.30.0')).toBe(false);
        expect(isSemverAtLeast('unknown', '2.30.0')).toBe(true);
        expect(isSemverAtLeast('2.30.0', 'unknown')).toBe(true);
    });

    it('extracts version tokens from resolved runtime URLs', () => {
        expect(extractVersionFromUrl('https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.31.0')).toBe('2.31.0');
        expect(extractVersionFromUrl('https://example.com/no-version')).toBeNull();
    });
});
