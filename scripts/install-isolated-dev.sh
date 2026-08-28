#!/usr/bin/env bash

# Install an isolated RAV DEV build at one stable path for repeatable manual QA.
# This script intentionally does not alter the production application or its
# Launch Services registration.

set -euo pipefail

readonly EXPECTED_BUNDLE_ID="app.rive.animation.viewer.flicker-test"
readonly PRODUCTION_BUNDLE_ID="app.rive.animation.viewer"
readonly DEFAULT_TARGET="${RAV_DEV_TARGET:-${HOME}/Desktop/RAV 2.5.2 DEV.app}"
readonly PRODUCTION_PATH="/Applications/Rive Animation Viewer.app"

usage() {
  cat >&2 <<'EOF'
Usage: install-isolated-dev.sh <source.app> [--target <stable-dev.app>] [--launch]

Copies an isolated DEV app to the stable target (default:
${HOME}/Desktop/RAV 2.5.2 DEV.app), refreshes only that target's Launch
Services registration, and optionally launches it.
EOF
}

fail() {
  echo "install-isolated-dev: $*" >&2
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

source_app=$1
shift
stable_target=$DEFAULT_TARGET
launch=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      stable_target=$2
      shift 2
      ;;
    --launch)
      launch=true
      shift
      ;;
    *)
      echo "install-isolated-dev: unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

[[ "$source_app" == *.app && -d "$source_app" && ! -L "$source_app" ]] \
  || fail "source must be a non-symlink .app directory: $source_app"
[[ "$stable_target" == *.app && "$stable_target" == /* && ! -L "$stable_target" ]] \
  || fail "stable target must be an absolute .app path (not a symlink): $stable_target"
[[ "$stable_target" != "$PRODUCTION_PATH" ]] \
  || fail "refusing to use the production application path"
[[ "$source_app" != "$PRODUCTION_PATH" ]] \
  || fail "refusing to install the production application"
[[ "$source_app" != "$stable_target" ]] \
  || fail "source and stable target must be different paths"

plistbuddy=${PLISTBUDDY_BIN:-/usr/libexec/PlistBuddy}
ditto_bin=${DITTO_BIN:-/usr/bin/ditto}
open_bin=${OPEN_BIN:-/usr/bin/open}
rm_bin=${RM_BIN:-/bin/rm}
mv_bin=${MV_BIN:-/bin/mv}

[[ -x "$plistbuddy" ]] || fail "PlistBuddy is unavailable: $plistbuddy"
[[ -x "$ditto_bin" ]] || fail "ditto is unavailable: $ditto_bin"

source_plist="$source_app/Contents/Info.plist"
[[ -f "$source_plist" ]] || fail "source Info.plist is missing: $source_plist"
bundle_id=$($plistbuddy -c 'Print :CFBundleIdentifier' "$source_plist" 2>/dev/null) \
  || fail "could not read source bundle identifier"
[[ "$bundle_id" == "$EXPECTED_BUNDLE_ID" ]] \
  || fail "source bundle identifier is '$bundle_id'; expected '$EXPECTED_BUNDLE_ID'"
[[ "$bundle_id" != "$PRODUCTION_BUNDLE_ID" ]] \
  || fail "refusing to install a production bundle"

lsregister=${LSREGISTER_BIN:-}
if [[ -z "$lsregister" ]]; then
  for candidate in \
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister; do
    if [[ -x "$candidate" ]]; then
      lsregister=$candidate
      break
    fi
  done
fi
[[ -n "$lsregister" && -x "$lsregister" ]] \
  || fail "Launch Services lsregister is unavailable"

target_parent=${stable_target%/*}
target_name=${stable_target##*/}
mkdir -p "$target_parent"
staging_dir=$(mktemp -d "$target_parent/.rav-dev-install.XXXXXX")
staged_app="$staging_dir/$target_name"
backup_dir=$(mktemp -d "$target_parent/.rav-dev-previous.XXXXXX")
backup_app="$backup_dir/$target_name"
old_moved=false

cleanup() {
  if [[ "$old_moved" == true && -e "$backup_app" && ! -e "$stable_target" ]]; then
    "$mv_bin" "$backup_app" "$stable_target" || true
  fi
  "$rm_bin" -rf -- "$staging_dir" "$backup_dir"
}
trap cleanup EXIT

"$ditto_bin" "$source_app" "$staged_app" \
  || fail "could not stage source app"

# Re-read the staged identity before replacing anything.
staged_bundle_id=$($plistbuddy -c 'Print :CFBundleIdentifier' \
  "$staged_app/Contents/Info.plist" 2>/dev/null) \
  || fail "staged app has no readable bundle identifier"
[[ "$staged_bundle_id" == "$EXPECTED_BUNDLE_ID" ]] \
  || fail "staged app identity changed unexpectedly: $staged_bundle_id"

if [[ -e "$stable_target" ]]; then
  [[ -d "$stable_target" && ! -L "$stable_target" ]] \
    || fail "existing stable target is not a real app directory: $stable_target"
  existing_plist="$stable_target/Contents/Info.plist"
  [[ -f "$existing_plist" ]] \
    || fail "existing stable target has no Info.plist: $existing_plist"
  existing_bundle_id=$($plistbuddy -c 'Print :CFBundleIdentifier' \
    "$existing_plist" 2>/dev/null) \
    || fail "could not read existing stable target bundle identifier"
  [[ "$existing_bundle_id" == "$EXPECTED_BUNDLE_ID" ]] \
    || fail "refusing to replace non-isolated stable target bundle: $existing_bundle_id"
  [[ "$existing_bundle_id" != "$PRODUCTION_BUNDLE_ID" ]] \
    || fail "refusing to replace a production bundle"
  "$lsregister" -u "$stable_target" \
    || fail "could not unregister the exact prior stable DEV target"
  "$mv_bin" "$stable_target" "$backup_app" \
    || fail "could not preserve the prior stable DEV target"
  old_moved=true
fi

"$mv_bin" "$staged_app" "$stable_target" \
  || fail "could not install the staged DEV app"
"$lsregister" -f "$stable_target" \
  || fail "could not register the new stable DEV target"

"$rm_bin" -rf -- "$backup_dir"
old_moved=false
trap - EXIT

echo "Installed isolated DEV app: $stable_target"
if [[ "$launch" == true ]]; then
  [[ -x "$open_bin" ]] || fail "open is unavailable: $open_bin"
  "$open_bin" "$stable_target" \
    || fail "could not launch the stable DEV app"
  echo "Launched: $stable_target"
fi
