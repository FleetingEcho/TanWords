# TanWords

[English](README.md) | **简体中文**

TanWords 是一款基于 Electron 和 Rust sidecar 的桌面英语学习应用，面向 CEFR C1/C2 级别的进阶学习者。它的核心流程是：

> 阅读一篇真实文章 -> AI 提取值得学习的词汇和句型 -> 收录进个人词库/句型库 -> 用 FSRS 复习单词。

界面语言以中文为主，代码库语言以英文为主。

## Web 版本（浏览器版）

浏览器版本（桌面 + 移动端，支持邀请码注册的多用户，每个用户独立 Turso）在 [`web/`](web/README.md) 目录下。它不是移植版：它链接同一个 Rust crate、使用同一份渲染进程产物，一个功能写一次就同时出现在两端。参见[一套代码，两个产品](#一套代码两个产品)。

### 启动 Web 版

需要先安装 Bun 和 Rust。

1. 构建共享前端（只需要构建一次）：

   ```bash
   cd app
   bun install
   bun run build
   ```

2. 启动 Web 后端：

   ```bash
   cd ../web/server
   TANWORDS_MASTER_KEY=$(openssl rand -hex 32) \
   TANWORDS_INVITE_KEY=choose-a-key \
   cargo run --release
   ```

3. 打开 `http://127.0.0.1:8740`，用邀请码注册。

如果要在手机/局域网访问：

```bash
cd web/server
TANWORDS_HOST=0.0.0.0 \
TANWORDS_MASTER_KEY=$(openssl rand -hex 32) \
TANWORDS_INVITE_KEY=choose-a-key \
cargo run --release
```

然后打开 `http://<电脑局域网IP>:8740`。

所有人注册完成后，重启服务并去掉 `TANWORDS_INVITE_KEY`，即可关闭注册
和密码重置入口。更多环境变量和部署说明见
[`web/server/README.md`](web/server/README.md)。

### 单二进制部署

前端已经嵌入 Rust 服务端二进制，部署时只需要一个可执行文件。已验证：

- `cargo build --release` 构建成功。
- 不设置 `TANWORDS_WEB_DIST` 启动时，日志显示 `serving embedded SPA`。
- 访问 `http://127.0.0.1:8741/` 返回 `200 OK`。

构建单文件：

```bash
cd app
bun run build

cd ../web/server
cargo build --release
```

产物：

```text
web/server/target/release/tanwords-web-server
```

部署时只需要复制这个二进制，然后运行：

```bash
TANWORDS_MASTER_KEY=... \
TANWORDS_INVITE_KEY=... \
TANWORDS_HOST=0.0.0.0 \
TANWORDS_PORT=8740 \
./tanwords-web-server
```

`TANWORDS_WEB_DIST` 变为可选；只有想用外部前端目录替换嵌入版本时才需要设置。

## 核心特点

- **从真实内容开始学习。** 粘贴文章、打开 RSS 订阅，或在应用内浏览 Hacker News，AI 直接从真实文本里提取词汇和句型，而不是给一份泛泛的单词表。
- **每个单词都有完整 AI 讲解。** 包括核心释义、常见用法、搭配、与近义词的细微差别、词源和记忆方法，并配有多条真实例句。
- **句型也是一等公民。** Sentences/Patterns 库保存可复用的句型骨架和填空槽位，并锚定到它真实出现的那句话。
- **阅读、RSS、播客和 Hacker News 集中在一个应用里。** 内置阅读器可以沉浸式阅读、提取词汇、逐句朗读全文，也可以在底部常驻播放条里播放播客。
- **内置 FSRS 间隔重复。** 收录的单词可以直接进入复习队列。
- **默认完全本地。** 数据保存在本地 SQLite 文件；需要时再连接你自己的 Turso 数据库跨设备同步，并接上你自己的 Cloudflare R2 存储桶来放视频、音频这类本就不该塞进数据库的文件。
- **完全本机 TTS。** Kokoro/Piper 音色在本地运行，朗读时不产生网络请求，并支持逐句朗读文章。
- **文档和 AI 对话。** 侧边栏内置 BlockNote 文档编辑器，以及支持工具调用、可直接读写应用数据的多会话 AI 对话。

## 截图

### Dashboard 仪表盘

继续阅读未完成的文章，快速回到最近的单词、句型、文档，并从这一屏进入所有常用操作。

![Dashboard 页面 - 继续阅读与快捷操作](static/images/Dashboard.png)

### 词库与句型库

每个单词都会生成完整的 AI 讲解、多条真实例句、笔记编辑器和逐例句朗读按钮。单词列表按扫读设计，不需要靠无限滚动查找。

![Words 页面 - 单词详情](static/images/Words_2.png)

Sentences 标签页是一个并行的句型库，保存可复用的骨架句式和填空槽位，并锚定到真实例句。

![Words 页面 - Sentences 标签](static/images/Sentences.png)

### Feeds、播客与内置阅读器

同时订阅文章类 RSS 源和播客，播客集会在底部常驻播放条中播放。

![Feeds 页面 - 文章与播客](static/images/Feeds.png)

在应用内阅读器里沉浸式阅读文章、直接提取词汇和句型，或在不离开当前页面的情况下播放播客单集。

![Feeds 页面 - 应用内阅读器](static/images/Feeds_2.png)

![Feeds 页面 - 播客单集详情](static/images/Play_Episode.png)

### Hacker News

在应用内浏览 Top、New、Best，打开帖子后可以连同完整楼中楼评论一起阅读，并送入 Reading 提取词汇和句型。

![Hacker News 页面 - 首页列表](static/images/Hacker_News.png)

![Hacker News 页面 - 帖子与楼中楼评论](static/images/Hacker_News_Comments.png)

### 音乐

按艺人和专辑浏览本地音乐库，播放或随机播放一个合集，并从常驻播放器控制进度、速度和曲目切换。

![Music 页面 - 本地专辑与常驻播放器](static/images/Music.png)

### 设置、TTS 与数据

在设置页扫描本地模型目录，或下载推荐的 Kokoro/Piper 音色，先试听再使用，并调整朗读语速。所有语音合成都在本机完成。

![Settings 页面 - TTS 语音模型设置](static/images/TTS_Model.png)

连接你自己的 Turso 数据库，在多台设备之间同步词库；也可以完全本地使用，并随时在「设置 > 数据」中切换。

![Settings 页面 - 本地与云端数据库](static/images/Local_Cloud_DB.png)

### 文档与 AI 对话

Docs 和 AI Chat 都位于侧边栏：一个带全文搜索和标签的个人笔记编辑器，一个可以通过工具读写应用数据的多会话 AI 对话。

![Docs 页面 - 本地文件夹视图](static/images/Documents.png)

![AI Chat 页面 - 支持工具调用的对话](static/images/AI_Chat.png)

## 安装

到 [Releases](https://github.com/FleetingEcho/TanWords/releases/latest) 下载最新 `.dmg`：Apple Silicon 选择带 `-arm64` 的文件，Intel 选择不带后缀的文件。

### macOS 提示「TanWords 已损坏，无法打开」

首次安装出现这个提示是预期行为，应用本身没有损坏。构建产物只有 ad-hoc 签名，没有付费的 Developer ID 签名，所以 macOS 会给从浏览器下载的 bundle 打上隔离标记，并拒绝启动。用两条命令永久解决：

```bash
xattr -cr /Applications/TanWords.app
codesign --force --deep --sign - /Applications/TanWords.app
```

第二条命令会输出 `replacing existing signature`，属于正常现象。两条都要执行：只执行 `xattr` 只能清除隔离标记，应用仍需要通过签名校验。

这套操作只需做一次。应用内更新会自行下载并校验签名，不经过浏览器，之后的新版本无需重复执行。

## 快速开始

需要 [Bun](https://bun.sh) 和 Rust 工具链。

```bash
cd app
bun install
bun run dev
```

`bun run dev` 会先编译 Rust sidecar（debug 模式），再启动 Electron 和 Vite。

常用命令：

```bash
bun run typecheck    # 对渲染进程和 Electron 主进程执行 TypeScript 检查
bun run test:run     # 运行 Vitest
bun run package:mac  # 产出 DMG 和 zip 到 dist-releases/
cd core && cargo test
```

> 打过 release 包之后，`bun run dev` 可能会优先使用 `core/target/release/tanwords-core`。重新执行 `cargo build`，或删掉 release 二进制，避免开发版一直启动旧的 sidecar。

## 功能页面

| 页面 | 功能说明 |
| --- | --- |
| Dashboard（仪表盘） | 继续阅读未完成的文章，查看最近的单词、句型、文档，并提供常用快捷操作。 |
| Reading（阅读） | 粘贴文章后由 AI 提取词汇和句型，可单条或批量收录；支持逐句精读，并用内置 TTS 逐句朗读全文。 |
| Feeds（订阅） | 同时订阅文章类 RSS 和播客；应用内浏览 Hacker News Top/New/Best 及楼中楼评论；文章可在内置阅读器中打开；播客在底部常驻播放条中播放。 |
| Knowledge Map（无限知识地图） | 从任意单词、场景或主题生成可持续保存的 2.5D 词汇地图；任意分支可渐进展开，并把选中的词汇加入词库/FSRS。 |
| Vocabulary（词库） | 主从式单词浏览，配完整 AI 讲解、例句、搭配、词源、记忆法、FSRS 复习、时间筛选和朗读按钮。 |
| Patterns（句型库） | 与词库并行的句型库，保存骨架句式和填空槽位，按修辞功能打标签，并锚定到真实例句。 |
| Discover（发现） | 按主题批量生成一组词汇，或从词根/词缀出发探索词族。 |
| Documents（文档） | BlockNote 编辑器、SQLite FTS5 全文搜索、标签、置顶和文档工作流工具。 |
| AI Chat（AI 对话） | 多会话对话，支持工具调用，可直接读取和写入应用数据。 |
| Settings（设置） | AI 服务商、CEFR 目标等级、TTS 音色与语速、数据库位置、在线同步、备份导出。 |

## 在线数据库（可选）

默认情况下，所有数据都保存在本地 SQLite 文件中，不需要任何账号。要在多台设备之间共享词库，请在「设置 > 数据」中连接你自己的 Turso 数据库：

```bash
turso db create tanwords
turso db show tanwords --url          # -> libsql://... 填入「数据库 URL」
turso db tokens create tanwords       # -> token 填入「Auth Token」
```

连接后应用仍保留一份完整本地副本，因此读取保持本地速度，离线阅读也不受影响。写入会转发到你的主库并后台同步。Token 保存在系统钥匙串中，界面里无法读回。

外观设置也存放在数据库里。连接到一个空的在线库后，它们会显示为默认值，看起来像被重置了，但原本地数据库不会被改动，随时可以重新挂载。

要把已有本地数据搬进在线库，使用「设置 > 数据 > 从本地数据库导入」。导入前会预览新增和已有的单词、句型、文章、文档，可以逐条选择覆盖或跳过，并在一个事务中完成。重复导入同一个文件不会产生重复数据，覆盖也不会改动 FSRS 复习进度。

你可以随时断开连接。当前词库会先保存成一个独立的本地数据库文件，远端数据不受影响。离线时读取仍走本地副本（标记为只读），写入会明确报错，不会悄悄丢失。

数据库属于你自己的 Turso 账号，本项目不托管任何数据。

## 大文件存储（可选）

数据库不是放 85 MB 视频的地方。Turso 会直白地证明这一点：这次写入会作为单条消息
发往主库，然后返回 `SQLITE_NOMEM`。所以附件按大小分流——小文件留在数据库里，不需要
网络、离线可用；大文件交给对象存储。

在 设置 > 数据 里连接 **Cloudflare R2**。R2 的免费额度是 10 GB，且**出口流量不计费**，
这对要反复观看的视频很关键：

1. 在 Cloudflare 控制台创建一个 R2 存储桶。
2. R2 > 管理 R2 API 令牌 > 创建 API 令牌，权限选**对象读写**。
3. 把三个值填进设置：Account ID（32 位十六进制）、Access Key ID（32 位十六进制）、
   Secret Access Key（64 位十六进制——**不是**那串约 40 位的 Token 值）。
4. 「保存并测试」会真的上传一个对象再删掉，然后才写入配置；密钥填错会在这一步失败，
   而不是等你第一次传大文件时才发现。

之后，**10 MB 及以上**的文件进入存储桶，数据库只保留元数据；也可以用开关把*所有*
文件都送过去。播放时通过预签名 URL 直接从 R2 流式读取，视频能正常拖动进度，而不必
先整个下载完。设置里显示的是存储桶的真实用量（实时列举，不是本地累加），超过 9 GB
会拦截上传，留出余量以免超出免费额度。

配置保存在你当前连接的那个数据库里，整条记录用 AES-256-GCM 加密，密钥存在系统钥匙串
中。由此带来两个值得知道的结果：切换数据库就会切换存储桶；而在 Web 版上，每个用户各自
配置自己的桶——即使这行记录被同步到另一台机器，那边也拿不到可用的凭据。

存储桶属于你自己的 Cloudflare 账号，本项目不托管任何数据。

## AI 服务商

自带 API Key。内置 OpenAI 和 Claude 预设、DeepSeek 预设，也支持任何兼容 OpenAI 接口的自定义端点，例如 Ollama 或 LM Studio。

服务商配置保存在数据库里：

- **API Key 加密落盘**，使用 AES-256-GCM，主密钥保存在系统钥匙串中。渲染进程不会直接读取明文 Key。
- **服务商按添加它的设备隔离。** 设备标识是主键的一部分，因此同步数据库不会在设备之间共享服务商凭据。

## 一套代码，两个产品

TanWords 同时是桌面应用和可自建的 Web 应用。它们不是"两份实现恰好行为一致"，
而是同一份代码编译了两次。

`app/core` 同时构建为二进制和库：

```toml
# app/core/Cargo.toml
[lib]
name = "tanwords_lib"

# web/server/Cargo.toml
tanwords_lib = { package = "tanwords", path = "../../app/core",
                 default-features = false, features = ["web"] }
```

于是每一条命令——词库、文档、AI 解析、RSS、句式库、FSRS 排期、R2 上传——都只
存在一份，在 `app/core` 里。桌面版把它作为 sidecar 二进制运行，由 Electron 托管；
Web 版链接同一个 crate，为每个登录用户挂载同一张命令表。`app/src` 里的渲染进程
同样只构建一次：Electron 通过自定义的 `app://` scheme 加载它，服务端则用
`rust-embed` 把同一份产物嵌进自己的二进制。

省下多少，看行数最直观：

| | 行数 | 承载什么 |
| --- | --- | --- |
| `app/core/src` | 约 18,000 | 产品的全部能力 |
| `web/server/src` | 约 1,800 | 账号、会话、路由、按用户分库、托管前端 |

`web/server` 不实现任何业务逻辑。它只回答桌面版永远不必问的那个问题——
*这份数据是谁的*——其余全部交给 `tanwords_lib`。每个用户的数据库在
`users/<id>/` 下打开，命令表构建在那条连接上；正因如此，Web 版是多用户的，
而没有任何一条命令需要知道"多用户"这回事。

**这层间接为什么值得。** 在 `app/core` 里加一个功能，两个产品下次各自编译时就都
有了；没有第二份实现需要同步，也就不存在"两边行为不一致"这类 bug。真正应该写
两遍的只有跟*谁在访问*有关的代码：鉴权、按用户隔离，以及少数确实不同的能力——
Web 版没有本地音乐库、没有系统钥匙串、也没有应用锁（账号已经起到了门禁作用）。
这些差异集中声明在 `src/platform/types.ts` 和 Cargo feature 里，而不是等它们
以"逐渐跑偏"的形式被发现。

### `web/server` 的结构

七个文件，各司一职：

| 文件 | 职责 |
| --- | --- |
| `main.rs` | 启动：读环境变量、打开 `users.db`、监听端口。 |
| `config.rs` | 全部配置项，完全由环境变量驱动（`TANWORDS_MASTER_KEY`、`TANWORDS_INVITE_KEY`、`TANWORDS_DATA_DIR`、`TANWORDS_PORT` 等）。 |
| `auth.rs` | Bearer token 的收发，以及按 (类型, IP) 计数的失败限流。 |
| `users.rs` | `users.db`——邮箱、argon2id 密码哈希、会话 token（落盘前 sha256）、每个用户经 AES-256-GCM 加密的 Turso 凭据。它刻意是一个**独立**数据库，与任何用户的词库无关。 |
| `runtime.rs` | 按用户的运行时池。 |
| `server.rs` | axum 网络层：路由、会话中间件、`/invoke` 分发、资产、导入导出、AI 代理。 |
| `embedded.rs` | 七行 `rust-embed`，把构建好的前端编进二进制。 |

`runtime.rs` 是多用户真正发生的地方，想理解这套设计的话，读它就够了。每个登录
用户拥有自己的一份 core 运行时——围绕*他自己的*数据库构建的 `Registry` +
`AppHandle`。命令代码照旧读 `State<AppState>`，跟桌面上一模一样；隔离来自
"这些运行时是彼此独立的对象"这一事实。数据、文档密码的解锁状态、SSE 事件流
全都按运行时隔离，所以不存在某条命令不小心读到别人数据的位置——因为一条命令
根本没有办法指名另一个用户的运行时。

这个池容量刻意设得很小，会淘汰空闲条目。淘汰一个条目就是丢掉最后一个 `Arc`，
进而 drop 掉 `Registry`，进而关闭 `Db`——关一个本地文件没有任何代价，而 Turso
副本只是停掉后台同步，下次启动再从主库重新同步。这是一个面向受邀用户的自建应用，
不是公共服务，池子开大没有收益。

## 架构

TanWords 使用轻量的 Electron 外壳和一个静态链接的 Rust sidecar：

- **渲染进程**（`app/src/`）：React、TypeScript、Tailwind CSS、Zustand、Vite 和 BlockNote。
- **外壳**（`app/electron/`）：Electron 主进程和 preload，负责窗口、托盘、内置浏览器面板、更新器和 sidecar 生命周期，刻意不承载业务数据逻辑。
- **后端**（`app/core/`）：Rust 和 `libsql`（SQLite WAL 模式）。同一套 API 同时支持本地数据库文件和 Turso 嵌入式副本。
- **IPC**：渲染进程通过随机端口的回环 HTTP API 直连 sidecar，使用 preload 握手下发的 bearer token 鉴权，事件通过 SSE 推送。
- **命令机制**：Rust 命令通过属性宏标注，构建脚本自动生成分发表，不需要手工维护容易失配的路由表。
- **TTS**：内置 `sherpa-onnx` 语音合成，模型按需加载，支持逐句朗读全文，并在未加载本地模型时回退到浏览器语音引擎。
- **更新器**：macOS 发布物使用 ed25519 签名并在解包前校验；Windows 和 Linux 使用 `electron-updater`。

仓库结构：

```
app/
  src/        # React + TypeScript 渲染进程
  src/ipc/    # 访问 sidecar HTTP API 与 SSE 事件流的类型化客户端
  electron/   # Electron 主进程与 preload
  core/       # Rust sidecar：数据、AI、TTS、RSS、MCP server
docs/         # 功能与构建文档
scripts/      # 发布辅助脚本
```

## 构建与发布

macOS 打包：

```bash
cd app
bun run package:mac
```

Linux 和 Windows：

```bash
bun run package:linux
bun run package:win
```

发布产物输出到 `dist-releases/`。macOS 更新器元数据通过以下命令生成：

```bash
node app/scripts/sign-release.mjs
```

## 延伸阅读

- [`docs/audio-player.md`](docs/audio-player.md) - 音频播放内部实现。
- [`docs/build-windows.md`](docs/build-windows.md) - Windows 构建说明。
