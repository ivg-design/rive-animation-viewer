# Release Process

RAV releases are created by `.github/workflows/release.yml`. The default path is a guarded release commit on `main`; tag pushes and manual dispatch remain available for recovery. The release version must already be synchronized everywhere before publication begins.

## Prepare a release

1. Update the version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.
2. Add the dated release notes to both `CHANGELOG.md` and `web/CHANGELOG.md`.
3. Update the README release summary and any affected product documentation.
4. Run the required validation:

   ```bash
   npm ci
   npm test
   npm run build
   cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

5. Commit the complete release changes on `main` with the exact subject `chore(release): vX.Y.Z`, then push `main`.

## Publish the release

Pushing the guarded `chore(release): vX.Y.Z` commit starts the release matrix. The Tauri release action creates `vX.Y.Z` at that commit when it creates the draft release, so no separate tag command is required for the normal path.

For recovery, or when the validated commit does not use the guarded release subject, create and push the version tag explicitly:

```bash
git tag -a v2.4.0 -m "Rive Animation Viewer v2.4.0"
git push origin v2.4.0
```

The release version must match `package.json`; the workflow stops immediately on a mismatch. Ordinary pushes to `main` are skipped unless the head commit subject starts with `chore(release): v`. A manual `workflow_dispatch` run is also available for recovery or a single-platform rebuild.

## Build matrix

| Platform | Rust target | Primary artifacts |
| --- | --- | --- |
| macOS Apple Silicon | `aarch64-apple-darwin` | `.dmg`, updater archive, `.sig` |
| macOS Intel | `x86_64-apple-darwin` | `.dmg`, updater archive, `.sig` |
| Windows x64 | `x86_64-pc-windows-msvc` | installer, updater archive, `.sig` |

Each runner installs Node.js 20, the Rust stable toolchain, repository dependencies, and the requested Rust target. Tauri's release action creates or updates one draft GitHub Release and uploads that platform's artifacts.

The workflow extracts the matching version section from `CHANGELOG.md` and uses it as the GitHub Release body. A missing or empty release section fails the prepare job before any platform build begins.

After all three platform jobs succeed, the final job downloads the updater signatures, generates a merged `latest.json`, uploads it to the same release, and then publishes the release. A failed or incomplete platform matrix therefore cannot expose a partial public release. Do not consider a release complete until the public release contains this manifest and entries for every supported target.

## Required repository secrets

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

`GITHUB_TOKEN` is supplied by GitHub Actions. The Tauri keys sign updater payloads; native macOS code signing is currently ad hoc unless separate Apple signing/notarization credentials are configured.

## Local packaging

```bash
npm ci
npm run build
npm run tauri build
```

Local artifacts are written under `src-tauri/target/release/bundle/`. Without the Tauri updater private key, the packaging command can still produce a usable ad-hoc-signed macOS app and DMG, but updater signature generation will fail; public releases should always be built by CI.

## Website deployment

The Next.js site in `web/` is linked to the Vercel project `ivgs-projects/rav`. It is not deployed by the desktop release workflow. Publish and verify the GitHub release first so the site resolves the new release assets, then run:

```bash
cd web
npm ci
npm run lint
vercel pull --yes --environment=production --scope ivgs-projects
vercel build --prod --scope ivgs-projects
vercel deploy --prebuilt --prod --yes --scope ivgs-projects
```

The production `NEXT_PUBLIC_SITE_URL` must remain `https://forge.mograph.life/apps/rav/` so Next.js emits the `/apps/rav` asset prefix used by the Forge proxy. Verify the direct Vercel deployment and the public Forge URL after deployment.

## Post-release verification

1. Confirm all three platform jobs and the updater-manifest job are green.
2. Confirm the GitHub Release is public, not a draft or prerelease.
3. Confirm both macOS architectures, Windows artifacts, updater signatures, and `latest.json` are attached.
4. Confirm the release notes match the versioned section in `CHANGELOG.md`.
5. Build and deploy the `web/` site, then verify its download buttons resolve to the new GitHub Release.
