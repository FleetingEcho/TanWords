# TanWords

[English](README.md) | **简体中文**

一款基于 Tauri v2 的桌面应用，主打「以内容驱动」的英语词汇与句型学习，面向 CEFR
C1/C2 水平的学习者。产品闭环：**阅读一篇真实文章 → AI 提取值得学习的词汇和句型 →
收录进个人词库/句型库 → （词汇部分）用 FSRS 间隔重复复习。**

应用界面语言以中文为主；代码库本身（标识符、注释）使用英文。

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
app/     # 桌面应用 —— React + TypeScript 前端，Rust/Tauri 后端，SQLite 数据库。
         # 完整架构说明见 app/AGENT.md。
admin/   # 独立的本地管理工具，操作同一个 SQLite 数据库 —— 表格 CRUD 和
         # AI 批量生成（单词/文章/句型/文档），与桌面应用相互独立。
         # 见 admin/README.md。
```

## 技术栈

- **前端**（`app/`）：React 18 + TypeScript + Tailwind + Zustand，Vite，BlockNote
  （文档编辑器）。
- **后端**（`app/src-tauri/`）：Rust，Tauri v2，`libsql`（SQLite，WAL 模式）—— 同一套
  API 同时支持本地数据库文件和 Turso 嵌入式副本，见下方「在线数据库」。
- **管理工具**（`admin/`）：Node + Hono API + `better-sqlite3`，React/Vite 网页界面，
  外加一个用于无人值守批量生成内容的独立 CLI。
- **AI**：自带 API Key，兼容 OpenAI 接口的任意服务商（OpenAI、Anthropic/Claude、
  DeepSeek 预设，或通过 Ollama/LM Studio 接入的任意本地模型）。
- **TTS**：通过 `sherpa-rs`/sherpa-onnx 实现的本机嵌入式语音合成 —— 支持
  Kokoro 和 Piper/VITS 音色，朗读时不依赖外部二进制或网络请求。支持下载语音
  模型、自定义模型目录、逐句朗读全文，以及贯穿全应用的单词/例句朗读按钮；
  未加载本地模型时会回退到浏览器自带的 `speechSynthesis`。
  文章朗读采用流水线而非整篇批量合成：模型在应用启动时就预加载好（而不是等
  第一次朗读时才加载），播放时只等待"即将播放的这一句"，接下来的几句在后台
  提前合成；合成过程本身跑在独立的阻塞线程上，不占用异步运行时，朗读时界面
  不会卡顿。

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

```bash
cd app && npm install && npm run tauri dev   # 桌面应用
cd admin && npm install && npm run dev       # 管理工具（表格浏览器 + 批量生成）
```

## 延伸阅读

- [`app/AGENT.md`](app/AGENT.md) —— 桌面应用的完整架构说明、数据访问方式、
  已知坑点和开发约定。
- [`admin/README.md`](admin/README.md) —— 管理工具的搭建方式、表格浏览器，以及
  `generate-cli.mjs` 的各种批量生成模式。
