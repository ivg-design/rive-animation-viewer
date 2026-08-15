import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(process.cwd());

function run(cwd, command, args, env = process.env) {
    return execFileSync(command, args, { cwd, encoding: 'utf8', env });
}

function buildIdFrom(output) {
    return output.match(/\(build ([^)]+)\)/)?.[1] ?? '';
}

describe('static distribution build identity', () => {
    it('marks local dirtiness and blocks dirty CI builds with exact status', () => {
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
            const localEnv = { ...process.env, CI: '', GITHUB_ACTIONS: '' };
            const dirtyId = buildIdFrom(run(
                fixture,
                process.execPath,
                ['scripts/build-dist.mjs'],
                localEnv,
            ));
            expect(dirtyId).toContain('-dirty');

            const blocked = spawnSync(process.execPath, ['scripts/build-dist.mjs'], {
                cwd: fixture,
                encoding: 'utf8',
                env: { ...process.env, CI: 'true' },
            });
            expect(blocked.status).not.toBe(0);
            expect(blocked.stderr).toContain('Refusing CI distribution build from a dirty Git checkout:');
            expect(blocked.stderr).toContain('genuinely-dirty.txt');

            fs.renameSync(path.join(fixture, '.git'), path.join(fixture, '.git-unavailable'));
            const statusUnavailable = spawnSync(process.execPath, ['scripts/build-dist.mjs'], {
                cwd: fixture,
                encoding: 'utf8',
                env: { ...process.env, CI: 'true' },
            });
            expect(statusUnavailable.status).not.toBe(0);
            expect(statusUnavailable.stderr)
                .toContain('Unable to collect Git worktree status for a CI distribution build.');
        } finally {
            fs.rmSync(fixture, { recursive: true, force: true });
        }
    });
});
