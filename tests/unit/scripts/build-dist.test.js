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
    it('pins the Tauri manifest to LF on every checkout', () => {
        const attributes = run(root, 'git', [
            'check-attr',
            'text',
            'eol',
            '--',
            'src-tauri/Cargo.toml',
        ]);
        expect(attributes).toContain('src-tauri/Cargo.toml: text: set');
        expect(attributes).toContain('src-tauri/Cargo.toml: eol: lf');
    });

    it('ignores normalized EOL-only rewrites and blocks real Git dirtiness', () => {
        const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rav-build-dist-'));

        try {
            fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
            fs.mkdirSync(path.join(fixture, 'src', 'app'), { recursive: true });
            fs.copyFileSync(
                path.join(root, 'scripts', 'build-dist.mjs'),
                path.join(fixture, 'scripts', 'build-dist.mjs'),
            );
            fs.writeFileSync(path.join(fixture, 'package.json'), '{"version":"1.0.0"}\n');
            fs.writeFileSync(
                path.join(fixture, 'src', 'app', 'main-entry.js'),
                '__APP_BUILD__\n__APP_CHANNEL__\n',
            );
            fs.writeFileSync(path.join(fixture, '.gitignore'), '.cache/\ndist/\n');
            fs.writeFileSync(path.join(fixture, '.gitattributes'), 'eol-equivalent.txt text\n');
            fs.writeFileSync(path.join(fixture, 'eol-equivalent.txt'), 'same\n');
            fs.writeFileSync(path.join(fixture, 'tracked.txt'), 'original\n');

            run(fixture, 'git', ['init', '-q']);
            run(fixture, 'git', ['config', 'user.email', 'test@example.invalid']);
            run(fixture, 'git', ['config', 'user.name', 'RAV Test']);
            run(fixture, 'git', ['add', '.']);
            run(fixture, 'git', ['commit', '-qm', 'fixture']);

            const localEnv = {
                ...process.env,
                CI: '',
                GITHUB_ACTIONS: '',
                TAURI_ENV_DEBUG: 'true',
            };
            const cleanId = buildIdFrom(run(
                fixture,
                process.execPath,
                ['scripts/build-dist.mjs'],
                localEnv,
            ));
            expect(cleanId).not.toContain('-dirty');
            expect(fs.existsSync(path.join(fixture, '.cache', 'build-counter.txt'))).toBe(true);
            expect(fs.readFileSync(path.join(fixture, 'dist', 'src', 'app', 'main-entry.js'), 'utf8'))
                .toContain('\ndev\n');

            run(fixture, process.execPath, ['scripts/build-dist.mjs'], {
                ...localEnv,
                TAURI_ENV_DEBUG: 'false',
            });
            expect(fs.readFileSync(path.join(fixture, 'dist', 'src', 'app', 'main-entry.js'), 'utf8'))
                .toContain('\nrelease\n');

            fs.writeFileSync(path.join(fixture, 'eol-equivalent.txt'), 'same\r\n');
            expect(spawnSync('git', ['diff', '--quiet', '--', 'eol-equivalent.txt'], {
                cwd: fixture,
            }).status).toBe(0);
            const normalizedId = buildIdFrom(run(
                fixture,
                process.execPath,
                ['scripts/build-dist.mjs'],
                localEnv,
            ));
            expect(normalizedId).not.toContain('-dirty');

            fs.writeFileSync(path.join(fixture, 'tracked.txt'), 'unstaged change\n');
            const unstaged = spawnSync(process.execPath, ['scripts/build-dist.mjs'], {
                cwd: fixture,
                encoding: 'utf8',
                env: { ...process.env, CI: 'true' },
            });
            expect(unstaged.status).not.toBe(0);
            expect(unstaged.stderr).toContain('unstaged:');
            expect(unstaged.stderr).toContain('M\ttracked.txt');

            run(fixture, 'git', ['checkout', '--', 'tracked.txt']);
            fs.writeFileSync(path.join(fixture, 'tracked.txt'), 'staged change\n');
            run(fixture, 'git', ['add', 'tracked.txt']);
            const staged = spawnSync(process.execPath, ['scripts/build-dist.mjs'], {
                cwd: fixture,
                encoding: 'utf8',
                env: { ...process.env, CI: 'true' },
            });
            expect(staged.status).not.toBe(0);
            expect(staged.stderr).toContain('staged:');
            expect(staged.stderr).toContain('M\ttracked.txt');

            run(fixture, 'git', ['reset', '-q', 'HEAD', '--', 'tracked.txt']);
            run(fixture, 'git', ['checkout', '--', 'tracked.txt']);
            fs.writeFileSync(path.join(fixture, 'genuinely-dirty.txt'), 'dirty\n');
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
            expect(blocked.stderr).toContain('untracked:');
            expect(blocked.stderr).toContain('? genuinely-dirty.txt');

            fs.rmSync(path.join(fixture, 'genuinely-dirty.txt'));
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
