# Release Process

RAV releases are built as one atomic cross-platform set by
`.github/workflows/release.yml`. Every platform uploads to a draft GitHub
Release. The release stays private until native signing, Apple notarization,
artifact inventory, updater signatures, the merged `latest.json`, and an
isolated update/install/relaunch acceptance all pass. Publication is a separate
manual promotion that never rebuilds the accepted bytes.

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
- private staging that cannot change `releases/latest`;
- a separate manual promotion workflow that re-verifies the exact commit,
  byte ledger, acceptance receipt, signatures, notarization, and manifest.

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
- `APPLE_TEAM_ID` — Apple Developer Team ID;
- `RAV_COUNTER_ENDPOINT` — credential-free HTTPS URL ending exactly in
  `/v1/event`. The release workflow verifies its `/v1/health` route before it
  creates or reuses a draft.

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

7. When a release changes the dual-WebView rendering path, complete the
   [dual-WebView pre-release gate](#dual-webview-pre-release-gate) below and
   retain its receipt.

8. Complete the anonymous callback acceptance below against an isolated test
   Worker/D1 and retain its aggregate-only receipt.

9. For a macOS release that changes `.riv` registration, document icons, or the
   Settings default-app control, complete the
   [macOS `.riv` handler and icon gate](#macos-riv-handler-and-icon-gate) below.

10. Commit the complete release with the exact subject:

   ```bash
   git commit -m "chore(release): vX.Y.Z"
   ```

   Land that exact commit as the tip of `main`. If using a pull request, use a
   squash merge with this exact subject; a differently titled merge commit will
   not start the release.

## Dual-WebView pre-release gate

Run this gate before a release that changes child-render-surface creation,
controller/message relay, canvas sizing, presentation state, overlays, or reload
behavior. Unit tests cover the contracts; they do **not** substitute for this
actual desktop validation.

1. Run the focused automated contract set:

   ```bash
   npm run test:dual-webview
   ```

2. Build and launch the actual Tauri app for the target platform. Connect a real
   RAV MCP client and open a fixture that exposes ViewModel controls. Use the
   same fixture for the first seven checks; use a distinct second `.riv` for the
   final reload check.
3. Record every assertion in a copy of
   `.github/dual-webview-gate-receipt.template.json` (outside the tracked
   template). The validation is complete only when its build stamp, platform,
   fixture, validator, timestamp, automated result, and every assertion are
   recorded as passed:

   ```bash
   npm run verify:dual-webview-receipt -- --receipt /path/to/receipt.json
   ```

4. In the actual Tauri window, with MCP-driven control changes where applicable,
   verify and record:

   - the child render WebView stays above the parent canvas after loading;
   - switching Auto to a small Fixed canvas centers it;
   - Auto to Fixed uses logical CSS pixels rather than DPR-scaled backing-store
     pixels, and Rive art alignment still moves on an axis with available space;
   - an oversized Fixed canvas opens at its authored top-left scroll origin
     rather than a displaced viewport;
   - background, fit, and alignment remain correct after playback starts;
   - controls queued while a render surface reloads are applied once it loads;
   - static, paused, inert, and already-finished artboards activate without
     depending on a subsequent runtime advance callback;
   - rapid A → B → A artboard changes, playback-type changes, and authored or
     runtime-list instance changes never produce a first-frame timeout, blank or
     stale frame, wrong selection, or stale-session receipt;
   - toolbar Reset restarts in place without changing the render-surface session
     or returning the FPS badge to its `ISOLATED` readiness state;
   - Properties `DEFAULT` resets in place with the same session/FPS behavior;
   - both workspace drawers remain accessible;
   - Settings, MCP Setup, About, and export overlays are accessible above the
     render surface, preserve playback state while open, and restore the child
     surface after closing;
   - each overlay closes from clicks on the canvas and every main-window region
     outside it, while clicking its originating toolbar button toggles it once
     without a close/reopen race;
   - Settings stays compact at its normal width without an unnecessary
     scrollbar, and every overlay retains complete corners, its RAV-yellow frame,
     and styled scrollbars only on intentionally scrollable inner content;
   - opening an overlay does not force focus onto its close button or first
     control; keyboard focus uses a subtle RAV-yellow glow without a native blue
     or doubled hard outline;
   - invalid Fixed dimensions (including `0`, `8193`, decimals, text, and very
     large values) emit no canvas action, restore the last committed value, and
     do not surface a generic control-action error; and
   - opening a second `.riv` replaces the first child surface and remains
     controllable through MCP.

Do not mark this gate passed from browser-only, unit-test-only, screenshot-only,
or synthetic WebView evidence. This receipt is an attestation of the actual
Tauri + RAV MCP run; the script validates completeness, not visual behavior.

### Isolated DEV MCP receipt gate

Before a DEV candidate can support the native visual receipt above, run
`scripts/isolated-dev-mcp-acceptance-harness.mjs` against the exact packaged
sidecar on port `9278`. Supply the packaged build stamp, version, `dev` channel,
absolute scenario path, and independently calculated SHA-256 digests for both
the sidecar and scenario. The harness refuses `/Applications`, port `9274`, a
different build identity, changed input bytes, duplicate assertion names, or
any skipped check.

Verify the resulting JSON with `npm run verify:isolated-dev-mcp-receipt --`
using the same exact build/version/channel, sidecar/scenario paths, and digests.
The verifier independently hashes both files and requires the complete
scenario-derived A/B/A inventory plus every authored-instance, timeline,
state-machine, image, scalar ViewModel, runtime-list, reset/default, and canvas
presentation assertion exactly once. Retain the verified receipt with the
candidate provenance. This gate proves authoritative state and command
contracts; the user-controlled native receipt remains required for rendered
pixels, flicker, layout, focus, and Finder behavior.

## macOS `.riv` handler and icon gate

Run this gate on the packaged macOS app whenever a release changes Launch
Services registration, `.riv` document metadata, the document icon, or the
Settings action that makes RAV the default opener. This gate is separate from
the updater acceptance: installing or relaunching an app does not prove its
Launch Services ownership or Finder document icon.

1. Confirm the packaged official app still declares `LSHandlerRank=Alternate`.
   Merely installing or updating RAV must not silently replace the user's
   chosen default `.riv` app.
2. Open Settings and verify the live status is derived from both the canonical
   `app.rive.editor.rive-file` UTI and the legacy
   `app.rive.animation.viewer.riv` UTI:

   - both point to this exact installed RAV bundle: `RAV DEFAULT`;
   - only one points to this bundle: `PARTIAL`;
   - neither points to this bundle: `OTHER APP`;
   - the status cannot be queried safely: `UNAVAILABLE`.

3. From an installed official RAV bundle, invoke **MAKE DEFAULT** and confirm
   macOS completes the request for both UTIs. Re-open Settings after the bounded
   verification delay and confirm `RAV DEFAULT` names this exact bundle path,
   not another RAV copy with the same bundle identifier.
4. Invoke **REPAIR ICON** while RAV is already default. Confirm the document
   claims and bundled `RiveFileIcon.icns` are re-registered and both `.riv`
   handlers are reasserted without changing playback state or restarting
   Finder. Finder may repaint its icon cache asynchronously, so verify the
   visible `.riv` icon separately after allowing the normal system refresh.
5. Confirm an ordinary isolated DEV identifier reports `UNAVAILABLE`, disables
   the action, and cannot mutate Launch Services. A locally packaged association
   test build may opt in only through the exact
   `app.rive.animation.viewer.flicker-test` identifier and an explicit Settings
   action. Never use that identifier in CI or an official release artifact. Also
   confirm the native command
   rejects bundles running from a disk image, App Translocation, Trash, or a
   bundle missing `Contents/Info.plist` or `Contents/Resources/RiveFileIcon.icns`.
6. Record the final handler URL for both UTIs, the exact app bundle path, the
   visible document icon result, macOS version, and build stamp in the release
   receipt.

Quick Look preview generation is explicitly outside this gate. The default app
controls double-click/open handling, and bundle metadata supplies the Finder
document icon; neither repairs or installs an independent Quick Look provider.

## Anonymous callback acceptance

The normal callback reports anonymous installation and monthly-active receipts.
When a user turns Anonymous Usage off, RAV sends one final anonymous
`telemetry_off` control receipt and immediately disables further reporting. A
failed final receipt remains pending locally and receives one bounded retry,
then one retry per later launch until the idempotent Worker acknowledges it.

Run this gate before every public release that changes the callback client,
Worker, build configuration, or release version. It does not require publishing
RAV or writing synthetic rows to the production counter.

1. With Wrangler `4.125.0`, create a fresh temporary local D1 persistence root,
   apply `telemetry/worker/schema.sql`, and run the checked-in Worker with a
   temporary 32-byte-or-longer `TOKEN_PEPPER`.
2. Expose that local Worker through an ephemeral Cloudflare Quick Tunnel. Verify
   the trusted HTTPS `/v1/health` returns `204` and `/v1/stats` begins at zero.
3. Build the exact release-profile source with
   `RAV_TELEMETRY_ACCEPTANCE=1`,
   `RAV_TELEMETRY_ACCEPTANCE_ENDPOINT=<temporary HTTPS /v1/event URL>`,
   `RAV_TELEMETRY_ACCEPTANCE_ACTION=enable` or `disable`, and a fresh
   `RAV_TELEMETRY_ACCEPTANCE_ROOT` for that action. Create that root below the
   process temp directory, not hard-coded `/tmp` (for example,
   `accept_root=$(mktemp -d "${TMPDIR%/}/rav-telemetry-acceptance.XXXXXX")`).
   The external runner observes only
   `$accept_root/rav-telemetry-acceptance-result.json`; it contains the bounded
   action result and no token or endpoint. Use a new root and marker for every
   action launch. Build with a disposable `CARGO_TARGET_DIR` and
   `--config src-tauri/tauri.telemetry-acceptance.conf.json`. Explicitly unset
   `RAV_OFFICIAL_RELEASE` and `RAV_COUNTER_ENDPOINT`. The acceptance config has
   its own app identity and data directory; the binary refuses to start under
   any normal RAV identifier, disables updater activity, never starts MCP, and
   advertises no `.riv` document types to Launch Services.
   The dedicated action invokes the same Settings controller path exactly once
   after setup and does not steal focus from an active DEV build. This exercises
   the release-profile Rust sender without sharing application state, ports, or
   network configuration with an installed RAV build.
4. On a fresh `enable` action launch, verify the result marker reports success,
   then verify the aggregate reaches exactly one. Confirm client state records
   `installReported: true` and clears its pending install token.
5. After the further 60-second delay, query only aggregate D1 values and confirm
   one `monthly_active` row for the current UTC month. Query token lengths, not
   token values, to confirm stored digests are 64 hexadecimal characters.
6. Run a fresh-root `disable` action launch. Confirm the local durable marker is
   created before the request, pending activity-reporting secrets are removed, and
   `telemetryOffAttempted` is true. Query the private
   `anonymous_install_status` table and confirm that identity is `disabled`.
7. Relaunch while disabled and prove no further request is attempted. Then
   re-enable and disable the same identity again: the install aggregate must
   remain unchanged while its durable status moves `enabled` then `disabled`.
8. Stop the app and tunnel and remove the isolated test profile and temporary D1
   data. The final production endpoint still requires its own health/stats smoke
   test before setting the repository variable.

For a schema-v2 callback release, complete the production Worker rollout before
pushing the guarded desktop release commit. Preserve the current aggregate,
apply `telemetry/worker/migrations/0003_install_status.sql`, apply the one-time
`0004_preference_generation.sql`, deploy the checked-in Worker, and verify both
`GET /v1/health` (`204`) and the aggregate-only `GET /v1/stats` response. The
Worker remains compatible with released schema-v1 clients during this rollout.

The 2026-08-22 `2.5.0` pre-release run passed this path with DEV build `b0177`:
health `204`, installations `0 → 1`, monthly active `0 → 1`, stored release
`2.5.0`, 64-character HMAC digests, and both totals unchanged after relaunch.
Repeat the gate on the final clean release commit if any callback-related source
or build wiring changes afterward.

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
7. `stage-private-updater-candidate` creates a deterministic complete
   `latest.json`, uploads it to the draft, cryptographically verifies the
   updater payloads again, and records every release byte in
   `updater-staging-ledger.json`.
8. The workflow stops. The draft, its tag name, and all assets remain private;
   no Git tag exists and `releases/latest` remains unchanged.
9. After local signed acceptance, an operator uploads the generated
   `updater-acceptance-receipt.json` and explicitly dispatches
   `.github/workflows/promote-updater-candidate.yml`. Promotion checks out the
   ledger's exact commit, rehashes every staged asset, re-verifies every updater
   signature and both notarized macOS distributions, reproduces `latest.json`
   byte-for-byte, verifies the receipt, then publishes the same draft without a
   rebuild.

Only the promotion action creates the public `vX.Y.Z` tag. A guarded release
commit push and manual staging dispatch run the same complete platform set but
cannot publish it.

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

## Private signed updater acceptance

Acceptance exercises the candidate's real Tauri updater mechanics from a
synthetic disposable bootstrap to the exact signed and notarized archive held
in the private draft. The bootstrap is built from the current acceptance-aware
source, stamped `2.4.2`, and assigned a separate acceptance bundle identifier;
it is **not** the public v2.4.2 binary. This lane proves signature verification,
download, in-place replacement, and relaunch without publishing, but it cannot
prove the literal public-v2.4.2-to-v2.4.3 GitHub `releases/latest` path. The
public v2.4.2 binary has no private-draft endpoint override and GitHub excludes
drafts from `releases/latest`, so that exact path is not available before
publication. Keep this receipt scoped to synthetic signed-updater acceptance.
It does not copy into `/Applications` and must not mutate the real production
profile.

The production updater config remains HTTPS-only and fixed at GitHub
`releases/latest`. Insecure loopback transport is enabled only in
`src-tauri/tauri.acceptance.conf.json`, which builds the disposable 2.4.2
bootstrap. The Rust backend applies that endpoint only after all of these
checks:

- `RAV_UPDATER_ACCEPTANCE=1` is explicitly set;
- the endpoint uses an IP literal of `127.0.0.1` or `::1`, an explicit port, no
  credentials/query/fragment, and ends in `/latest.json`;
- `RAV_UPDATER_ACCEPTANCE_ROOT` is exactly the process `TMPDIR`;
- the harness supplies a random unguessable URL path;
- Tauri still verifies the downloaded archive with the production updater
  public key before installation.

The installed production candidate does not inherit the bootstrap's insecure
transport setting. The main window is declared with `create: false` in the
Tauri config and constructed from that config in Rust. Only when
`RAV_UPDATER_ACCEPTANCE=1` is active does the builder add `.incognito(true)`.
This non-persistent WebView is required because macOS Foundation ignores a
substituted `HOME` for WebKit storage. Normal production launches do not enable
incognito mode and retain their persistent WebView profile. The candidate only
records the isolated relaunch marker; the harness then terminates it before a
second acceptance update check.

Acceptance mode also skips Launch Services registration and MCP launcher/bridge
integration. The harness copies the bootstrap into a fresh temporary root,
redirects `HOME`, `TMPDIR`, and XDG directories there, serves only the selected
manifest and payload on loopback, and requires launch markers proving a new PID
and the candidate version from the same temporary `.app` path. It refuses to
start while another RAV instance is running. Before and after the run it
recursively fingerprints the complete `/Applications/Rive Animation Viewer.app`
tree and the production RAV roots under Application Support, Caches,
HTTPStorages, Preferences, Saved Application State, and WebKit; every
fingerprint must remain unchanged.

After the signed staging workflow completes, use the exact candidate checkout:

```bash
npm ci
npm run build:updater-bootstrap

npm run accept:updater -- \
  --repo ivg-design/rive-animation-viewer \
  --tag vX.Y.Z \
  --expected-commit FULL_40_CHARACTER_COMMIT_SHA \
  --bootstrap-app "src-tauri/target/release/bundle/macos/Rive Animation Viewer.app" \
  --output updater-acceptance-receipt.json
```

The harness uses the authenticated `gh` session only to read the private draft.
It verifies the ledger, all updater signatures, the canonical manifest, the
served payload request, installation, relaunch, and unchanged protected-path
fingerprints before writing a passing receipt. A failed run retains its
temporary directory for diagnosis; a passing run removes it unless
`--keep-workdir` is supplied.

The signed updater receipt is deliberately not Launch Services or Finder proof:
acceptance skips Launch Services registration and never replaces the installed
`/Applications` bundle. Exact Finder icon migration must be verified separately
with the signed candidate installed over an older build and relaunched through
the production path. Do not attach that claim to the updater receipt.

Review the receipt, then record and promote it as two explicit operations:

```bash
tag=vX.Y.Z
commit=FULL_40_CHARACTER_COMMIT_SHA
receipt=updater-acceptance-receipt.json
receipt_sha=$(shasum -a 256 "$receipt" | awk '{print $1}')

gh release upload "$tag" \
  "$receipt#updater-acceptance-receipt.json" \
  --repo ivg-design/rive-animation-viewer \
  --clobber

gh workflow run promote-updater-candidate.yml \
  --repo ivg-design/rive-animation-viewer \
  --ref main \
  -f tag="$tag" \
  -f expected_commit="$commit" \
  -f acceptance_receipt_sha256="$receipt_sha" \
  -f confirmation="PUBLISH $tag"
```

Do not upload a receipt from a different draft or rerun acceptance after any
asset changes. Any change causes ledger or receipt verification to fail and
requires a fresh staging/acceptance cycle.

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

## Windows `.riv` document-icon acceptance

The static gate verifies both installer definitions and all ten frames of the
tracked icon before packaging:

```bash
npm run verify:windows-document-icon
```

After building, use a Windows snapshot with a known pre-existing `.riv`
handler. Install or update with the NSIS setup executable, then run the checked-in
PowerShell gate from the same candidate checkout. For the current acceptance
fixture, the pre-RAV ProgID is `Rive Animation`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-windows-document-icon.ps1 `
  -ExpectedVersion 2.5.3 `
  -ExpectedBundleType NSS `
  -ExpectedPreviousProgId 'Rive Animation' `
  -ExpectedIconSha256 13e12927439f4c98db3250516389822d706e4d1b7fdf3e2b2dad0fc6cff785fb `
  -ReceiptPath "$env:USERPROFILE\Desktop\rav-windows-document-icon-receipt.json"
```

The gate fails unless the installed executable has the expected product
version and NSIS marker, `.riv` resolves to an existing ProgID, `DefaultIcon`
uses an existing `RiveFileIcon.ico` rather than `app.exe`, the icon hash
matches, and the original handler backup survived the in-place update. Confirm
the desktop `.riv` changes without restarting Explorer or clearing its icon
cache. Then uninstall normally and confirm `.riv` is restored to the original
ProgID, `Rive File_backup` is absent, and the installed icon file was removed.

Repeat from a clean snapshot with the MSI, `-ExpectedBundleType MSI`, and the
explicit per-machine `-InstallDir` (omit `-ExpectedPreviousProgId`). The MSI
gate requires the generated ProgID and icon value under HKLM and rejects an
HKCU shadow. This proves both package types; a passing NSIS updater check alone
does not prove the MSI component.

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
8. `latest.json` and the byte ledger uploaded while the release remains draft;
9. the same isolated acceptance harness run against the private assets;
10. the passing receipt recorded and the no-rebuild promotion checks completed.

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
vercel link --yes --project rav --scope ivgs-projects
vercel pull --yes --environment=production --scope ivgs-projects
vercel build --prod --scope ivgs-projects
vercel deploy --prebuilt --prod --yes --scope ivgs-projects
```

Always run the explicit `vercel link` step on a fresh checkout; otherwise Vercel
can create a new project from the `web/` directory name instead of selecting
`ivgs-projects/rav`. Keep
`NEXT_PUBLIC_SITE_URL=https://forge.mograph.life/apps/rav/` and set the server-only
`RAV_COUNTER_STATS_URL` to the credential-free HTTPS `.../v1/stats` endpoint.
Then verify the direct Vercel deployment, the public Forge URL, the Privacy page,
and that a foreground homepage reload reaches the Worker aggregate within the
documented few-minute cache window. Do not claim a strict 60-second guarantee.

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
6. For the 2.4.2 hotfix, install 2.4.1, update to 2.4.2 in-app, and relaunch.
   Confirm About reports 2.4.2, the next updater check reports no newer
   version, `Contents/MacOS/rav-mcp` exists in the installed app, the MCP chip
   reaches its healthy state, and the stable client launcher resolves to that
   bundled sidecar.
7. Run the Windows `.riv` document-icon acceptance above against both NSIS and
   MSI packages, including the NSIS uninstall restoration check.
8. Deploy the website and verify its downloads and changelog.
