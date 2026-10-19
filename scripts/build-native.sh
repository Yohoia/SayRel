#!/usr/bin/env bash
# Builds the Swift helper dylibs as universal (arm64 + x86_64) binaries and
# emits them into resources/lib/<name>/build/, matching the reference layout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SWIFT_DIR="$ROOT/swift"
OUT="$ROOT/resources/lib"
MODULE_CACHE="$ROOT/.build/modulecache"
mkdir -p "$MODULE_CACHE"

build() {
  local name="$1"
  local src="$SWIFT_DIR/${name}.swift"
  local dir="$OUT/$name/build"
  mkdir -p "$dir"
  local fat="$dir/lib${name}.dylib"

  echo "==> building $name (arm64)"
  xcrun swiftc -O -whole-module-optimization \
    -target arm64-apple-macos13.0 \
    -emit-library -module-name "$name" \
    -module-cache-path "$MODULE_CACHE" \
    -o "$dir/.${name}-arm64.dylib" "$src"

  echo "==> building $name (x86_64)"
  xcrun swiftc -O -whole-module-optimization \
    -target x86_64-apple-macos13.0 \
    -emit-library -module-name "$name" \
    -module-cache-path "$MODULE_CACHE" \
    -o "$dir/.${name}-x86_64.dylib" "$src"

  echo "==> lipo $name"
  lipo -create "$dir/.${name}-arm64.dylib" "$dir/.${name}-x86_64.dylib" -output "$fat"
  rm -f "$dir/.${name}-arm64.dylib" "$dir/.${name}-x86_64.dylib"
  echo "   -> $fat"
}

helpers=("$@")
if [ ${#helpers[@]} -eq 0 ]; then
  helpers=(InputHelper KeyboardHelper ContextHelper UtilHelper)
fi
for helper in "${helpers[@]}"; do
  case "$helper" in InputHelper|KeyboardHelper|ContextHelper|UtilHelper) ;;
    *) echo "Unknown helper: $helper" >&2; exit 1 ;;
  esac
  build "$helper"
done

echo "done"
