#!/usr/bin/env bash
# Builds the PyBI desktop app for macOS and Linux (incl. ChromeOS).
#
#   installer/scripts/build_unix.sh --version 1.2.0 --repo rafay183/pybi
#
# macOS  (arm64 / x86_64) → dist/PyBI-macOS-<arch>.dmg        PyBI.app, drag to Applications
# Linux  (x86_64 / aarch64) → dist/PyBI-Linux-<arch>.AppImage any distro, no install
#                           → dist/pybi_<ver>_<amd64|arm64>.deb Debian, Ubuntu, ChromeOS
# Each file gets a .sha256 next to it, which the in-app updater verifies.
#
# Python comes from python-build-standalone (relocatable CPython incl. tkinter), so the
# result never depends on a Python installed on the user's machine.
# Needs: bash, curl/tar, gh (authenticated; preinstalled on GitHub runners).
# macOS also needs python3 (for PyInstaller), hdiutil, codesign. Linux also needs dpkg-deb.
set -euo pipefail

VERSION=""; REPO=""; PACKAGE_SPEC="${PACKAGE_SPEC:-}"
PBS_TAG="${PBS_TAG:-20241016}"; PY_MINOR="${PY_MINOR:-3.11}"
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --package) PACKAGE_SPEC="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$VERSION" ] || { echo "--version is required" >&2; exit 2; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INST="$ROOT/installer"; BUILD="$ROOT/build/unix"; DIST="$ROOT/dist"
OS="$(uname -s)"; ARCH="$(uname -m)"
step() { printf '\n==> %s\n' "$*"; }
sha() { (cd "$(dirname "$1")" && { sha256sum "$(basename "$1")" 2>/dev/null || shasum -a 256 "$(basename "$1")"; } > "$(basename "$1").sha256"); }

case "$OS-$ARCH" in
  Darwin-arm64)   TRIPLE=aarch64-apple-darwin;      PLAT=macOS-arm64 ;;
  Darwin-x86_64)  TRIPLE=x86_64-apple-darwin;       PLAT=macOS-x86_64 ;;
  Linux-x86_64)   TRIPLE=x86_64-unknown-linux-gnu;  PLAT=Linux-x86_64;  DEBARCH=amd64 ;;
  Linux-aarch64)  TRIPLE=aarch64-unknown-linux-gnu; PLAT=Linux-aarch64; DEBARCH=arm64 ;;
  *) echo "Unsupported platform $OS-$ARCH" >&2; exit 1 ;;
esac

step "Build $PLAT, version $VERSION"
rm -rf "$BUILD"; mkdir -p "$BUILD" "$DIST"

# ------------------------------------------------------------------ runtime
RT="$BUILD/python"; PY="$RT/bin/python3"
if [ -n "${RUNTIME_DIR:-}" ]; then   # local testing: reuse a prepared runtime, skip download + pip
  step "Using prepared runtime $RUNTIME_DIR"
  cp -a "$RUNTIME_DIR" "$RT"
else
  step "Download Python $PY_MINOR ($TRIPLE, python-build-standalone $PBS_TAG)"
  gh release download "$PBS_TAG" -R astral-sh/python-build-standalone \
    -p "cpython-${PY_MINOR}.*+${PBS_TAG}-${TRIPLE}-install_only.tar.gz" -D "$BUILD" --clobber
  tar -xzf "$BUILD"/cpython-*-install_only.tar.gz -C "$BUILD"
  "$PY" -c "import sys, ssl, sqlite3, tkinter; print(sys.version, 'Tk', tkinter.TkVersion)"

  step "Install PyBI and its dependencies"
  if [ -z "$PACKAGE_SPEC" ]; then
    if [ -f "$ROOT/pyproject.toml" ] || [ -f "$ROOT/setup.py" ]; then PACKAGE_SPEC="$ROOT"; else PACKAGE_SPEC="pybi-ray==$VERSION"; fi
  fi
  PIP=("$PY" -m pip install --disable-pip-version-check --no-warn-script-location)
  "${PIP[@]}" --upgrade pip setuptools wheel
  "${PIP[@]}" "$PACKAGE_SPEC"
  [ -f "$INST/requirements-extra.txt" ] && "${PIP[@]}" -r "$INST/requirements-extra.txt"
  "$PY" -c "import pybi; print('pybi', getattr(pybi, '__version__', '?'), 'from', pybi.__file__)"
  "$PY" -m compileall -q -j 0 "$RT/lib" > /dev/null || true
  # Console-script shims (pip, pybi, ...) hard-code this build folder; python3 -m works everywhere.
  for f in "$RT"/bin/*; do
    if [ -f "$f" ] && [ ! -L "$f" ] && head -c 2 "$f" | grep -q '#!'; then rm -f "$f"; fi
  done
  # ...and links that pointed at them (dangling links make macOS codesign fail)
  for f in "$RT"/bin/*; do
    if [ -L "$f" ] && [ ! -e "$f" ]; then rm -f "$f"; fi
  done
  ls -l "$RT/bin"

fi

write_cfg() {  # write_cfg <dest launcher.json> <asset regex> <install kind>
  "$PY" - "$INST/launcher/launcher.json" "$1" "$2" "$3" "$VERSION" "$REPO" <<'EOF'
import json, sys
base, dest, pattern, kind, version, repo = sys.argv[1:]
cfg = json.load(open(base, encoding="utf-8-sig"))
cfg.update(version=version, asset_pattern=pattern, install_kind=kind)
if repo:
    cfg["github_repo"] = repo
open(dest, "w", encoding="utf-8").write(json.dumps(cfg, indent=2) + "\n")
EOF
}

# Debian versions sort "~" before release: 1.2.0rc1 -> 1.2.0~rc1
DEBVER="$(printf '%s' "$VERSION" | sed -E 's/^v//; s/-?(a|b|rc|alpha|beta|dev|pre)/~\1/')"

# ================================================================== macOS
if [ "$OS" = Darwin ]; then
  step "Freeze the launcher into PyBI.app"
  python3 -m pip install --disable-pip-version-check pyinstaller==6.11.1
  python3 -m PyInstaller --noconfirm --clean --windowed --onedir --name PyBI \
    --icon "$INST/assets/pybi.icns" --osx-bundle-identifier io.github.rafay183.pybi \
    --paths "$INST/launcher" --add-data "$INST/assets/pybi.png:assets" \
    --distpath "$BUILD/dist" --workpath "$BUILD/work" --specpath "$BUILD" \
    "$INST/launcher/main.py"
  APP="$BUILD/dist/PyBI.app"; PLIST="$APP/Contents/Info.plist"
  pl() { /usr/libexec/PlistBuddy -c "Set :$1 $3" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PLIST"; }
  NUMVER="$(printf '%s' "$VERSION" | grep -oE '^[0-9]+(\.[0-9]+){0,2}')"
  pl CFBundleShortVersionString string "$NUMVER"
  pl CFBundleVersion string "$VERSION"
  pl CFBundleDisplayName string PyBI
  pl LSMinimumSystemVersion string 11.0
  pl NSHighResolutionCapable bool true
  pl LSApplicationCategoryType string public.app-category.business
  pl NSHumanReadableCopyright string "PyBI contributors"

  step "Add the Python runtime to the app"
  ditto "$RT" "$APP/Contents/Resources/runtime"
  write_cfg "$APP/Contents/Resources/launcher.json" "^PyBI-${PLAT}\\.dmg\$" macapp

  step "Sign (ad hoc) so Apple Silicon runs every binary"
  codesign --force --deep --sign - --timestamp=none "$APP"
  codesign --verify --deep --strict "$APP"

  step "Create the disk image"
  STAGE="$BUILD/dmg"; mkdir -p "$STAGE"
  ditto "$APP" "$STAGE/PyBI.app"
  ln -s /Applications "$STAGE/Applications"
  DMG="$DIST/PyBI-${PLAT}.dmg"; rm -f "$DMG"
  hdiutil create -volname "PyBI" -srcfolder "$STAGE" -ov -format UDZO -fs HFS+ "$DMG"
  sha "$DMG"
  step "Done: $DMG ($(du -h "$DMG" | cut -f1))"
  exit 0
fi

# ================================================================== Linux
DESKTOP_COMMON='Type=Application
Name=PyBI
GenericName=Business Intelligence
Comment=Build dashboards and reports in your browser
Icon=pybi
Terminal=false
Categories=Office;Development;
Keywords=bi;dashboard;power bi;report;data;analytics;
StartupWMClass=PyBI'

copy_app() {  # copy_app <dest dir>: runtime, launcher, assets
  mkdir -p "$1/assets"
  cp -a "$RT" "$1/runtime"
  mkdir -p "$1/launcher"
  cp -a "$INST/launcher/main.py" "$INST/launcher/pybi_launcher" "$1/launcher/"
  find "$1/launcher" -name '__pycache__' -prune -exec rm -rf {} +
  "$PY" -m compileall -q "$1/launcher" > /dev/null
  cp "$INST/assets/pybi.png" "$1/assets/pybi.png"
}

# ---------- AppImage ----------
step "Assemble the AppImage"
APPDIR="$BUILD/PyBI.AppDir"; mkdir -p "$APPDIR/usr"
copy_app "$APPDIR/usr"
write_cfg "$APPDIR/usr/launcher.json" "^PyBI-${PLAT}\\.AppImage\$" appimage
cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
export PYBI_APP_DIR="$HERE/usr"
for d in "$HERE"/usr/runtime/lib/tcl8.*; do [ -d "$d" ] && export TCL_LIBRARY="$d"; done
for d in "$HERE"/usr/runtime/lib/tk8.*; do [ -d "$d" ] && export TK_LIBRARY="$d"; done
exec "$HERE/usr/runtime/bin/python3" -E -s "$HERE/usr/launcher/main.py" "$@"
EOF
chmod +x "$APPDIR/AppRun"
printf '[Desktop Entry]\nExec=pybi\n%s\n' "$DESKTOP_COMMON" > "$APPDIR/pybi.desktop"
cp "$INST/assets/pybi.png" "$APPDIR/pybi.png"
ln -sf pybi.png "$APPDIR/.DirIcon"
mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"
cp "$INST/assets/pybi.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/pybi.png"

if [ -n "${SKIP_APPIMAGE:-}" ]; then echo "(skipping appimagetool)"; else
gh release download continuous -R AppImage/appimagetool -p "appimagetool-${ARCH}.AppImage" -D "$BUILD" --clobber
chmod +x "$BUILD/appimagetool-${ARCH}.AppImage"
APPIMAGE_OUT="$DIST/PyBI-${PLAT}.AppImage"; rm -f "$APPIMAGE_OUT"
APPIMAGE_EXTRACT_AND_RUN=1 ARCH="$ARCH" "$BUILD/appimagetool-${ARCH}.AppImage" --no-appstream "$APPDIR" "$APPIMAGE_OUT"
sha "$APPIMAGE_OUT"
fi

# ---------- .deb (Debian, Ubuntu, ChromeOS) ----------
step "Assemble the .deb package"
DEB="$BUILD/deb"; mkdir -p "$DEB/DEBIAN" "$DEB/opt/pybi" "$DEB/usr/bin" "$DEB/usr/share/applications"
copy_app "$DEB/opt/pybi"
write_cfg "$DEB/opt/pybi/launcher.json" "^pybi_.*_${DEBARCH}\\.deb\$" deb
cat > "$DEB/usr/bin/pybi-desktop" <<'EOF'
#!/bin/sh
export PYBI_APP_DIR=/opt/pybi
for d in /opt/pybi/runtime/lib/tcl8.*; do [ -d "$d" ] && export TCL_LIBRARY="$d"; done
for d in /opt/pybi/runtime/lib/tk8.*; do [ -d "$d" ] && export TK_LIBRARY="$d"; done
exec /opt/pybi/runtime/bin/python3 -E -s /opt/pybi/launcher/main.py "$@"
EOF
chmod 755 "$DEB/usr/bin/pybi-desktop"
printf '[Desktop Entry]\nExec=pybi-desktop\n%s\n' "$DESKTOP_COMMON" > "$DEB/usr/share/applications/pybi.desktop"
for s in 256 512; do
  mkdir -p "$DEB/usr/share/icons/hicolor/${s}x${s}/apps"
  "$PY" -c "import sys; from PIL import Image" 2>/dev/null \
    && "$PY" -c "from PIL import Image; Image.open('$INST/assets/pybi-1024.png').resize(($s,$s), Image.LANCZOS).save('$DEB/usr/share/icons/hicolor/${s}x${s}/apps/pybi.png')" \
    || cp "$INST/assets/pybi.png" "$DEB/usr/share/icons/hicolor/${s}x${s}/apps/pybi.png"
done
cat > "$DEB/DEBIAN/control" <<EOF
Package: pybi
Version: $DEBVER
Architecture: $DEBARCH
Maintainer: Muhammad Rafay Shaikh <da8alabsofficial@gmail.com>
Installed-Size: $(du -sk "$DEB/opt" "$DEB/usr" | awk '{s+=$1} END {print s}')
Depends: libc6 (>= 2.17), libx11-6
Recommends: xdg-utils
Section: misc
Priority: optional
Homepage: https://github.com/${REPO:-rafay183/pybi}
Description: PyBI - business intelligence studio in your browser
 Get data, shape it, model it and build interactive dashboards, then share
 them on your network or export them. Includes its own Python runtime.
EOF
cat > "$DEB/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
exit 0
EOF
cp "$DEB/DEBIAN/postinst" "$DEB/DEBIAN/postrm"
chmod 755 "$DEB/DEBIAN/postinst" "$DEB/DEBIAN/postrm"
DEB_OUT="$DIST/pybi_${DEBVER}_${DEBARCH}.deb"; rm -f "$DEB_OUT"
dpkg-deb --build --root-owner-group -Zxz "$DEB" "$DEB_OUT"
sha "$DEB_OUT"

step "Done"
ls -lh "$DIST"
