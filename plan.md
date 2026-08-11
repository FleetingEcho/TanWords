# TanWords 广告过滤实施计划 (v2)

> **目标**：Electron 端和 Web 端都具备可用的广告过滤；YouTube 在两端都不播放广告。
>
> v2 依据一轮外部技术审核修订。措辞、缓存设计、阶段三范围、执行顺序均有调整；
> 同时纠正了审核中一处关于 `resource-assembler` 的建议（见 T1.2）。

---

## 0. 现状诊断

现有实现（架子是对的，但缺三块关键能力）：

| 组件 | 文件 | 状态 |
|---|---|---|
| 共享过滤引擎（Brave `adblock` crate 0.12.6） | `app/core/src/adblock.rs` | 只加载 EasyList + EasyPrivacy；**未加载 resource library** |
| 桌面网络拦截 | `app/electron/main/browserPanel.ts:159` `onBeforeRequest` → sidecar RPC | 工作正常 |
| 桌面 cosmetic 注入 | `browserPanel.ts:223` `registerCosmeticPreload` | **只有一段写死的 YouTube 脚本**，从不调用 `adblock_cosmetics` |
| Web 代理 | `web/server/src/browser_proxy.rs` | 已接通（`BrowserPage.tsx:243`），但只能处理静态站点 |

### 四个根因

1. **引擎没有 resource library。** `adblock.rs:255` 只有 `Engine::from_filter_set(filter_set, true)`，从未调用 `use_resources()`。
   - 后果 A：`url_cosmetic_resources()` 返回的 `injected_script` **永远是空串** → 所有 `##+js(...)` scriptlet 规则都是哑弹。
   - 后果 B：`$redirect` / `$redirect-rule` 无法解析 → `decide()` 里的 `BlockDecision::Redirect` 分支是死代码。

2. **列表里没有 YouTube 规则。** EasyList + EasyPrivacy 对 YouTube 视频广告零覆盖。uBO 能挡靠的是它自己的列表（`uAssets/filters/filters.txt`、尤其 `quick-fixes.txt`），且全是 scriptlet 规则——正好被根因 1 卡死。

3. **缓存永不过期。** `adblock.rs:262` `load_cached()` 没有 TTL，列表下载一次就永久沿用。`quick-fixes.txt` 不刷新等于不存在。

4. **手写 json-prune 有洞。** `YOUTUBE_SCRIPT` 的注释声称拦截 `ytInitialPlayerResponse`，但代码里没有。冷加载第一个视频时 YouTube 用内联 `var ytInitialPlayerResponse = {...}` 对象字面量注入，不经过 `JSON.parse`，第一个视频的广告照放。

### 顺带发现的小 bug

- `browser_proxy.rs:260` 把 `{display:none!important}` 又拼了一遍，而 `cosmetics_for()`（`adblock.rs:315`）已经拼过 → 产出 `sel{...}{...}`，尾块是无效 CSS。
- `app/src/components/Browser/useWebBrowser.ts:13` 的注释「ad-block shield 是 desktop-only」已过时，代理早就接上了。

---

## 1. 总体策略

```
Layer 0  共享过滤引擎（Rust, adblock crate）          ← 阶段一
Layer 1  网络层拦截  desktop: webRequest / web: 代理   ← 已有，阶段一受益
Layer 2  Cosmetic + Scriptlet 注入                    ← 阶段一 + 阶段二
Layer 3  Web 代理增强                                 ← 阶段三（范围已大幅收窄）

旁路     YouTube 专用通道：服务端提取 + 自有播放器        ← 阶段四
```

### 核心判断：YouTube 不走过滤，走旁路

YouTube 的贴片/中插广告与正片走**同一个 `googlevideo.com` CDN、同一个 `/youtubei/v1/player` 响应**。网络层拦不了。uBO 的 `json-prune` 是客户端删 `adPlacements`——一场持续的猫鼠游戏，uBO 团队每隔几周更新 `quick-fixes.txt`，且近年 YouTube 的服务端插播（SSAI）连 uBO 都会漏。

阶段四不运行 YouTube 官方播放器，而是服务端提取媒体流、前端自有播放器直接播：

```
videoId → Extractor → PO Token/BotGuard → format URL → googlevideo → TanWords Player
```

官方播放器的广告 UI / ad placement / client-side ad logic 从头到尾不进入我们的播放链路。

**准确表述**（v1 措辞已修正）：这是**绕开官方广告播放链路的高可靠方案，不依赖 YouTube Web 广告过滤规则**。它**不是**「保证永久零广告」——故障模式只是从「广告挡不住」转移到了「取不到可播放流」。后者正是 T4.0 要先验证的东西。

**副产品**：字幕轨（含自动生成字幕）直接落到我们手里，可以喂给 TanWords 的句式学习流程。见第 5 节——这可能比去广告本身价值更高。

---

## T4.0 前置闸门：yt-dlp + PO Token 可行性验证 🔴

**这是整个计划的第一件事，先于所有编码。**

背景：YouTube 自 2024 起持续加强 PO Token 强制。`web`/`mweb` 等客户端的部分 GVS 流和字幕请求需要 PO Token，且 token 可能与 video ID 绑定。yt-dlp 官方现在推荐使用 PO Token provider，而非假设拿一次 token 就长期有效——且这套 enforcement 仍在变化。

**这不是「以后可能遇到的风险」，是能不能开工的前提。**

### 验证清单

用最新版 yt-dlp + PO Token provider（如 `bgutil-ytdlp-pot-provider`），在**目标部署环境**（不是本机开发机——服务器 IP 段的待遇可能不同）跑：

- [ ] 随机 30–50 个视频，取流成功率
- [ ] 清晰度：144p / 720p / 1080p 各自可播
- [ ] 字幕：人工字幕 + 自动生成字幕，中英双轨
- [ ] seek：拖动进度条（Range）正常
- [ ] 长视频（>1h）：播到后段流是否仍有效
- [ ] Shorts
- [ ] age-restricted / music / embed-restricted 三类分别测
- [ ] 连续运行 24h，观察成功率是否衰减（IP 信誉/限流）

### 通过标准

成功率与稳定性达到你能接受的水平，且 PO Token provider 的部署成本可接受。

**T4.0 不通过 → 阶段四不启动**，YouTube 退回「阶段一/二 提供的 uBO 同等水平过滤」（对抗式，非零广告）。届时重新决策。

> 不要先写 Shaka Player、Range Proxy、DASH MPD，最后才发现最底层的取流在生产环境不稳定。

---

## 阶段一：升级共享引擎（两端同时受益）

改动集中在 `app/core/src/adblock.rs`。

### T1.1 加载 uBO 自己的过滤列表

替换 `LIST_URLS`（`adblock.rs:49`）：

```rust
const LIST_URLS: &[&str] = &[
    "https://easylist.to/easylist/easylist.txt",
    "https://easylist.to/easyprivacy/easyprivacy.txt",
    // uBO 本体列表 —— YouTube / 反反广告规则全在这里
    "https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt",
    "https://ublockorigin.github.io/uAssetsCDN/filters/quick-fixes.min.txt",
    "https://ublockorigin.github.io/uAssetsCDN/filters/unbreak.min.txt",
    "https://ublockorigin.github.io/uAssetsCDN/filters/privacy.min.txt",
    "https://ublockorigin.github.io/uAssetsCDN/filters/badware.min.txt",
];
```

同时把 `build_engine()` 里「任一列表失败就整体返回 None」（`adblock.rs:246` 的 `_ => return None`）改成**逐条容错**：单条拉不到就跳过并记日志，至少拿到一条就建引擎。当前的全有全无策略在弱网下等于功能整体失效。

### T1.2 加载 uBO 的 scriptlet resources ⭐ 最关键

做完这步，`res.injected_script` 才会返回真实的 `json-prune` / `set-constant` 实现。

**⚠️ 审核建议在此处需要修正。** 审核意见是「优先直接用 adblock-rust 的 `resource-assembler`，避免经过 Ghostery 一层」。已核对 adblock 0.12.6 源码，这个建议**对 scriptlet 那一半不成立**：

```
src/resources/resource_assembler.rs:293
    #[deprecated]
    pub fn assemble_scriptlet_resources(scriptlets_path: &Path) -> Vec<Resource>
```

其 doc comment 原文：

> Parses the **_old_** format of uBlock Origin templated scriptlet resources, **prior to** [uBO 2023 commit 18a84d2]. The newer format is intended to be imported as an ES module, making line-based parsing even more complex and error-prone. **Instead, it's recommended to transform them into `Resource`s using JS code.**

即：**scriptlet（`json-prune`、`set-constant`——YouTube 全靠这些）无法用 assembler 解析当前 uBO 格式，且该函数已废弃。Brave 上游自己的建议就是「用 JS 代码转换」。**

**正确做法：两半分开处理。**

| 资源类别 | 来源 | 手段 | 状态 |
|---|---|---|---|
| **redirect resources** | uAssets `web_accessible_resources/` + `redirect-resources.js` | `assemble_web_accessible_resources()`（未废弃） | ✅ 采纳审核建议 |
| **scriptlets** | uBO `src/js/resources/scriptlets.js`（ES module） | 自写 JS 构建步骤，或用 Ghostery 预生成 JSON | ⚠️ assembler 不可用 |

已验证的 API（0.12.6）：

```rust
// src/resources/resource_assembler.rs:267  (feature = "resource-assembler")
pub fn assemble_web_accessible_resources(dir: &Path, redirect_resources_path: &Path) -> Vec<Resource>

// src/resources/mod.rs:132 — Resource 有 Serialize + Deserialize，可序列化成 JSON bundle
// src/engine.rs:205
pub fn use_resources(&mut self, resources: impl IntoIterator<Item = Resource>)
```

**实施路径**：

1. **先解锁**：直接内置 Ghostery 预生成的 uBO resources JSON（已验证可访问：
   `https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json`），
   `serde_json::from_str::<Vec<Resource>>` → `engine.use_resources(...)`。最快拿到可工作的 scriptlet 注入。
2. **再去依赖**（可选，看漂移是否成问题）：写一个 `scripts/build-adblock-resources.mjs`，构建期做两件事：
   - 用 `assemble_web_accessible_resources` 处理 redirect resources
   - 用 JS 直接 import uBO 的 ES module `scriptlets.js`，转成 `Resource[]`
   - 合并输出单份 `resources.json`，随包发布

两条路径都产出同一份 JSON bundle，上层代码不变，所以第 1 步不是浪费。

**离线优先**：resource bundle 随包内置，启动零网络依赖。scriptlet 实现的变动频率远低于过滤规则，季度同步足够。

### T1.3 缓存加 TTL + 后台刷新

改 `load_cached()`（`adblock.rs:262`）：

- 缓存文件旁写 `.meta`，记录构建时间戳 + 列表 URL 集合的哈希（URL 集变了强制重建）。
- 启动时有缓存就**立刻用**（不阻塞首屏）；若超 24h，后台线程静默重拉，构建完成后**原子替换** worker 里的 engine。
- `engine_worker`（`adblock.rs:160`）当前把 engine 作为 `let` 绑定；改成可变 `Option<Engine>`，给 `WorkerMsg` 加 `Replace(Engine)` 变体由刷新任务投递。替换发生在 worker 线程内部，不破坏 `!Send` 约束。

> 注意：这里说的是**过滤规则列表**的缓存，与阶段四的**播放流**缓存是两套完全独立的东西（见 T4.2）。

### T1.4 删除手写的 YOUTUBE_SCRIPT

T1.2 完成后，`adblock.rs:274` 的 `YOUTUBE_SCRIPT` 常量和 `browserPanel.ts:228` 里那份复制品全部删掉，统一用引擎返回的 `injected_script`。以后 YouTube 改版跟着 uBO 列表走，我们不维护。

### T1.5 修 stylesheet 双重包装

统一约定：`CosmeticResources.stylesheet` **只含选择器列表**，不含 `{display:none!important}`。
- `adblock.rs:315` 去掉 `push_str("{display:none!important}")`
- `browser_proxy.rs:260` 保持现有包装
- 桌面端注入时（阶段二）按同样约定包装

### 阶段一验收

- [ ] 冷启动（无缓存、有网）后，`adblock_cosmetics` 对 `https://www.youtube.com/watch?v=...` 返回**非空** `script`
- [ ] 引擎缓存超 24h 后下次启动后台重建，重建期间浏览不受影响
- [ ] 断网冷启动：不 panic、不卡页面，全部 fail-open
- [ ] 普通站点横幅广告数量明显下降（对照关闭 shield）
- [ ] YouTube 达到 uBO 同等水平（**对抗式，非零广告**——零广告是阶段四的事）

---

## 阶段二：桌面端真正注入 cosmetic + scriptlet

目前 preload 是**静态文件**，只处理 YouTube，EasyList 的 `##` 隐藏规则在桌面端完全没生效。这正是 `adblock.rs:333` 注释里描述过、但从未实现的设计。

### T2.1 Preload 改为同步 IPC 取 cosmetics

Preload 运行在 isolated world（`sandbox: true`），但 `require('electron').ipcRenderer` 在沙箱 preload 中可用：

```js
const { ipcRenderer } = require('electron');
const c = ipcRenderer.sendSync('adblock:cosmetics', location.href);
if (c?.stylesheet) { /* 注入 <style> */ }
if (c?.script)     { /* 用 <script textContent> 注入 MAIN world */ }
```

MAIN world 注入沿用现有做法（`browserPanel.ts:214` 的注释已把原理写清楚，保留）。

### T2.2 Main 侧预热缓存，保证 sendSync 不阻塞

`sendSync` 阻塞渲染进程，**绝不能让它同步等一个 HTTP 往返**。

- `did-start-navigation` 时**提前**向 sidecar 请求该 URL 的 cosmetics，写入 `Map<url, CosmeticResources>`
- `ipcMain.on('adblock:cosmetics')` 只读 Map，命中即返回；**未命中立即返回空**（fail-open，绝不等待）
- 未命中时补一次异步 `executeJavaScript` 兜底注入——晚到的 CSS 隐藏仍有效（scriptlet 晚了就没用，但那时缓存基本已预热）
- 复用现有 LRU 淘汰模式（参考 `rememberDecision`，`browserPanel.ts:145`）

### T2.3 关闭 shield 时清理

`disableAdBlock()`（`browserPanel.ts:191`）已有 `unregisterPreloadScript` 逻辑，保持；额外清空 cosmetics 预热缓存。

### 阶段二验收

- [ ] 任意站点 DevTools 可见注入的 `<style>` 含 EasyList 选择器
- [ ] YouTube 页面 MAIN world 中 uBO scriptlet 已执行
- [ ] shield 开关即时生效，无残留
- [ ] 拔掉 sidecar 手测：`sendSync` 不阻塞页面加载

---

## 阶段三：Web 代理增强（范围已大幅收窄）

审核意见：这块最容易做成无底洞，建议大幅降级。**部分采纳** —— 砍掉昂贵的部分，保留便宜的部分。

### ❌ 砍掉：prototype patching shim

v1 计划里的以下内容**全部取消**：

- `import()` 动态导入 —— **技术上不可行**。它不是 `window` 上可 monkey-patch 的 API，specifier 解析在引擎层，不转译代码碰不到。v1 写错了。
- `HTMLElement.prototype.src/href` 统一 patch —— **不存在这个统一入口**。`src` 分散在 `HTMLImageElement` / `HTMLScriptElement` / `HTMLIFrameElement` / `HTMLMediaElement` / `HTMLSourceElement` / `HTMLEmbedElement` / `HTMLTrackElement` 各自 prototype 上，逐个 patch 面积大、易漏、随 HTML 规范演进持续腐化。
- `Worker` / `SharedWorker` / `WebSocket` / `EventSource` / `history` 全家桶 patch

理由：这是在慢慢造一个 mini-Ultraviolet。成本高、脆弱、且下面这一项能以远低的成本覆盖大部分同样场景。

### ✅ 保留：Service Worker 拦截（提升为主要手段）

**审核把 SW 和 prototype patching 一起归入「不建议做」，这一点我不同意——两者成本/收益差一个数量级。**

被代理的文档改写后是**同源**的，因此在代理 scope（`/api/browser/proxy`）下注册的 Service Worker 能拦截它发出的**全部** fetch，**不管 URL 是运行时怎么拼出来的**。这正是 prototype patching 想解决的问题，而 SW 在网络层一次性解决，不需要碰任何 JS API。

v1 把 SW 写成「shim 的兜底」，**顺序是反的**。正确定位：**SW 是主要手段，且是阶段三里唯一真正划算的一块。**

- 实现量：一个 SW 脚本 + 注册逻辑
- 覆盖：运行时构造的 URL、动态 import 拉取的模块、Worker 内发起的请求——全部走 SW

### ✅ 保留：CSS 内 `url()` 改写

`lol_html` 已在改 HTML；对 `text/css` 响应体加一个 pass 改写 `url(...)` 和 `@import`。成本低。

### ⏸ 推迟：上游 cookie jar

per-user 服务端 cookie jar 是**安全敏感面**（须与 App Lock / 用户会话隔离绑定，且严禁跨用户共享）。在阶段三收窄后先不做，UI 上诚实标注「登录态站点不支持」。

### 阶段三验收

- [ ] 若干典型 SPA 在 web 端 Browser 页能渲染和导航（**best effort，不承诺任意站点**）
- [ ] 广告位在 web 端与桌面端表现一致
- [ ] **SSRF 防护（`resolve_public`，`browser_proxy.rs:76`）在 SW 新增路径上依然生效** —— 必须专项测试，新增入口最容易漏 guard

### 🔷 待你决策：阶段三的范围

审核者建议 web 端「best effort，不追求 SPA 兼容」。但你的原始要求是「**web 端必须实现 ad block**」。

砍到底的实际含义是：**web 端的广告过滤，只在当前代理能渲染出来的静态站点（新闻、博客、wiki）上有意义。**

三个选项：

| 选项 | 含义 | 成本 |
|---|---|---|
| **A（推荐）** | 只做 SW + CSS 改写。SPA 覆盖率大幅提升但不承诺任意站点 | 中低 |
| **B** | 完全砍掉阶段三，web 端广告过滤仅覆盖静态站点 | 零 |
| **C** | 做完整代理（含 prototype patching / cookie jar） | 高，且是无底洞 |

**我的建议是 A**：SW 那一块性价比明确，砍掉它是过度收缩；而 C 里被砍掉的部分本来就有一项技术上不可行。

---

## 阶段四：YouTube 无广告播放（前置 T4.0 通过）

### 架构

```
用户在 Browser 页输入 youtube.com/watch?v=XXX
        │
        ├─ 路由拦截：识别为 YouTube → 不走 iframe/代理，走自有播放器
        ▼
  GET /api/youtube/meta?v=XXX
        │  └─ Extractor → InnerTube → PO Token/BotGuard → format URLs
        │     返回：视频/音频流清单 / 字幕轨 / 标题 / 时长
        │     ★ adPlacements 字段我们根本不解析
        ▼
  前端 <TanWordsYouTubePlayer>
        │  ├─ shaka-player 播服务端生成的 DASH MPD
        │  └─ 字幕轨 → 接入 TanWords 句式学习
        ▼
  GET /api/youtube/stream?...   (Range 透传代理)
        └─ 必须走代理：googlevideo 有 CORS 限制，且响应可能绑定请求方 IP
```

### T4.1 提取器选型

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **yt-dlp**（子进程） | 社区维护最勤，YouTube 一改动几天内跟上；PO Token provider 生态成熟；字幕/格式支持最全 | 需 Python 运行时或独立二进制；要定期更新 | ✅ **推荐** |
| **rustypipe**（纯 Rust） | 无外部依赖，单二进制部署干净 | 跟进上游慢于 yt-dlp；PO Token 支持弱 | 备选 |
| 公共 Invidious / Piped 实例 | 零实现成本 | 实例不稳定、频繁被封、隐私不可控 | ❌ 不作主路径 |

把提取器抽象成 trait，将来换 rustypipe 不动上层。

### T4.2 两级缓存 ⭐（v1 的单一 4h TTL 已废弃）

v1 写的「流 URL 通常 6h 有效，TTL 设 4h」是把猜测当架构保证。PO Token 的生命周期与 enforcement 仍在变化，且 stream URL 可能绑定 visitor data / PO token / session / video ID / IP。

**拆成两层：**

```rust
VideoMetadataCache    // 标题 / duration / thumbnails / 字幕轨元信息
                      // 与授权无关，TTL 可以长（天级）

PlaybackSessionCache  // formats / stream URLs / PO token
                      // 授权相关，TTL 短，且必须可主动失效
```

**失效路径**（比 TTL 更重要）：

```
stream 请求返回 403 / 410
        ↓
invalidate PlaybackSessionCache[videoId]
        ↓
重新 extract
        ↓
retry once（仅一次，避免打死上游 / 无限循环）
        ↓
仍失败 → 明确错误态 + 「在默认浏览器打开」逃生口
```

播放器需能在播放中途无缝换源（长视频播到后段 URL 过期是常态，不是异常）。

### T4.3 `/api/youtube/stream` Range 代理

- **正确透传 `Range` 请求头和 `206 Partial Content`**，否则拖进度条失效
- 流式转发，不落盘、不全量缓冲
- 加签名 + 短时效 token，防止被当成开放代理滥用
- SSRF guard：目标 host 必须匹配 `*.googlevideo.com` 白名单
- 限流

### T4.4 `/api/youtube/meta` 路由

- 新文件 `web/server/src/youtube.rs`
- 复用现有鉴权中间件（与 `browser_proxy` 同一套 session gate）
- 服务端组装 DASH MPD 交给 shaka-player；保留 progressive 格式作降级路径

### T4.5 前端播放器组件

新增 `app/src/components/Browser/YouTubePlayer.tsx`：

- `<video>` + shaka-player
- 播放控制、清晰度切换、**倍速**（语言学习场景必需）
- 字幕轨接入 TanWords（见第 5 节）

### T4.6 路由拦截

- **Web**：`BrowserPage.tsx:242` 算 `proxySrc` 前先判断是否 YouTube watch/shorts/youtu.be，是则渲染 `<YouTubePlayer>`。复用已有的 `youtubeUrl.ts`（`isYouTubeUrl` / `youTubeId`）
- **Desktop**：`browserPanel.ts` 在 `will-navigate` 拦下 YouTube URL，通知渲染进程切换到播放器视图
- **Documents**：`YouTubeView.tsx`（现用 iframe embed）同样换成自有播放器 → Documents 里的 YouTube 也一并无广告

### T4.7 Desktop 复用

sidecar 已是 HTTP 服务（`/invoke/...`），把 `youtube_meta` / `youtube_stream` 作为 `#[crate::shim::command]` 加进 `app/core/src`，提取器逻辑放 core 里两端共享，桌面端零额外架构成本。

### 阶段四验收

- [ ] Web 端播放已知带贴片广告的视频，全程无广告、无黑屏等待
- [ ] Desktop 端同一视频同样表现
- [ ] 进度条拖动正常（Range 生效）
- [ ] 长视频播到后段：流过期能自动重取并无缝续播
- [ ] 字幕轨正确加载，中英双语可切换
- [ ] 1080p 不卡顿
- [ ] Documents 里的 YouTube block 同样无广告
- [ ] 提取失败有清晰错误态 + 逃生口

---

## 5. 字幕：可能比去广告更有价值

阶段四拿到字幕轨后，可以接成：

```
YouTube 视频
   ↓
TanWords Player
   ↓
caption track → sentence timeline
   ↓
点击某一句（如 02:13 "I ended up having to redo the entire thing."）
   ↓
查词 / 翻译 / AI 解释
   ↓
抽出句式 "end up doing sth" → 加入句式库
```

这与 TanWords「文章驱动的句式学习」方向直接吻合，把「无广告 YouTube」升级成「可学习的视频内容源」。**规划阶段四时应把字幕当一等公民，不是播放器的附属功能。**

---

## 6. 风险与维护成本

| 风险 | 影响 | 缓解 |
|---|---|---|
| **PO Token / BotGuard enforcement 变化** 🔴 | 阶段四整体失效 | **T4.0 前置闸门**；跟随 yt-dlp 更新；提取器做成可热更新 sidecar；保留 iframe embed 降级 |
| YouTube 变更打断提取器 | 取流失败 | 同上；trait 抽象便于换实现 |
| 流 URL 过期 | 长视频中途断流 | PlaybackSessionCache 短 TTL + 403/410 失效重取 + 播放器无缝换源 |
| yt-dlp 部署依赖 | Web 部署复杂度上升 | 打进部署镜像（见 `deploy/`）；或退 rustypipe |
| 代理被滥用 | 带宽 / 法律面 | stream 路由签名 token + 限流 + host 白名单；本就在 session gate 之后 |
| uBO 列表体积 | 引擎构建耗时/内存 | 已有序列化缓存；构建在后台线程，不阻塞首屏 |
| resource bundle 与 uBO 上游漂移 | scriptlet 失效 | 季度同步脚本；变动频率远低于过滤规则 |

> **合规提示**：以上是自托管个人应用的技术方案。绕开 YouTube 前端播放视频与其服务条款存在张力。这是你的自用工具，判断权在你；若将来考虑公开分发，需重新评估。

---

## 7. 执行顺序（v2 已调整）

v1 建议 `一 → 四`。审核建议先做 POC。**采纳**：

```
T4.0  yt-dlp + PO Token POC        ← 闸门，先于一切编码
  ↓
阶段一  引擎升级（列表 + resources + TTL）
  ↓
阶段四  YouTube 播放器（仅当 T4.0 通过）
  ↓
阶段二  桌面 cosmetic 注入
  ↓
阶段三  Web 代理增强（范围见上方决策点，建议选 A）
```

| 阶段 | 收益 | 备注 |
|---|---|---|
| T4.0 | 决定阶段四是否可行 | 不写生产代码，纯验证 |
| 一 | 两端普通站点过滤质量大幅提升；YouTube 达 uBO 同等水平 | 低成本高回报的地基，与 T4.0 可并行 |
| 四 | YouTube 无广告 + 字幕接入 | 依赖 T4.0 |
| 二 | 桌面端补齐 DOM 层过滤 | 收尾 |
| 三 | web 端 SPA 可用性 | 范围已收窄；待决策 |

**为什么 T4.0 在最前**：避免先写完 Shaka Player、Range Proxy、DASH MPD，最后发现最底层取流在生产环境不稳定。这是整个计划里唯一一处「先验证再投入」能省下大量返工的地方。

---

## 附：审核意见处置记录

| 审核意见 | 处置 |
|---|---|
| 「唯一保证零广告」措辞过绝对 | ✅ 采纳，改为「绕开官方广告播放链路的高可靠方案」 |
| PO Token 升级为 T4.0 前置闸门 | ✅ 采纳，独立成章 |
| meta cache 拆 metadata / playback session | ✅ 采纳，见 T4.2 |
| 删除手写 YouTube json-prune | ✅ 双方一致 |
| resource library 必做 | ✅ 双方一致 |
| 优先用 `resource-assembler` 替代 Ghostery JSON | ⚠️ **部分采纳**。已核 0.12.6 源码：`assemble_scriptlet_resources` 已 `#[deprecated]` 且仅解析旧格式，Brave 上游自己建议「用 JS 代码转换」。redirect resources 用 assembler ✅；scriptlets 不能用 |
| `import()` 无法 monkey-patch | ✅ 采纳，v1 写错了，已删除该项 |
| `HTMLElement.prototype.src` 不存在统一入口 | ✅ 采纳，v1 简写把工作量说小了 |
| 阶段三大幅降级 | ⚠️ **部分采纳**。prototype patching 全砍；但 **Service Worker 不应与之同列**——它是唯一能不打补丁就处理运行时构造 URL 的机制，成本低收益高，提升为主要手段（v1 把它写成兜底，顺序也是反的） |
| Web 端 best effort | 🔷 **交由决策**。与「web 端必须有 ad block」的原始要求有张力，见阶段三决策点 |
| 执行顺序改为 POC 优先 | ✅ 采纳 |
| 字幕的产品价值 | ✅ 采纳，独立成第 5 节 |
