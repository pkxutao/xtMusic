#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NATIVE="$ROOT/native"
VERSION="${1:-0.3.0}"
ARCH="${2:-amd64}"
DIST="$NATIVE/dist"
PKG="$NATIVE/target/deb-root"

rm -rf "$PKG" "$DIST"
mkdir -p \
  "$PKG/DEBIAN" \
  "$PKG/usr/bin" \
  "$PKG/usr/share/applications" \
  "$PKG/usr/share/icons/hicolor/256x256/apps" \
  "$DIST"

install -m 0755 "$NATIVE/target/release/xtmusic" "$PKG/usr/bin/xtmusic"
install -m 0644 "$ROOT/assets/app-icon.png" \
  "$PKG/usr/share/icons/hicolor/256x256/apps/xtmusic-native.png"

cat > "$PKG/DEBIAN/control" <<EOF
Package: xtmusic
Version: $VERSION
Section: sound
Priority: optional
Architecture: $ARCH
Maintainer: pkxutao
Depends: libgtk-3-0, libasound2, libxkbcommon0, libgl1
Conflicts: xtmusic-native
Replaces: xtmusic-native
Provides: xtmusic-native
Description: Native high-performance FNOS Music desktop client
 XT Music Native is a Rust and egui desktop client for FNOS Music.
 It does not embed Electron or a WebView runtime.
EOF

cat > "$PKG/DEBIAN/preinst" <<'EOF'
#!/bin/sh
set -e
pkill -f '/opt/XT Music/xtmusic' 2>/dev/null || true
pkill -x xtmusic 2>/dev/null || true
exit 0
EOF
chmod 0755 "$PKG/DEBIAN/preinst"

cat > "$PKG/usr/share/applications/xtmusic-native.desktop" <<'EOF'
[Desktop Entry]
Name=XT Music Native
Name[zh_CN]=XT Music 原生版
Comment=Native FNOS Music desktop client
Exec=/usr/bin/xtmusic
Icon=xtmusic-native
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Player;
StartupNotify=true
StartupWMClass=xtmusic
EOF

dpkg-deb --root-owner-group --build "$PKG" \
  "$DIST/XT-Music-Native-$VERSION-Ubuntu-$ARCH.deb"

tar -C "$NATIVE/target/release" -czf \
  "$DIST/XT-Music-Native-$VERSION-Ubuntu-x86_64.tar.gz" xtmusic

(
  cd "$DIST"
  sha256sum ./* > SHA256SUMS.txt
)

printf 'Packages written to %s\n' "$DIST"
