# Rackbook · 星际舰队

**A hand-drawn, multi-server monitor and manager for Windows, macOS and Ubuntu.**
一个手绘画风的多服务器监控与管理工具，支持 Windows、macOS 和 Ubuntu。

每台服务器是一艘舰船，你是它的船员。Rackbook 通过 SSH 连接你的服务器（服务器端无需安装任何东西），用马克笔与铅笔的手绘风格画出资源、网络、磁盘、GPU 和 Docker 的状态。

Every server is a ship; you are its crew. Rackbook talks to your servers over plain SSH (nothing to install on them) and draws CPU, memory, network, disks, GPUs and Docker in a marker-and-pencil style.

## 功能 · Features

- **星图总览**：舰队按负载编队，舰船大小代表规模，尾焰代表 CPU 负载，护盾代表告警。
- **拆解图**：等距投影的机箱拆解，CPU、内存、GPU、网卡、磁盘逐件标注，点击查看历史曲线。
- **进程与服务**、**Docker 货舱**（容器启停、日志、镜像）、**文件舱**（浏览、上传下载、拖拽上传）。
- **可视化编辑器**：txt / yaml / json / .bashrc 等，语法高亮、结构大纲、远端语法校验、保存前冲突检查与备份。
- **控制台**与一键打开系统终端。
- **船员角色**：根据 sudo 权限分为「舰长」与「领航员」，同一服务器可切换账户。
- **密钥或密码登录**，密码保存在系统钥匙串（Windows 凭据管理器 / macOS 钥匙串 / Linux Secret Service）。
- **后台运行 + 托盘图标 + 可拖动悬浮窗**，悬浮窗内容可配置。
- **六种界面语言**：English · 日本語 · Español · 简体中文 · 繁體中文 · 한국어，统一手写字体（全部内置，离线可用）。

## 下载 · Download

在 [Releases](../../releases) 页面下载对应系统的安装包，或在 [Actions](../../actions) 中下载最新构建：

| 系统 | 文件 |
|---|---|
| Windows 10 / 11 x64 | `Rackbook_x.y.z_x64-setup.exe` 或 `.msi` |
| macOS 10.15+（Intel 与 Apple 芯片） | `Rackbook_x.y.z_universal.dmg` |
| Ubuntu 22.04+ x64 | `rackbook_x.y.z_amd64.deb` 或 `.AppImage` |

> macOS 安装包没有签名。首次打开如提示“已损坏”或“无法验证开发者”，在终端运行
> `xattr -cr /Applications/Rackbook.app`，或在 Finder 中右键 → 打开。

## 从源码构建 · Build from source

需要 [Rust](https://rustup.rs)（stable）与 Node.js 20+。

```bash
npm install
npx tauri dev        # 开发运行
npx tauri build      # 生成当前系统的安装包
```

- **Windows**：需要 MSVC 构建工具与 WebView2（Win10/11 一般已自带）。
- **Ubuntu**：
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev patchelf
  ```
- **macOS**：需要 Xcode Command Line Tools。通用包：`rustup target add aarch64-apple-darwin x86_64-apple-darwin && npx tauri build --target universal-apple-darwin`。

只想看界面：在 `ui/` 下起任意静态服务器（如 `python3 -m http.server`）打开 `index.html`，会自动使用内置的模拟舰队。

推送 `v*` 标签（如 `v2.1.0`）会让 GitHub Actions 在三个系统上构建，并创建一个草稿 Release。

## 目录 · Layout

```
src-tauri/            Rust 后端：SSH（russh）、采集脚本、钥匙串、托盘与窗口
ui/                   前端：原生 JS + Canvas 手绘绘图库，无构建步骤
  js/i18n.js          运行时翻译；词典在 js/i18n-dict.js
  fonts/              内置字体（SIL OFL，见 FONTS-LICENSE.md）
legacy/macos-swiftui/ 早期的原生 SwiftUI macOS 版本（1.x），保留作参考，不再随新功能更新
```

## 数据与安全 · Data & security

- 服务器只需要标准 SSH 访问，采集通过读取 `/proc` 完成；GPU 信息来自 `nvidia-smi` 或 amdgpu sysfs。
- 主机指纹首次连接时信任并记录（TOFU），之后变化会拒绝连接。
- 密码、密钥口令、sudo 密码只存于本机系统钥匙串；钥匙串不可用时退回到应用数据目录中权限为 600 的文件。

## 许可 · License

代码采用 [MIT](LICENSE) 许可。内置字体采用 SIL Open Font License 1.1，见 [ui/fonts/FONTS-LICENSE.md](ui/fonts/FONTS-LICENSE.md)。
