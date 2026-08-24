# Ubuntu 支持

XT Music 的 Ubuntu 版本与 Windows 版本共用飞牛协议层、音乐库页面、虚拟列表、播放器、歌词和账号逻辑。Linux 仅替换窗口、托盘、密钥环和安装包适配，不维护独立业务分支。

## 支持范围

- Ubuntu 22.04 LTS、24.04 LTS 及更新版本
- x86_64：GitHub Actions 自动构建 `.deb` 与 `.AppImage`
- ARM64：提供构建脚本，适合 Ubuntu ARM64、Jetson 等环境；需在目标架构上完成实机验收
- GNOME X11、GNOME Wayland
- KDE Plasma 原则上可用，系统托盘和密钥环行为需按桌面环境验证

## 构建

要求 Node.js 22+、npm。

```bash
npm install
npm run dist:ubuntu
```

x86_64 产物位于 `release/`：

```text
XT-Music-<version>-ubuntu-x86_64.AppImage
XT-Music-<version>-ubuntu-amd64.deb
```

ARM64 构建：

```bash
npm install
npm run dist:ubuntu:arm64
```

仅生成解包目录用于调试：

```bash
npm run pack:ubuntu
```

## 安装与运行

安装 `.deb`：

```bash
sudo apt install ./XT-Music-*.deb
```

运行 AppImage：

```bash
chmod +x XT-Music-*.AppImage
./XT-Music-*.AppImage
```

AppImage 使用 electron-builder 的静态 `1.0.3` runtime，不依赖已经弃用的 FUSE2。该 runtime 会检测系统是否支持非特权用户命名空间，仅在系统无法使用 Chromium 沙箱时才回退到 `--no-sandbox`。

## 构建工具链安全

- Electron 固定为当前受支持的 `43.4.1`
- electron-builder 固定为已修复 AppImage 搜索路径漏洞的 `26.15.7`
- AppImage toolset 固定为静态 runtime `1.0.3`
- 静态检查会阻止 electron-builder 降级到 `26.15.0` 以下，也会阻止恢复旧 AppImage runtime

## 密钥环与账号安全

Linux 上 Electron `safeStorage` 会尝试使用 GNOME Keyring/libsecret 或 KDE KWallet。

XT Music 会检查实际后端：

- `gnome_libsecret`、`kwallet`、`kwallet5`、`kwallet6`：允许加密保存 Token 和访问安全码
- `basic_text`、`unknown` 或安全存储不可用：拒绝把 Token 写入磁盘，仅保存在当前进程内存中
- 原始飞牛密码在任何平台都不会持久化

Ubuntu GNOME 推荐安装并启用：

```bash
sudo apt install gnome-keyring libsecret-1-0
```

若从极简窗口管理器、无图形会话、容器或某些远程桌面环境启动，密钥环可能不会自动解锁。此时应用仍可登录，但关闭后需要重新输入密码。

## Wayland

Wayland 不允许普通应用可靠恢复窗口绝对坐标。XT Music 在 Wayland 下只恢复窗口宽高，让窗口管理器决定位置；在 X11 下继续恢复 `x/y`。

Ubuntu 使用系统原生窗口边框和标题栏，应用内部仍保留搜索、前进后退和账号工具栏。这样可获得更稳定的拖动、缩放、最大化和多显示器行为。

## 系统托盘

Linux 使用 Electron StatusNotifierItem/GtkStatusIcon。托盘激活事件在不同桌面环境中可能由单击或双击触发，XT Music 监听 Linux 的标准 `click` 激活事件。

如果桌面环境不支持托盘，应用会继续正常运行，并自动放弃“关闭到托盘”：关闭窗口将退出程序。

## CI

`.github/workflows/ubuntu-build.yml` 在 `ubuntu-24.04` 上执行：

1. 安装固定版本依赖
2. 静态安全检查
3. JavaScript 语法检查
4. 协议、平台和打包安全单元测试
5. 构建 AppImage 和 deb
6. 校验产物存在并输出 SHA-256
7. 上传 `XT-Music-Ubuntu-x64` Artifact
