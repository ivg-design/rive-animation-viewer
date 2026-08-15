import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd());

function run(cwd, command, args) {
    return execFileSync(command, args, { cwd, encoding: 'utf8' });
}

function buildIdFrom(output) {
    return output.match(/\(build ([^)]+)\)/)?.[1] ?? '';
}

describe('static distribution build identity', () => {
    it('ignores its own counter write but still marks a genuinely dirty checkout', () => {
        const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rav-build-dist-'));

        try {
            fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
            fs.mkdirSync(path.join(fixture, 'src', 'app'), { recursive: true });
            fs.copyFileSync(
                path.join(root, 'scripts', 'build-dist.mjs'),
                path.join(fixture, 'scripts', 'build-dist.mjs'),
            );
            fs.writeFileSync(path.join(fixture, 'package.json'), '{"version":"1.0.0"}\n');
            fs.writeFileSync(path.join(fixture, 'src', 'app', 'main-entry.js'), '__APP_BUILD__\n');
            fs.writeFileSync(path.join(fixture, '.gitignore'), '.cache/\ndist/\n');

            run(fixture, 'git', ['init', '-q']);
            run(fixture, 'git', ['config', 'user.email', 'test@example.invalid']);
            run(fixture, 'git', ['config', 'user.name', 'RAV Test']);
            run(fixture, 'git', ['add', '.']);
            run(fixture, 'git', ['commit', '-qm', 'fixture']);

            const cleanId = buildIdFrom(run(fixture, process.execPath, ['scripts/build-dist.mjs']));
            expect(cleanId).not.toContain('-dirty');
            expect(fs.existsSync(path.join(fixture, '.cache', 'build-counter.txt'))).toBe(true);

            fs.writeFileSync(path.join(fixture, 'genuinely-dirty.txt'), 'dirty\n');
            const dirtyId = buildIdFrom(run(fixture, process.execPath, ['scripts/build-dist.mjs']));
            expect(dirtyId).toContain('-dirty');
        } finally {
            fs.rmSync(fixture, { recursive: true, force: true });
        }
    });
});
