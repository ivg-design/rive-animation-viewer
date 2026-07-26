#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "Usage: $0 <dmg> <app.tar.gz> <team-id> <aarch64|x86_64> <version>" >&2
  exit 2
fi

dmg_path=$1
updater_archive=$2
expected_team_id=$3
expected_arch=$4
expected_version=$5

if [[ ! "$expected_team_id" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "Expected Apple Team ID must be exactly 10 uppercase letters or digits" >&2
  exit 2
fi
if [[ ! "$expected_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Expected version must use X.Y.Z format" >&2
  exit 2
fi

case "$expected_arch" in
  aarch64 | arm64)
    expected_macho_arch=arm64
    ;;
  x86_64 | x64)
    expected_macho_arch=x86_64
    ;;
  *)
    echo "Unsupported architecture: $expected_arch" >&2
    exit 2
    ;;
esac

for required_file in "$dmg_path" "$updater_archive" "${updater_archive}.sig"; do
  if [[ ! -s "$required_file" ]]; then
    echo "Required release artifact is missing or empty: $required_file" >&2
    exit 1
  fi
done

work_dir=$(mktemp -d)
mount_point="$work_dir/dmg"
mounted=false

cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount_point" -quiet || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

fail() {
  echo "$*" >&2
  exit 1
}

signature_details() {
  codesign --display --verbose=4 "$1" 2>&1
}

require_signature_contract() {
  local target=$1
  local details
  details=$(signature_details "$target")

  grep -Fq "Authority=Developer ID Application:" <<<"$details" \
    || fail "Developer ID Application authority is missing: $target"
  grep -Fq "TeamIdentifier=$expected_team_id" <<<"$details" \
    || fail "Unexpected or missing TeamIdentifier: $target"
  grep -Eq '^Timestamp=.+' <<<"$details" \
    || fail "Secure timestamp is missing: $target"
  if grep -Fq 'Signature=adhoc' <<<"$details"; then
    fail "Ad-hoc signature found: $target"
  fi
}

require_hardened_runtime() {
  local target=$1
  local details
  details=$(signature_details "$target")
  grep -Eq '^CodeDirectory .*flags=.*runtime' <<<"$details" \
    || fail "Hardened runtime flag is missing: $target"
}

require_architecture() {
  local target=$1
  local architectures
  architectures=$(lipo -archs "$target")
  grep -Eq "(^| )${expected_macho_arch}( |$)" <<<"$architectures" \
    || fail "Expected architecture $expected_macho_arch is missing from $target ($architectures)"
}

reject_forbidden_entitlements() {
  local target=$1
  if codesign --display --entitlements - "$target" 2>&1 \
    | grep -Fq 'com.apple.security.get-task-allow'; then
    fail "Forbidden get-task-allow entitlement found: $target"
  fi
}

verify_app() {
  local app_path=$1
  local label=$2
  local executable_name
  local main_binary
  local sidecar
  local sidecar_count
  local bundle_id
  local bundle_short_version
  local bundle_version

  codesign --verify --deep --strict --verbose=4 "$app_path"
  require_signature_contract "$app_path"
  require_hardened_runtime "$app_path"
  xcrun stapler validate "$app_path"
  spctl --assess --type execute --verbose=4 "$app_path"

  if command -v syspolicy_check >/dev/null 2>&1; then
    syspolicy_check distribution "$app_path"
  fi

  executable_name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' \
    "$app_path/Contents/Info.plist")
  bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
    "$app_path/Contents/Info.plist")
  bundle_short_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
    "$app_path/Contents/Info.plist")
  bundle_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' \
    "$app_path/Contents/Info.plist")
  main_binary="$app_path/Contents/MacOS/$executable_name"
  sidecar="$app_path/Contents/MacOS/rav-mcp"

  [[ "$bundle_id" == "app.rive.animation.viewer" ]] \
    || fail "$label has unexpected bundle identifier: $bundle_id"
  [[ "$bundle_short_version" == "$expected_version" ]] \
    || fail "$label has unexpected short version: $bundle_short_version"
  [[ "$bundle_version" == "$expected_version" ]] \
    || fail "$label has unexpected bundle version: $bundle_version"
  [[ -x "$main_binary" ]] || fail "$label main executable is missing: $main_binary"
  [[ -x "$sidecar" ]] || fail "$label MCP sidecar is missing: $sidecar"

  sidecar_count=$(find "$app_path/Contents" -type f -name 'rav-mcp' | wc -l | tr -d ' ')
  [[ "$sidecar_count" == 1 ]] \
    || fail "$label contains $sidecar_count rav-mcp binaries; expected exactly one"

  if [[ -d "$app_path/Contents/Resources" ]]; then
    while IFS= read -r -d '' resource_file; do
      if file -b "$resource_file" | grep -Fq 'Mach-O'; then
        fail "$label contains an unexpected Mach-O executable in Resources: $resource_file"
      fi
    done < <(find "$app_path/Contents/Resources" -type f -print0)
  fi

  for executable in "$main_binary" "$sidecar"; do
    codesign --verify --strict --verbose=4 "$executable"
    require_signature_contract "$executable"
    require_hardened_runtime "$executable"
    require_architecture "$executable"
    reject_forbidden_entitlements "$executable"
  done
}

mkdir -p "$work_dir/updater" "$mount_point"
tar -xzf "$updater_archive" -C "$work_dir/updater"

updater_app_count=$(find "$work_dir/updater" -maxdepth 2 -type d -name '*.app' | wc -l | tr -d ' ')
[[ "$updater_app_count" == 1 ]] \
  || fail "Updater archive must contain exactly one app bundle"
updater_app=$(find "$work_dir/updater" -maxdepth 2 -type d -name '*.app' -print -quit)

verify_app "$updater_app" "Updater archive"

codesign --verify --strict --verbose=4 "$dmg_path"
require_signature_contract "$dmg_path"
xcrun stapler validate "$dmg_path"
spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg_path"

hdiutil attach "$dmg_path" -readonly -nobrowse -mountpoint "$mount_point" -quiet
mounted=true

dmg_app_count=$(find "$mount_point" -maxdepth 2 -type d -name '*.app' | wc -l | tr -d ' ')
[[ "$dmg_app_count" == 1 ]] || fail "DMG must contain exactly one app bundle"
dmg_app=$(find "$mount_point" -maxdepth 2 -type d -name '*.app' -print -quit)

verify_app "$dmg_app" "DMG"

updater_cdhash=$(signature_details "$updater_app" | sed -n 's/^CDHash=//p' | head -n 1)
dmg_cdhash=$(signature_details "$dmg_app" | sed -n 's/^CDHash=//p' | head -n 1)

[[ -n "$updater_cdhash" && "$updater_cdhash" == "$dmg_cdhash" ]] \
  || fail "DMG and updater archive contain different signed app builds"

echo "Verified Developer ID signing, notarization, stapling, architecture, and updater parity."
