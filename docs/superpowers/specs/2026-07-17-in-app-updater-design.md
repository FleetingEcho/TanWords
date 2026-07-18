# 应用内自动更新(In-App Updater)设计

日期:2026-07-17
状态:已确认

## 目标

在 TanWords(Tauri 2 + React)中加入应用内更新能力:

- 启动后静默检查 GitHub Release 是否有新版本,有则在侧栏 upgrade 图标上亮红点。
- 点击图标弹出 Popover 面板:显示当前版本 → 新版本、release notes、「下载并安装」按钮。
- 下载在应用内完成并显示进度,安装(验签后替换)后询问用户是否重启生效。
- 配套改造发布流程:本地脚本产出签名产物和 `latest.json` 并上传 GitHub Release。

## 已确认的决策

| 决策点 | 结论 |
| --- | --- |
| 更新方式 | 完整自动更新,官方 `tauri-plugin-updater` |
| 发布流程 | 本地脚本(不上 CI),`gh` CLI 上传 |
| 检查时机 | 启动后 ~5s 静默检查一次 + 图标点击手动检查 |
| UI 形态 | 侧栏底部 icon button + radix Popover 面板 |

## 架构

```
┌─ 前端 (React) ─────────────────┐      ┌─ Rust (Tauri) ──────────────┐
│ updaterStore (zustand)         │      │ tauri-plugin-updater        │
│  idle→checking→available→      │─────▶│   check() / download /      │
│  downloading(％)→ready→restart │ ipc  │   install (验签后替换)       │
│ UpdateButton + Popover 面板    │      │ tauri-plugin-process        │
│ 启动后 ~5s 静默 check 一次      │      │   relaunch()                │
└────────────────────────────────┘      └──────────────┬──────────────┘
                                                       │ https
                              GitHub Release: latest.json + 签名产物
```

- 检查不走 GitHub API(避免速率限制),直接拉固定地址
  `https://github.com/FleetingEcho/TanWords/releases/latest/download/latest.json`,
  由 updater 插件比对版本号并校验 minisign 签名。
- 版本比较、下载、验签、替换安装全部由插件完成,前端只驱动状态机和 UI。

### Rust 端改动

- `Cargo.toml` 增加 `tauri-plugin-updater`、`tauri-plugin-process`,在 `lib.rs` 注册。
- `capabilities/default.json` 增加 `updater:default`、`process:allow-restart`。
- `tauri.conf.json`:
  - `plugins.updater`:`pubkey`(minisign 公钥)+ `endpoints`(上述 latest.json 地址)。
  - `bundle.createUpdaterArtifacts: true`(macOS 产出 `.app.tar.gz + .sig`,AppImage 产出 `.sig`)。

### 前端改动

- `updaterStore`(zustand)状态机:
  `idle → checking → available | upToDate | error`;`available → downloading(progress) → ready`。
  持有:当前版本、新版本号、release notes、下载进度、错误信息。
- `UpdateButton` 组件:侧栏底部 icon button(设置按钮附近),有新版时显示红点徽标;
  点击弹出 Popover 面板。
- App 挂载后延迟 ~5s 静默检查一次;失败完全静默。

## UI 交互

```
 sidebar                Popover 面板(点击图标弹出)
┌──────┐               ┌────────────────────────────┐
│ ...  │               │  TanWords 0.1.2 → 0.1.3    │
│ nav  │               │  ────────────────────────  │
│      │               │  · release notes(可滚动)  │
├──────┤               │  ────────────────────────  │
│ ⬆●  │ ← 红点=有新版  │  [   下载并安装   ]        │
│ ⚙   │               └────────────────────────────┘
└──────┘
   下载中: 按钮变进度条  ▓▓▓▓▓░░░░ 62%
   完成后: [ 重启以完成更新 ] (点击 relaunch;不重启则下次启动生效)
   无新版: 「已是最新版本」+ 手动「检查更新」按钮
```

- 手动点击图标打开面板时,若尚未检查过则现场检查(spinner)。
- 所有文案走 `useT()` i18n,新增 updater 命名空间的翻译条目。

## 错误处理

- 启动静默检查失败(断网等):静默忽略,不弹提示。
- 手动检查失败:面板内显示错误 + 重试按钮。
- 下载中断 / 签名校验失败:面板显示错误,状态回 `available` 可重试。
- Linux deb/rpm 安装:updater 仅支持 AppImage,检测到不支持时面板降级为
  提示 + 打开 release 页面的链接。macOS 用 `.app.tar.gz` 替换 app bundle,正常支持。

## 发布流程改造(本地脚本)

一次性准备:

- `tauri signer generate` 生成密钥对;私钥留在本地(构建时经
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 注入),
  公钥写入 `tauri.conf.json`。私钥不入库。

新增 `scripts/release.sh`,每次发版:

1. 校验 `package.json` / `tauri.conf.json` / `Cargo.toml` 三处版本号一致;
2. `tauri build`(macOS universal dmg + `.app.tar.gz` + `.sig`;Linux 产物按现有方式
   构建后放入指定目录,含 AppImage + `.sig`);
3. 生成 `latest.json`:`version`、`notes`、`pub_date`、各平台
   (`darwin-universal`、`linux-x86_64`)的下载 URL 和 signature;
4. `gh release create vX.Y.Z` 上传 dmg、`.app.tar.gz`、`.sig`、AppImage、deb、rpm、`latest.json`。

## 测试与验证

- vitest:updaterStore 状态机转换;UpdateButton/面板各状态渲染
  (mock `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`)。
- 端到端:本地静态服务器伪装 endpoint(dev 构建允许覆盖 endpoint),
  用假的下一版本包走通 检查→下载→安装→重启;再用真实 release 验证一次。

## 不做的事(YAGNI)

- 不做定时轮询检查(仅启动一次 + 手动)。
- 不做增量/差量更新、灰度、多通道(beta/stable)。
- 不上 CI 自动构建(保持本地构建习惯)。
