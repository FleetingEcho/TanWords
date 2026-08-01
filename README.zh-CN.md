# TanWords

[English](README.md) | **简体中文**

一款基于 Electron + Rust sidecar 的桌面应用，主打「以内容驱动」的英语词汇与句型
学习，面向 CEFR C1/C2 水平的学习者。产品闭环：**阅读一篇真实文章 → AI 提取值得
学习的词汇和句型 → 收录进个人词库/句型库 → （词汇部分）用 FSRS 间隔重复复习。**

应用界面语言以中文为主；代码库本身（标识符、注释）使用英文。

## 安装

到 [Releases](https://github.com/FleetingEcho/TanWords/releases/latest) 下载最新的
`.dmg` —— Apple Silicon 选带 `-arm64` 的，Intel 选不带后缀的那个。

### macOS 报「TanWords 已损坏，无法打开」

首次安装出现这个提示是预期内的，**应用本身没有损坏**。我没有付费的 Apple 开发者
账号，所以构建产物没有 Developer ID 签名，只有 ad-hoc 签名；而 macOS 会给一切从
浏览器下载的文件打上隔离标记，并拒绝启动未正确签名的 bundle。两条命令可以一劳
永逸地解决：

```bash
xattr -cr /Applications/TanWords.app
codesign --force --deep --sign - /Applications/TanWords.app
```

第二条会输出 `replacing existing signature`，属正常。**两条都要跑** —— 只跑
`xattr` 不够：它仅清除隔离标记，bundle 本身仍然通不过签名校验
（`Sealed Resources=none`），macOS 照样报「已损坏」。

**这套操作只需做一次。** 应用内更新是自己下载并校验签名的，不经过浏览器，不会被
打上隔离标记，之后的版本无需重复上述步骤。

## 截图

### Dashboard（仪表盘）—— 每次打开应用的起点

继续阅读未完成的文章，快速跳回最近的单词/句型/文档，所有快捷操作入口都在
这一屏里。

![Dashboard 页面 — 继续阅读与快捷操作](static/images/Dashboard.png)

### Words（词库）—— 每个单词都有完整的 AI 讲解

每个单词都会生成一段自由格式的中文讲解（核心释义、常见用法、搭配、与近义词的
细微差别、词源、记忆方法），配 4-6 条以上真实例句，并带笔记编辑器和逐条例句的
朗读按钮。单词列表按"扫读"设计，而不是靠滚动翻找。

![Words 页面 — 单词详情](static/images/Words_2.png)

同一页面的 **Sentences（例句）** 标签是一个并行的句型库——可复用的骨架句式
带填空槽位，并锚定在真实出现过的那句话上：

![Words 页面 — Sentences 标签](static/images/Sentences.png)

### Feeds（订阅）—— 文章和播客集中在一个地方

同时订阅文章类 RSS 源和播客；播客集会在底部常驻的播放条中播放。

![Feeds 页面 — 文章与播客](static/images/Feeds.png)

打开一篇文章可以在应用内阅读器里沉浸式阅读、直接提取词汇和句型，或者点击
"Play episode"直接在底部播放条播放播客，不用离开当前页面：

![Feeds 页面 — 应用内阅读器](static/images/Feeds_2.png)

![Feeds 页面 — 播客单集详情](static/images/Play_Episode.png)

### Hacker News —— 内置阅读器，不用切浏览器

直接在应用内浏览 Top/New/Best：

![Hacker News 页面 — 首页列表](static/images/Hacker_News.png)

打开任意一条帖子，连同完整的楼中楼评论一起阅读，也可以直接送入 Reading
提取词汇和句型：

![Hacker News 页面 — 帖子与楼中楼评论](static/images/Hacker_News_Comments.png)

### Music（音乐）—— 边听本地音乐边学习

按艺人和专辑浏览本地音乐库，播放或随机播放一个合集，并通过底部常驻播放器
控制当前队列——支持拖动进度、调整播放速度、切换曲目。

![Music 页面 — 本地专辑与常驻播放器](static/images/Music.png)

### Settings（设置）—— 本机 TTS 语音模型，以及你自己的云端数据库

在设置页里扫描本地模型目录，或者直接下载推荐的 Kokoro/Piper 音色，下载前
可以先试听，还能调整朗读语速——所有语音合成都在本机完成，朗读时不产生
任何网络请求。

![Settings 页面 — TTS 语音模型设置](static/images/TTS_Model.png)

连接你自己的 Turso 数据库，在多台设备间同步词库；也可以完全离线，随时在
「设置 › 数据」里两者之间切换：

![Settings 页面 — 本地与云端数据库](static/images/Local_Cloud_DB.png)

### Documents 与 AI Chat —— 侧边栏中的一等页面

Docs 和 AI Chat 就在左侧导航栏里：个人笔记编辑器（BlockNote、全文搜索、
标签）和多会话 AI 对话，从应用任意位置一键直达。

![Docs 页面 — 本地文件夹视图](static/images/Documents.png)

![AI Chat 页面 — 支持工具调用的对话](static/images/AI_Chat.png)

## 仓库结构

```
app/
  src/        # React + TypeScript 渲染进程（含 electron/ 约 4.2 万行）
  src/ipc/    # 访问 sidecar HTTP API 与 SSE 事件流的类型化客户端
  electron/   # Electron 主进程与 preload —— 窗口、托盘、更新器、内置浏览器面板、
              # sidecar 生命周期。不承载任何业务数据逻辑。
  core/       # Rust sidecar（约 1.5 万行）：SQLite/libsql、AI 编排、TTS、RSS、
              # MCP server。编译为单个静态二进制。
docs/         # 音频播放器内部实现、Windows 构建说明。
scripts/      # 发布辅助脚本。
```

## 技术栈

- **渲染进程**（`app/src/`）：React 18 + TypeScript + Tailwind + Zustand，Vite，
  BlockNote（文档编辑器）。
- **外壳**（`app/electron/`）：Electron 主进程 —— 窗口/托盘生命周期、更新器、内置
  浏览器面板，以及托管 sidecar。它刻意**不**位于数据链路上。
- **后端**（`app/core/`）：Rust，`libsql`（SQLite，WAL 模式）—— 同一套 API 同时支持
  本地数据库文件和 Turso 嵌入式副本，见下方「在线数据库」。以 sidecar 进程运行，
  而非 Node 服务。
- **AI**：自带 API Key，兼容 OpenAI 接口的任意服务商（OpenAI、Anthropic/Claude、
  DeepSeek 预设，或通过 Ollama/LM Studio 接入的任意本地模型）。API Key 加密落盘，
  且按设备隔离 —— 见下方「AI 服务商」。
- **TTS**：通过 `sherpa-rs`/sherpa-onnx 实现的本机嵌入式语音合成 —— 支持
  Kokoro 和 Piper/VITS 音色，朗读时不依赖外部二进制或网络请求。支持下载语音
  模型、自定义模型目录、逐句朗读全文，以及贯穿全应用的单词/例句朗读按钮；
  未加载本地模型时会回退到浏览器自带的 `speechSynthesis`。
  文章朗读采用流水线而非整篇批量合成：模型按需加载，播放时只等待"即将播放的
  这一句"，接下来的几句在后台提前合成；合成过程本身跑在独立的阻塞线程上，
  不占用异步运行时，朗读时界面不会卡顿。

## 技术亮点

这个应用最初基于 Tauri v2，后来迁移到了 Electron。这个方向通常意味着体积和内存的
代价，所以迁移之后的大部分工作都花在「不为此买单」上。下面每个数字都是实测的
「改动前 → 改动后」。

### Rust sidecar，而不是 Node 后端

Electron 主进程里没有任何业务逻辑。所有数据访问、AI 编排、TTS、RSS 和 MCP server
都在一个静态链接的 Rust 二进制里，由主进程拉起并托管。它在随机端口上提供一套
仅监听回环地址的 HTTP API，用 preload 握手时下发给渲染进程的 bearer token 鉴权，
事件走 SSE。渲染进程直连它。

命令就是标了属性宏的普通 Rust 函数；构建脚本在每次 `cargo build` 时扫描源码生成
分发表，所以新增一个命令 = 一个函数 + 清单里一行，不存在需要手工维护、会逐渐和
实现脱节的路由表。目前有 152 个命令通过这套机制接入。

### 体积：arm64 zip 202MB → 123MB，asar 344MB → 11MB

- **不再打包 `node_modules`。** 全部 27 个生产依赖都是渲染进程的库，Vite 已经把
  它们打进了 `out/renderer`，而 vite-plugin-electron 把唯一那个主进程依赖内联进了
  `out/main` —— 运行时没有任何东西需要从依赖树里解析。照旧打包会让 `app.asar`
  变成 344MB，而不是 **11MB**。
- **字体：1.88MB → 0.17MB。** Monaspace 原本是 1487KB 的 WOFF1 Nerd Font 版本，
  其中 9,390 个 PUA 图标字形在源码里一处都没用到；子集化并转 WOFF2 后只有
  **101KB**。Inter 原本带 9 种字重 × 2 种格式，而应用只用 4 种字重，Chromium 也
  永远用不到 WOFF 回退格式。
- **Electron 语言包：220 → 2。** Electron 框架默认带约 47MB 的 Chromium
  locale `.pak` 文件；这个应用只需要 `en` 和 `zh_CN`，用 `electronLanguages`
  把其余语言从所有目标产物里删掉。当前 arm64 构建里 zip 从 129MB 降到 123MB。
- **主 chunk：3.69MB → 1.73MB。** BlockNote 原本被一些只想要「提取纯文本」这个
  小工具函数的模块拽进了入口 chunk；现在改成缓存 Promise 背后的动态 import，
  独立成块。9 条路由全部代码分割（原本有 7 条是急加载），并改为首次导航时才
  加载，未使用的路由不会常驻渲染进程。全局弹层（单词详情、工具弹窗、播客条）
  也改为打开时才加载。
- **TTS 运行时改为静态链接。** 换用 k2-fsa 官方的 `sherpa-onnx` 之后，`build.rs`
  里的 dylib 拷贝逻辑、各平台 rpath，以及三个平台各自的 `sherpa-libs` 附带产物
  全部删掉了。

### 内存

- **内置浏览器的标签页原本无上限** —— 每个一个完整渲染进程，且永不回收。现在改成
  Chrome 式的 LRU 丢弃（保留 2 个活标签）：进程被释放，回到该标签时按 URL 重新
  加载。
- **关闭 Chromium 的 spare renderer**（一个常驻空转、约 60–90MB 的进程），并限制
  V8 堆上限 —— 实测 3586MB → **631MB**。
- **文档解析 worker** 原本在解析一次之后就一直持有编辑器实例；现在空闲 30 秒后
  自行终止。
- **TTS 模型不再在启动时预加载**，改为按需加载，并在连续 5 分钟没有合成请求后
  释放，那 60–120MB 不再摊到「本次根本没用朗读」的启动上，也不会在停止朗读后
  一直占着。

### 不卡界面的朗读

全文朗读是流水线式而非整篇批量合成：只等待「即将播放的这一句」，后面几句在后台
提前合成，且合成本身跑在专用的阻塞线程上而非异步运行时 —— 所以生成音频的同时
界面依然跟手。

### 不用每年 $99 也能自动更新的更新器

Electron 在 macOS 上把更新交给 Squirrel.Mac，而后者会拒绝任何代码签名与当前运行
的应用不一致的更新包。没有 Apple Developer ID 时应用只有 ad-hoc 签名，而 ad-hoc
的身份是从二进制自身的哈希推导出来的 —— 每次构建都会变，所以这个校验**永远**不
可能通过。macOS 上的自动更新是结构性失效，不是配置问题。

于是 macOS 用了一套自己的更新器：发布物用 ed25519 签名（Node 内置 crypto，零新增
依赖），客户端在**解包之前**先校验整个压缩包字节的签名。安装交给一个分离的脚本：
等应用退出、把旧 bundle 挪开、换上新的、失败则回滚，然后重新启动。Windows 和
Linux 仍走 `electron-updater`；两条路径共用同一套接口，渲染进程无需区分。

### 数据库与迁移

26 个只进不退的迁移，每个都在一个事务批次里执行一次，并在同一次往返中写入版本
戳 —— 迁移不会出现「执行了一半但没记录，下次启动重放」的情况。同一套代码同时驱动
本地 SQLite 文件和 Turso 嵌入式副本。

## AI 服务商

自带 API Key。内置 OpenAI 和 Claude，预置 DeepSeek，此外任何兼容 OpenAI 接口的
端点（Ollama、LM Studio 或托管服务）都能作为自定义服务商接入。

服务商配置存在数据库里，有两点值得说明：

- **API Key 加密落盘**（AES-256-GCM），主密钥保存在系统钥匙串中，渲染进程永远读
  不到。列出服务商时只返回「是否配置了 Key」，明文需要单独、显式地调用才能取到。
- **服务商按添加它的设备隔离。** 设备标识是主键的一部分，所以即使你用 Turso 同步，
  每台机器也只看到自己的服务商；同步到主库的行在别处根本解不开。隔离是靠密码学
  保证的，而不只是靠一个查询条件。

## 功能页面

| 页面 | 功能说明 |
|---|---|
| Dashboard（仪表盘） | 继续阅读未完成的文章，查看最近的单词/句型/文档，快捷操作入口。 |
| Reading（阅读） | 粘贴文章 → AI 提取单词和句型 → 可单条或批量收录；点击任意句子进入沉浸式阅读；"朗读全文"用内置 TTS 引擎逐句播放并高亮跟读。 |
| Feeds（订阅） | 同时订阅文章类 RSS 源和播客；应用内浏览 Hacker News（Top/New/Best，含完整楼中楼评论）；通过应用内阅读器或粘贴方式把文章导入 Reading；应用内阅读器同样支持"朗读全文"；播客集在底部常驻播放条中播放。 |
| 无限知识地图 | 输入任意单词、场景或主题，生成可永久保存的 2.5D 词汇地图；任意分支都能渐进展开，并可将所选词汇加入词库/FSRS。 |
| Vocabulary（词库） | 主从式单词浏览界面，配完整 AI 讲解（自由格式讲解正文、例句、搭配、词源、记忆法）、FSRS 复习、按添加/更新时间筛选，以及每个单词/例句的朗读按钮。 |
| Patterns（句型库） | 与词库并行的句型库（骨架句式 + 填空槽位），按修辞功能打标签，例句均来自真实收录的文章。 |
| Discover（发现） | 按主题批量生成一组词汇，或从词根/词缀出发探索一个词族。 |
| Documents（文档） | 个人笔记编辑器（BlockNote）、全文搜索（SQLite FTS5）、标签、置顶。 |
| AI Chat（AI 对话） | 支持工具调用、可直接读写应用数据的多会话对话。 |
| Settings（设置） | AI 服务商配置、CEFR 目标等级、TTS 音色/语速（扫描目录、下载推荐的 Kokoro/Piper 音色、添加自定义目录）、可切换的数据库位置、在线数据库连接、备份导出。 |

## 在线数据库（可选）

默认所有数据都存在本地一个 SQLite 文件里，不需要任何账号。如果想在多台设备间
共享词库，可以在「设置 › 数据」里连接**你自己的** Turso 数据库：

```bash
turso db create tanwords
turso db show tanwords --url          # → libsql://…  填到「数据库 URL」
turso db tokens create tanwords       # → token       填到「Auth Token」
```

> **注意**：外观设置（头像、昵称、背景图、主题、高亮色、TTS 音色、侧栏布局）也存在数据库里。
> 连到一个空的在线库后它们会显示成默认值，看起来像被重置了 —— 原本地数据库不会被改动，
> 随时可以挂回来。

连接后本地仍然保留一份完整副本（嵌入式副本），所以读取速度和离线阅读都不受
影响，写入会转发到你的主库并在后台双向同步。Token 存在系统钥匙串里，界面上
无法再读回。远程档案不支持「导出备份」和「切换数据库文件」—— 这两个操作只对
本地档案有意义。

**把已有的本地数据搬上去**：设置 › 数据 › 「从本地数据库导入」选一个 TanWords 数据库文件，
会先弹出预览 —— 按单词/句型/文章/文档分组，列出新增数量和已存在的条目（左右对比现有 vs 传入），
逐条勾选覆盖或跳过，确认后一次事务写入。重复导入同一个文件不会产生重复数据。
覆盖不会改动 FSRS 复习进度，设置项（含 MCP token）也不会被导入。

随时可以在设置里断开：当前词库会先完整保存成一个本地数据库文件，然后继续在本地使用，
远端数据不受影响。断网时读取正常（走本地副本，会标为只读），写入会报错而不是悄悄丢失。

数据库属于你自己的 Turso 账号，项目本身不托管任何服务端。

## 快速开始

需要 [Bun](https://bun.sh) 和 Rust 工具链。

```bash
cd app
bun install
bun run dev          # 先编译 Rust sidecar（debug），再启动 Electron + Vite
```

其他常用脚本：

```bash
bun run typecheck    # 对渲染进程和 electron/ 一起跑 tsc
bun run test:run     # vitest
bun run package:mac  # 产出 dmg + zip 到 dist-releases/（另有 :linux、:win）
cd core && cargo test
```

> `bun run dev` 会优先使用已存在的 `core/target/release/tanwords-core`，所以打过
> release 包之后要重新 `cargo build`（或删掉 release 二进制），否则开发版会一直
> 启动那个旧的。

## 延伸阅读

- [`docs/audio-player.md`](docs/audio-player.md) —— 音频播放的内部实现。
- [`docs/build-windows.md`](docs/build-windows.md) —— Windows 构建说明。
