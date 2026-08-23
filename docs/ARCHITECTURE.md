# XT Music 架构

## 进程划分

### Electron 主进程

主进程是安全边界，负责：

- FNID 发现和链路探测
- 飞牛账号登录
- Token、访问安全码和设备 ID
- Windows DPAPI 加密
- 所有飞牛 API 请求
- 音频、封面、HLS 自定义协议
- 系统托盘、窗口和退出行为
- IPC 白名单

### Preload

Preload 通过 `contextBridge` 只暴露固定函数。不存在任意 URL 请求、任意文件访问、Shell 命令或通用 IPC 调用。

所有 `ipcRenderer.invoke` 返回都经过统一错误封装。

### Renderer

渲染层只负责界面和播放器状态：

- 原生 DOM 页面
- CSS 视觉系统
- 虚拟歌曲表
- `<audio>` 和 HLS.js
- Media Session
- 队列、歌词与快捷键

渲染层可以看到歌曲元数据，但看不到 Token、访问安全码和加密文件内容。

## 性能

### 虚拟歌曲列表

`VirtualTrackTable` 使用固定行高和 overscan。无论音乐库有几千还是几万首歌曲，DOM 中通常只存在几十行。

### 分批分页

首个分页用于得到 `total`，随后每批并发四页。界面请求使用序列号抛弃已过期结果，避免快速切换页面时旧请求覆盖新页面。

### 媒体流

`xtmusic://stream` 将 Range 请求转发给 NAS。主进程返回 Node 流转换后的 Web `ReadableStream`，不会先把整首歌曲读入内存。

### 轻量渲染

没有虚拟 DOM，也没有运行时 CSS-in-JS。页面模板只在路由变化时重建；播放器进度只更新固定 DOM 节点。

## 数据存储

`accounts.json`：

- 非敏感账号概要明文保存
- Token 与访问安全码放在 `secret` 字段，内容由 `safeStorage.encryptString` 加密
- 不保存密码

`settings.json`：

- 主题
- 音量
- 循环方式
- 窗口位置
- 关闭到托盘

播放队列保存在 renderer localStorage，其中只有歌曲元数据，没有凭据。

## 兼容性策略

飞牛音乐 API 不是公开稳定协议，所以：

- API 响应保留原始对象，不强行裁剪字段
- 界面读取 `track.coverId || track.album.coverId` 等兼容字段
- 网络层提供业务码、HTTP 码和网络错误的统一分类
- 协议路径集中在 `feiniu-client.js`
- 签名、候选地址和 HLS 重写具备单元测试
