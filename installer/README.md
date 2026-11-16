# PyBI desktop apps

This folder builds PyBI for every desktop platform. Every package includes its own Python and every library, shows the ر icon, opens PyBI in the browser, and updates itself from GitHub Releases.

| Platform | File | How it installs | How it updates |
|---|---|---|---|
| Windows 10/11 x64 | `PyBI-Setup.exe` (+ `.zip`) | Wizard, per user, no admin | Silent in-place upgrade |
| macOS 11+ Apple Silicon | `PyBI-macOS-arm64.dmg` | Drag `PyBI.app` to Applications | Replaces `PyBI.app` in place |
| macOS 11+ Intel | `PyBI-macOS-x86_64.dmg` | Same | Same |
| Linux x86_64 / ARM64 | `PyBI-Linux-<arch>.AppImage` | Nothing to install | Replaces the AppImage file |
| Debian, Ubuntu, ChromeOS | `PyBI-Linux-<amd64\|arm64>.deb` | `install.sh` one-liner, double-click or `apt install` (`/opt/pybi`) | Installs itself when `sudo` needs no password (ChromeOS); otherwise saves it to Downloads with the install command |

Every file has a `<name>.sha256`; the updater refuses a download whose checksum does not match.

**ChromeOS** runs PyBI in its built-in Linux. ChromeOS 145 stopped installing `.deb` files from the Files app, so Chromebook users run `curl -fsSL https://rafay183.github.io/pybi/install.sh | bash` in the Terminal ([docs/install.sh](../docs/install.sh): picks amd64/arm64, verifies the SHA-256, installs with apt). PyBI appears in the launcher and opens in Chrome. Because Linux on a Chromebook has passwordless `sudo`, the `.deb` build also installs its own updates.

## Folder map

```
.github/workflows/build-installer.yml   CI: test → build → smoke-test → publish to Releases
installer/
  pybi.iss                 Inno Setup wizard script (AppId must never change)
  scripts/build.ps1        Windows: runtime + PyBI.exe + setup (PowerShell 7)
  scripts/build_unix.sh    macOS (.dmg) and Linux (.AppImage, .deb)
  launcher/                the PyBI.exe desktop app (Python + Tk)
    main.py                entry point
    launcher.json          start command, port, update settings
    pybi_launcher/         config, server, updater, versions, single-instance, UI
    tests/                 pytest suite (runs in CI before every build)
  assets/                  ر icon (.ico, .icns, .png), wizard artwork
  requirements-extra.txt   optional: extra packages to bundle (create it if needed)
```

## Releasing a new version (the whole process)

1. Bump the version in `pyproject.toml`, for example to `1.3.0`, and commit.
2. Tag and push:
   ```bash
   git tag v1.3.0
   git push origin v1.3.0
   ```
3. GitHub Actions runs the launcher tests on Windows, macOS and Linux, then builds all six packages in parallel. Each one is installed and smoke-tested (PyBI must import, and the studio must answer on macOS and Linux) before everything is published together as release **v1.3.0**. This takes about 15–25 minutes.
4. Installed copies see the update the next time they open PyBI (checks run at most every 6 hours, or immediately with **Check for updates**).

Pre-releases: tag `v1.4.0rc1` or `v1.4.0-beta.1`. Those become GitHub pre-releases and reach only users with `include_prereleases=1` in `settings.ini`.

Test build without releasing: **Actions → Windows installer → Run workflow**. Download the installer from the run's artifacts.

Permanent download link for your README or website:
`https://github.com/<owner>/<repo>/releases/latest/download/PyBI-Setup.exe`

## How the app starts PyBI

The launcher runs the bundled Python in the user's workspace (`Documents\PyBI`, where `.pybi` projects are saved) with the command set in `launcher/launcher.json`:

```json
"command": ["{python}", "-m", "pybi", "run", "--port", "{port}", "--no-browser"]
```

Placeholders are `{python}`, `{port}`, `{host}` and `{workspace}`. `{port}` is 8050, or the next free port if 8050 is taken. The launcher opens the browser itself when the studio answers. To change the default, edit this line, for example add `"--private"` to turn off the network view link, or `"--demo"` to open the sample dashboard.

**Network sharing and the firewall.** `pybi run` listens on all network interfaces so the **Network (view)** link works on Wi-Fi or a LAN. The first time it starts, Windows Firewall may ask whether PyBI's Python may use the network. **Allow** enables sharing. **Cancel** still leaves PyBI working normally on the user's own computer.

## Building on your own PC

Requirements: Windows 10/11 x64, Python 3.11 on PATH, PowerShell 7 (`pwsh`). Inno Setup is installed automatically through Chocolatey if it is missing.

```powershell
pwsh .\installer\scripts\build.ps1 -Version 1.3.0 -Repo Rafay183/pybi
# → dist\PyBI-Setup.exe and dist\PyBI-Setup.exe.sha256
```

Run the launcher from source while developing:

```powershell
cd installer\launcher
$env:PYBI_PYTHON = (Get-Command python).Source   # use your dev Python instead of the bundled one
python main.py
python -m pytest -q tests
```

## Code signing (removes the SmartScreen warning)

Unsigned installers show *"Windows protected your PC"* the first few times. Users click **More info → Run anyway**. To sign, add two repository secrets:

* `WINDOWS_CERT_PFX_BASE64`: your code-signing `.pfx`, base64 encoded (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`)
* `WINDOWS_CERT_PASSWORD`: its password

The workflow then signs both `PyBI.exe` and `PyBI-Setup.exe`. Without the secrets it skips signing.

## Where things live on a user's PC

| Path | What |
|---|---|
| `%LOCALAPPDATA%\Programs\PyBI\` | app, private Python (`runtime\`), `launcher.json`, `settings.ini` |
| `%LOCALAPPDATA%\PyBI\logs\` | `launcher.log`, `server.log`, `update-install.log` |
| `%LOCALAPPDATA%\PyBI\state.json` | last update check, skipped version, auto-update choice |
| `Documents\PyBI\` | the user's dashboards; never deleted, not even by uninstall |

## Command line

```
PyBI.exe                  start PyBI and open the browser
PyBI.exe --no-browser     start without opening a tab
PyBI.exe --check-updates  print update status
PyBI.exe --version        print the installed version
PyBI-Setup.exe /SILENT    unattended install (IT/lab deployment); add /DIR="D:\PyBI" to choose a folder
```
