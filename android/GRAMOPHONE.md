# XT Music Android 0.1.0-alpha04 · 留声机播放页

## 本次改动

- 播放页改为原生黑胶唱片与唱针，唱片中心显示当前歌曲封面；约 24 秒旋转一周。
- 暂停时唱片停在当前角度，唱针抬起；继续播放时从当前角度接着转动。
- 点击唱片进入完整歌词区域，顶部“唱片”按钮、歌词区“返回唱片”或系统返回键回到唱片。
- 保留 XT Music 的深色背景、紫色渐变、圆角控件、收藏、歌手/专辑跳转、播放队列和逐句歌词跳转。
- 歌词页与唱片页共享同一播放状态；切换页面不会重新播放歌曲。
- 页面隐藏、应用退到后台或系统关闭动画时停止唱片动画；切换歌曲和无歌曲时清理旧显示。
- 修复旧歌曲歌词请求（包括失败响应）覆盖新歌曲，以及收藏响应误替换当前歌曲的问题。
- 保留系统栏安全边距；小屏、横屏和大字体可滚动，不强行裁切控件。

## 源码基线

安卓目录来自 `feat/artist-navigation-tabs-android-20260901` 的 `20ecc7ad84ebfe347eb07876f6e54556bd05f594`，保留该版本歌手页和队列修复。
以默认主分支 `master` 为基础添加安卓目录，不替换桌面端目录，也不强推或改写历史。
界面使用 Kotlin + Android 平台 Views/Canvas，未添加 WebView、运行时图片依赖或新的播放引擎。

## 安装说明

本次沿用项目原有 **debug 签名测试包**，发布为 GitHub **Pre-release**，不是用于应用商店的正式签名版本。
包名 `com.pkxutao.xtmusic.android.debug`，versionCode 4，最低 Android 8.0 / API 26。
不同 CI 构建的调试签名可能不同：旧版本覆盖安装可能提示签名不一致。此时不要直接清除数据；先确认已有账号配置/离线数据可恢复，再决定是否卸载旧测试包。
APK 同时提供 SHA-256、签名验证和构建信息。未配置正式发布签名，不声称可覆盖所有旧测试包。

## 自动验证范围

发布工作流会执行单元测试、Android Lint、APK 构建和签名/ZIP 校验，并在 Android 模拟器运行唱片旋转/暂停恢复、页面切换和返回、后台停转、页面重建、无歌曲等 UI 测试。
模拟器截图使用测试歌曲和程序绘制的测试封面，不包含用户账号或真实服务器数据。
这些是自动化界面和状态测试；真实手机的网络播放、蓝牙、锁屏和耗电表现仍需设备验收，不能把模拟器测试视为已完成真机听音验证。

## 构建

JDK 17、Gradle 8.10.2、Android SDK 35：

```sh
gradle -p android testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
gradle -p android connectedDebugAndroidTest
```

`.github/workflows/android-gramophone.yml` 在功能分支先验证，主分支验证通过后创建独立的 `android-v0.1.0-alpha04` 预发布；不覆盖已有桌面 Release 的资产。
