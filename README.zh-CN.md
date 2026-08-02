# TanWords

[English](README.md) | **简体中文**

TanWords 是一款基于 Electron 和 Rust sidecar 的桌面英语学习应用，面向 CEFR C1/C2 级别的进阶学习者。它的核心流程是：

> 阅读一篇真实文章 -> AI 提取值得学习的词汇和句型 -> 收录进个人词库/句型库 -> 用 FSRS 复习单词。

界面语言以中文为主，代码库语言以英文为主。

## Web 版本（浏览器版）

Web 版支持桌面和手机浏览器，带邮箱+密码账号、邀请码注册和每人独立的
Turso/本地数据库。它直接使用 `app/src` 构建出的同一套前端，不再维护
第二套前端目录。

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
- **默认完全本地。** 数据保存在本地 SQLite 文件；需要时再连接你自己的 Turso 数据库跨设备同步。
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

数据库属于你自己的 Turso 账号，项目本身不托管任何服务端。

## AI 服务商

自带 API Key。内置 OpenAI 和 Claude 预设、DeepSeek 预设，也支持任何兼容 OpenAI 接口的自定义端点，例如 Ollama 或 LM Studio。

服务商配置保存在数据库里：

- **API Key 加密落盘**，使用 AES-256-GCM，主密钥保存在系统钥匙串中。渲染进程不会直接读取明文 Key。
- **服务商按添加它的设备隔离。** 设备标识是主键的一部分，因此同步数据库不会在设备之间共享服务商凭据。

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
