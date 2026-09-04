import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));

test('standalone Cargo configuration keeps build output outside the harness source', () => {
    const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
        cwd: directory,
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const metadata = JSON.parse(result.stdout);
    const actual = path.resolve(metadata.target_directory);
    const expected = path.resolve(directory, '../../../..', 'target-media-harness');
    assert.equal(actual, expected);
    assert.equal(existsSync(path.join(directory, 'target')), false);
});
