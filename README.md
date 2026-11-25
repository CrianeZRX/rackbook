<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="112" alt="Rackbook icon">
</p>

<h1 align="center">Rackbook</h1>

<p align="center"><b>A hand-drawn control room for your servers.</b><br>
Monitor and manage a whole fleet over plain SSH, drawn in marker and pencil.<br>
Windows · macOS · Ubuntu.</p>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/English-c8372f?style=for-the-badge" alt="English"></a>
  <a href="docs/i18n/README.ja.md"><img src="https://img.shields.io/badge/日本語-231e16?style=for-the-badge" alt="日本語"></a>
  <a href="docs/i18n/README.es.md"><img src="https://img.shields.io/badge/Español-231e16?style=for-the-badge" alt="Español"></a>
  <a href="docs/i18n/README.zh-CN.md"><img src="https://img.shields.io/badge/简体中文-231e16?style=for-the-badge" alt="简体中文"></a>
  <a href="docs/i18n/README.zh-TW.md"><img src="https://img.shields.io/badge/繁體中文-231e16?style=for-the-badge" alt="繁體中文"></a>
  <a href="docs/i18n/README.ko.md"><img src="https://img.shields.io/badge/한국어-231e16?style=for-the-badge" alt="한국어"></a>
</p>

<p align="center">
  <a href="https://github.com/CrianeZRX/rackbook/releases/latest"><img src="https://img.shields.io/github/v/release/CrianeZRX/rackbook?style=flat-square&color=c8372f&label=download" alt="Latest release"></a>
  <a href="https://github.com/CrianeZRX/rackbook/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/CrianeZRX/rackbook/build.yml?style=flat-square&label=build" alt="Build"></a>
  <img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Ubuntu-5d6c9c?style=flat-square" alt="Platforms">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3f9e6b?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">
  <img src="docs/media/teardown.gif" width="860" alt="A 2U server taken apart: lid off, workload up to 90 %, then CPU, memory, GPU, disks and power pulled out one by one">
</p>

<p align="center">
  <a href="https://crianezrx.github.io/rackbook/teardown/"><b>▶ Take the server apart yourself</b></a> (interactive 3D)
  &nbsp;·&nbsp;
  <a href="https://crianezrx.github.io/rackbook/demo/"><b>▶ Try Rackbook in your browser</b></a> (an imaginary fleet)
  &nbsp;·&nbsp;
  <a href="docs/media/teardown.mp4">Full film with sound</a>
</p>

---

## Why Rackbook

Most server dashboards are walls of identical grey charts. Rackbook draws each server as a ship in a star fleet and as a machine you can take apart, so you can tell at a glance which one is straining and why.

- **Nothing to install on your servers.** Rackbook talks plain SSH and reads `/proc`. If you can `ssh` in, you can watch it.
- **See it, then fix it.** Processes, services, Docker containers, files and config are all in the same window. You can restart, stop, edit and upload without opening a terminal.
- **Safe by default.** Every account is either a *captain* (has sudo) or a *navigator* (read and own processes only), decided by what sudo really allows. Passwords stay in your system keychain.
- **Stays out of the way.** Close the window and it keeps watch from the tray, with an optional floating panel that only appears when you're working in something else.

## A tour

<table>
<tr>
<td width="50%"><img src="docs/screenshots/fleet.png" alt="Star chart"><br><b>Star chart.</b> Each server is a ship. Size is its class (cores and memory), the exhaust is CPU load, a dashed shield means it needs attention, and blue dots are network traffic. Docked ships are disconnected.</td>
<td width="50%"><img src="docs/screenshots/teardown.png" alt="Teardown"><br><b>Teardown.</b> An isometric exploded view of the machine: CPU with one cell per core, memory, GPU, network, disks, fans. Click a part for its history.</td>
</tr>
<tr>
<td><img src="docs/screenshots/docker.png" alt="Docker"><br><b>Docker cargo hold.</b> Containers with live CPU, memory and network, plus start, stop, restart, logs and images. It uses sudo automatically when your account isn't in the <code>docker</code> group.</td>
<td><img src="docs/screenshots/editor.png" alt="Editor"><br><b>Visual editor.</b> YAML, JSON, shell rc files, INI and text, with syntax colouring, a clickable structure outline and a server-side syntax check. It checks for conflicts and makes a backup before saving.</td>
</tr>
<tr>
<td><img src="docs/screenshots/processes.png" alt="Processes"><br><b>Processes & services.</b> Sort, filter and signal processes, and start, stop or restart systemd services.</td>
<td><img src="docs/screenshots/crew.png" alt="Crew"><br><b>Crew & roles.</b> Switch the account you board with, see every user on the server, and promote or demote crew (captains only).</td>
</tr>
</table>

<p align="center">
  <img src="docs/screenshots/float.png" width="260" alt="Floating panel"><br>
  <sub>The floating panel: drag it anywhere, double-click a ship to board it, right-click for options. You choose which metrics and ships it shows.</sub>
</p>

### Six languages, one hand

English · 日本語 · Español · 简体中文 · 繁體中文 · 한국어. Switch languages from the sidebar or Settings, and the tray menu follows. Every script is drawn in a matching handwritten face (Gaegu, Yomogi, ZCOOL KuaiLe and LXGW WenKai TC). All the fonts ship inside the app, so it works offline. Your own server names, paths and command output are never translated.

<p align="center"><img src="docs/screenshots/languages.png" alt="The fleet view in six languages"></p>

## Download

Grab the installer for your system from **[Releases](https://github.com/CrianeZRX/rackbook/releases/latest)**:

| System | File |
|---|---|
| Windows 10 / 11 (x64) | `Rackbook_<version>_x64-setup.exe`, or the `.msi` |
| macOS 10.15+ (Intel & Apple silicon) | `Rackbook_<version>_universal.dmg` |
| Ubuntu 22.04+ (x64) | `rackbook_<version>_amd64.deb`, or the `.AppImage` |

> **macOS:** the app isn't notarised yet. If macOS says it's damaged or can't be opened, run
> `xattr -cr /Applications/Rackbook.app` once, or right-click the app and choose **Open**.
>
> **Ubuntu:** `sudo apt install ./rackbook_*.deb`. Passwords are kept in GNOME Keyring or KWallet.

## Getting started

1. Click **+ New ship** and enter the host, port and user. Or click **Import from config…** to pick servers from your `~/.ssh/config` (and PuTTY sessions on Windows) in one go.
2. Choose **Key** (Rackbook tries your usual `~/.ssh` keys if you leave the path empty) or **Password**.
3. Rackbook checks what `sudo` allows and makes the account a **captain** or a **navigator**. Captains can store a sudo password so they can act without being asked each time.
4. Board the ship (click it) to open its teardown, processes, Docker, files, console and crew.

On first contact, a host's SSH fingerprint is trusted and remembered (trust on first use). If it changes later, Rackbook refuses to connect.

## How it works

```mermaid
flowchart LR
  UI["ui/ · hand-drawn web UI<br>(canvas, no framework)"] -- Tauri commands --> Core["src-tauri/ · Rust core"]
  Core -- "russh · one connection per server,<br>one channel per command" --> S1[(server A)]
  Core --> S2[(server B)]
  Core --> K["OS keychain<br>Credential Manager · Keychain · Secret Service"]
```

- One collector script reads `/proc`, `df`, `ip` and, when present, `nvidia-smi` or amdgpu sysfs and `docker stats`. It runs every few seconds over an existing connection.
- Each command opens its own channel, so a slow `docker logs` never blocks the gauges.
- Uploads and downloads stream through `cat` and `tar`, so there's no SFTP subsystem to configure.

## Build from source

You need [Rust](https://rustup.rs) (stable) and Node.js 20+.

```bash
npm install
npx tauri dev       # run it
npx tauri build     # make an installer for this system
```

- **Ubuntu:** `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev patchelf`
- **macOS universal:** `rustup target add aarch64-apple-darwin x86_64-apple-darwin && npx tauri build --target universal-apple-darwin`
- **Only the UI:** serve `ui/` with any static server (`python3 -m http.server`) and open `index.html`. Without the Rust core it runs on a built-in imaginary fleet.

Pushing a `v*` tag builds all three platforms in GitHub Actions and attaches the installers to a release.

## The teardown film

The opening film and the [interactive 3D page](https://crianezrx.github.io/rackbook/teardown/) are built from code in [`showcase/`](showcase/) with the [teardown](https://github.com/elvarofficial/teardown) kit. The machine is a 2U, two-socket, 12-bay server with real part dimensions. One input, the workload, drives everything: CPU and GPU power, the fan speed needed to keep a 20 °F rise front to back (CFM = 3.16 × W / ΔT), heatsink temperatures with their thermal lag, wall power through a 94 % PSU, disk and network traffic, and the LEDs. The power and thermal figures are an illustrative model built from the parts' ratings, not measurements of one machine.

## Repository layout

```
src-tauri/            Rust core: SSH, collector, keychain, tray and windows
ui/                   The app's front end: plain JS + a canvas drawing kit, no build step
  js/i18n.js          Runtime translation (dictionary in js/i18n-dict.js)
  fonts/              Bundled handwritten fonts (SIL OFL)
showcase/             The 3D teardown film and page (three.js)
docs/                 Screenshots, media and translated READMEs
legacy/macos-swiftui/ The original native SwiftUI macOS app (1.x), kept for reference
```

## Contributing

Issues and pull requests are welcome. Translations are especially welcome: every string lives in `ui/js/i18n-dict.js` as `"简体中文 source": [en, ja, es, ko, zh-TW]`.

## License

[MIT](LICENSE). The bundled fonts are under the SIL Open Font License 1.1 (see [ui/fonts/FONTS-LICENSE.md](ui/fonts/FONTS-LICENSE.md)). The showcase uses the MIT-licensed [teardown](https://github.com/elvarofficial/teardown) kit and [three.js](https://threejs.org).
