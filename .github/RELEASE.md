# Release Process

## Automated Releases via GitHub Actions

This repository uses GitHub Actions to automatically build and release the Tauri desktop app for Windows and macOS.

### How to Trigger a Release

**Simply commit with a release flag** - the workflow will automatically bump the version:

```bash
# Patch version bump (1.1.2 → 1.1.3)
git commit -m "Fix animation playback bug release:patch"
git push origin main

# Minor version bump (1.1.2 → 1.2.0)
git commit -m "Add new export feature release:minor"
git push origin main

# Major version bump (1.1.2 → 2.0.0)
git commit -m "Complete UI redesign release:major"
git push origin main
```

The workflow will automatically:
1. **Parse** the release flag (`release:major`, `release:minor`, or `release:patch`)
2. **Bump** version in all files (package.json, tauri.conf.json, Cargo.toml)
3. **Commit** the version changes back to main (with `[skip ci]` to avoid loops)
4. **Build** for macOS (Universal binary - Intel + Apple Silicon)
5. **Build** for Windows (.msi installer)
6. **Create** a GitHub Release with version tag
7. **Upload** the built binaries to the release

### Semantic Versioning

Use the appropriate flag based on your changes:

- **`release:patch`** - Bug fixes, small tweaks (1.1.2 → 1.1.3)
- **`release:minor`** - New features, backwards-compatible (1.1.2 → 1.2.0)
- **`release:major`** - Breaking changes, major updates (1.1.2 → 2.0.0)

Current version: **1.1.2** (testing CI/CD pipeline)

### No Manual Version Updates Needed!

The workflow automatically updates versions in:
- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `package.version`
- `src-tauri/Cargo.toml` → `version`

You don't need to manually edit these files anymore.

### Manual Release (Local Build)

To build locally without the CI/CD pipeline:

```bash
# Manually bump version first
node scripts/bump-version.mjs patch  # or minor/major
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "Bump version"

# Build the frontend
npm run build

# Build the Tauri app
npm run tauri build
```

Outputs will be in:
- macOS: `src-tauri/target/release/bundle/dmg/`
- Windows: `src-tauri/target/release/bundle/msi/`

### Workflow Details

The workflow (`release.yml`) only runs when:
- A commit is pushed to `main` branch
- The commit message contains `release:major`, `release:minor`, or `release:patch`
- Or manually triggered via GitHub Actions UI (uses current version, no bump)

### Build Matrix

| Platform | Target | Output |
|----------|--------|--------|
| macOS | universal-apple-darwin | `.dmg` (Universal) |
| Windows | x86_64-pc-windows-msvc | `.msi` installer |

### Requirements

No special setup needed. GitHub Actions will:
- Install Node.js 20
- Install Rust toolchain
- Install platform dependencies
- Build and release automatically

### Troubleshooting

**Build fails on macOS:**
- Check that Xcode Command Line Tools are available in the runner

**Build fails on Windows:**
- Check that WebView2 is available (usually pre-installed)

**Release not created:**
- Ensure commit message contains `release:major`, `release:minor`, or `release:patch`
- Check GitHub Actions logs for errors
- Verify `GITHUB_TOKEN` has release permissions

**Version not bumped:**
- Check that `scripts/bump-version.mjs` exists
- Verify the bump-version job succeeded in Actions logs
- Check for merge conflicts if multiple releases happen simultaneously

**Infinite loop detected:**
- The version bump commit includes `[skip ci]` to prevent re-triggering
- If loops occur, check git config in the workflow
