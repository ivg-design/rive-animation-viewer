# Release Process

RAV releases are built as one atomic cross-platform set by
`.github/workflows/release.yml`. Every platform uploads to a draft GitHub
Release. The release stays private until native signing, Apple notarization,
artifact inventory, updater signatures, and the merged `latest.json` all pass.

## Trust model

RAV uses two independent signing systems:

1. **Apple Developer ID signing and notarization** establish macOS platform
   trust. The app, `rav-mcp`, and DMG use the Developer ID Application identity,
   secure timestamps, and hardened runtime where applicable. Apple notarizes and
   staples both the app and the final DMG.
2. **Tauri updater signatures** authenticate update payloads on every platform.
   The private updater key produces each `.sig`; the public key embedded in
   `src-tauri/tauri.conf.json` verifies the download before installation.

Do not rotate the Tauri updater key while supported installed builds still use
its current public key. Apple credentials do not replace the updater key.

## GitHub Actions availability and runaway protection

`ivg-design/rive-animation-viewer` is public and uses only standard
GitHub-hosted runner labels. GitHub documents standard runners as free and
unlimited for public repositories, so exhausted private-repository minutes do
not apply to this release:

<https://docs.github.com/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job>

The workflow also has:

- one repository-wide, non-cancelling concurrency group shared by release and
  repair runs;
- 10–240 minute job timeouts, with the longest bound reserved for Apple
  notarization;
- no single-platform publish path;
- a manual-only updater-manifest repair workflow;
- publication as the last command after draft verification.

If a build fails, use GitHub's **Re-run failed jobs** action. Do not start a
second release for the same ref while the first is active.

## Configure release credentials

Create a GitHub Environment named `apple-release`. Store these Environment
secrets there:

- `APPLE_CERTIFICATE` — single-line base64 of the password-protected `.p12`;
- `APPLE_CERTIFICATE_PASSWORD` — the `.p12` export password;
- `APPLE_API_PRIVATE_KEY_BASE64` — single-line base64 of the Team API `.p8`.

Set these repository variables:

- `APPLE_API_KEY_ID` — App Store Connect Team key ID;
- `APPLE_API_ISSUER` — App Store Connect issuer UUID;
- `APPLE_TEAM_ID` — Apple Developer Team ID.

The existing repository secrets must remain:

- `TAURI_SIGNING_PRIVATE_KEY`;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

`GITHUB_TOKEN` is supplied by GitHub Actions. Do not commit any private key,
certificate export, password, or base64 credential.

For the current local credential folder, the non-password settings can be
configured with:

```bash
repo=ivg-design/rive-animation-viewer
credential_dir=APPLE-SIGNING-KEYS-DO-NOT-COMMIT

gh api --method PUT "repos/$repo/environments/apple-release"

base64 -i "$credential_dir/Certificates.p12" \
  | gh secret set APPLE_CERTIFICATE --env apple-release --repo "$repo"
base64 -i "$credential_dir/AuthKey_7V2QA4XU8F.p8" \
  | gh secret set APPLE_API_PRIVATE_KEY_BASE64 --env apple-release --repo "$repo"

gh secret set APPLE_CERTIFICATE_PASSWORD --env apple-release --repo "$repo"
gh variable set APPLE_API_KEY_ID --body "7V2QA4XU8F" --repo "$repo"
gh variable set APPLE_API_ISSUER \
  --body "c599ea3a-d69e-4463-89fa-ee2155e76397" \
  --repo "$repo"
gh variable set APPLE_TEAM_ID --body "7S422NVLUK" --repo "$repo"
```

The password command prompts without putting the password in shell history.
Protect `apple-release` with the repository's desired deployment-branch and
reviewer rules before the first release.

## Prepare a version

1. Start from a clean, current `main`.
2. Bump the version:

   ```bash
   node scripts/bump-version.mjs patch
   ```

   The script updates `package.json`, both root package-lock records,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, the `app` entry in
   `src-tauri/Cargo.lock`, and website software metadata.

3. Add dated release notes to `CHANGELOG.md` and `web/CHANGELOG.md`.
4. Update the README release summary, website documentation, and freshness
   metadata affected by the release.
5. Verify that every product version agrees and all required release sections
   are present:

   ```bash
   node scripts/check-release-version.mjs \
     --version X.Y.Z \
     --require-release-notes
   ```

6. Run the required checks:

   ```bash
   npm ci
   npm test
   npm run build
   cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

7. Commit the complete release with the exact subject:

   ```bash
   git commit -m "chore(release): vX.Y.Z"
   ```

   Land that exact commit as the tip of `main`. If using a pull request, use a
   squash merge with this exact subject; a differently titled merge commit will
   not start the release.

## CI release sequence

Pushing the guarded release commit to `main` starts this sequence:

1. `prepare-release` validates every version source and extracts the matching
   root changelog section. It creates the draft once, or reuses it only when it
   is still a draft for the exact release commit. An existing public release is
   never mutated.
2. Two macOS jobs import the `.p12` into Tauri's temporary keychain, sign the
   app and nested `rav-mcp` inside-out, notarize/staple the app, and create the
   `.app.tar.gz` updater archive from that final app.
3. The existing Tauri updater key signs the updater archive.
4. Each final DMG is submitted to Apple separately, stapled, and replaces the
   pre-staple asset in the still-draft release.
5. The Windows job builds MSI and NSIS installers plus updater signatures.
6. `verify-draft-release` downloads the actual draft assets and checks:
   - Developer ID authority, expected Team ID, secure timestamp, and hardened
     runtime;
   - no ad-hoc signatures and exactly one `rav-mcp`;
   - valid app and DMG notarization tickets;
   - Gatekeeper distribution assessment;
   - every updater payload cryptographically matches its `.sig` and the Tauri
     public key embedded in the app;
   - matching app `CDHash` in the DMG and updater archive;
   - complete macOS, MSI, and NSIS artifact inventory.
7. `publish-updater-manifest` creates a complete `latest.json`, uploads it, and
   makes the release public.

The normal release action creates the `vX.Y.Z` tag at the release commit. Tag
push and manual dispatch remain recovery entry points, but they run the same
complete platform set.

## How auto-update receives the notarized app

Installed RAV builds check:

```text
https://github.com/ivg-design/rive-animation-viewer/releases/latest/download/latest.json
```

Drafts and prereleases do not replace GitHub's `releases/latest` target.
Therefore installed clients continue seeing the previous complete release while
a new release builds.

For macOS, `latest.json` points to:

- `Rive.Animation.Viewer_aarch64.app.tar.gz`, or
- `Rive.Animation.Viewer_x64.app.tar.gz`.

Tauri creates that archive only after Developer ID signing, app notarization,
and stapling. Its matching `.sig` authenticates the exact final archive.
The draft verification job extracts it and compares its app `CDHash` with the
app inside the separately notarized DMG. Only then does publication move
`releases/latest` and expose the new `latest.json`.

## Local signed build

The Developer ID certificate must already be present in the login keychain.
Store the Team API credential once:

```bash
xcrun notarytool store-credentials "rav-notary" \
  --key "APPLE-SIGNING-KEYS-DO-NOT-COMMIT/AuthKey_7V2QA4XU8F.p8" \
  --key-id "7V2QA4XU8F" \
  --issuer "c599ea3a-d69e-4463-89fa-ee2155e76397"
```

If `codesign` reports `errSecInternalComponent`, the certificate is present
but its private-key access list does not permit command-line signing. In
Keychain Access, open **login → My Certificates**, expand the Developer ID
certificate, open its private key, and add `/usr/bin/codesign` under **Access
Control**. Keep access limited to the signing tool; do not choose “Allow all
applications.” This local keychain ACL does not affect CI because Tauri imports
the `.p12` into an isolated temporary keychain there.

For a release-equivalent local build, the original Tauri updater private key is
also required:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Ilya Gusinski (7S422NVLUK)"
export APPLE_API_KEY="7V2QA4XU8F"
export APPLE_API_ISSUER="c599ea3a-d69e-4463-89fa-ee2155e76397"
export APPLE_API_KEY_PATH="$PWD/APPLE-SIGNING-KEYS-DO-NOT-COMMIT/AuthKey_7V2QA4XU8F.p8"
export TAURI_SIGNING_PRIVATE_KEY="/secure/path/to/the-existing-updater-private-key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."

npm ci
npm run tauri -- build --target aarch64-apple-darwin
```

Tauri notarizes and staples the app. Submit and staple the final DMG separately:

```bash
dmg="$(find src-tauri/target/aarch64-apple-darwin/release/bundle/dmg \
  -maxdepth 1 -name '*.dmg' -print -quit)"
test -n "$dmg"

xcrun notarytool submit "$dmg" --keychain-profile rav-notary --wait
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
```

Then run `scripts/verify-macos-distribution.sh` with the DMG, updater archive,
Team ID, architecture, and release version.

## One-off release without GitHub-hosted runners

The checked-in workflow pins GitHub-hosted runner labels, so attaching a
self-hosted runner is not a drop-in switch. A self-hosted one-off would require
a reviewed temporary workflow branch with matching macOS and Windows runner
labels.

If GitHub Actions itself is unavailable, a complete auto-update-compatible
manual release requires:

1. both macOS architectures built and notarized on a Mac;
2. MSI and NSIS payloads built on Windows or a Windows VM;
3. the existing Tauri updater private key to create every `.sig`;
4. all artifacts uploaded to one draft GitHub Release;
5. `scripts/verify-updater-signatures.mjs` run against both macOS archives and
   both Windows installers;
6. `scripts/verify-macos-distribution.sh` run for both Mac architectures;
7. `scripts/generate-updater-manifest.mjs` run against the draft asset list;
8. `latest.json` uploaded and the draft published only after all checks pass.

GitHub secrets cannot be downloaded, so the updater private key must come from
its original secure backup. If that key or a Windows builder is unavailable,
publish the macOS build only as a **prerelease**, do not upload `latest.json`,
and do not mark it latest. Existing installations will then remain safely on
the previous complete update feed.

## Website deployment

The Next.js site in `web/` is linked to `ivgs-projects/rav`. Publish and verify
the GitHub release first so dynamic download links resolve to the new assets:

```bash
cd web
npm ci
npm run lint
vercel pull --yes --environment=production --scope ivgs-projects
vercel build --prod --scope ivgs-projects
vercel deploy --prebuilt --prod --yes --scope ivgs-projects
```

Keep `NEXT_PUBLIC_SITE_URL=https://forge.mograph.life/apps/rav/`, then verify
the direct Vercel deployment and the public Forge URL.

## Post-release verification

1. Confirm every build and verification job is green.
2. Confirm the release is public, not a draft or prerelease.
3. Confirm both DMGs, both macOS updater archives and signatures, MSI and NSIS
   installers and signatures, and `latest.json` are attached.
4. Confirm `latest.json` is version `X.Y.Z` and contains all required platform
   keys with canonical `/releases/download/vX.Y.Z/` URLs.
5. Download a DMG through a browser, install it on a clean Mac, disconnect
   networking, and confirm Gatekeeper launches it normally using the stapled
   ticket.
6. Install 2.4.0, update to 2.4.1 in-app, relaunch, confirm About reports 2.4.1,
   and confirm the next updater check reports no newer version.
7. Deploy the website and verify its downloads and changelog.
