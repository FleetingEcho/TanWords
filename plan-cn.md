# TanWords 便签（Stickies）—— 将 tanNotes 并入 TanWords

> 状态：v1 —— 已规划，未开工 · 2026-09-19 · 负责人：zteng · 仓库：`/home/zteng/work/Tools/TanWords`（分支 `main`）
> 被并入的应用：`/home/zteng/work/Tools/tanNotes`（Tauri 2 + React/TS，里程碑 M0–M5 全部完成，纯本地数据）。
> 功能编号 `F1–F65` 对应 `tanNotes/plan.md` §2。参考 UX：macOS "Stickies!"。

英文原版：[plan.md](plan.md)（两份文档保持同步，改动以先更新的一方为准并互相回写）。

## 1. 目标

用户在 Windows、macOS、Ubuntu 和 Web 四个平台运行 TanWords，共用同一个 Postgres 账户/数据库，不想同时维护两个应用。
tanNotes 的全部能力——悬浮彩色便签、托盘 + 全局快捷键、便签管理器、回收站、模板、导入导出——将作为一等公民的
**Stickies（便签）**功能进入 TanWords。数据迁移验证完成后，tanNotes 退役。

核心原则（与 TanWords「一套代码，两个产品」一致）：**不做第二套编辑器，也不做第二套存储**。
一条便签就是一个 TanWords 文档；便签窗口复用现有的 Tiptap 块编辑器和 sidecar 命令面。

## 2. 已锁定的决策（用户，2026-09-19）

| 决策点 | 选择 |
| --- | --- |
| 数据模型 | **便签 = 一个 TanWords 文档**（内容经 Postgres 跨设备共享）+ **按设备隔离的窗口状态表**。与设备注册表的设计同构：可携带的内容 vs 机器绑定的状态。 |
| 管理器 UI（桌面） | **小型悬浮管理器窗口**（无边框，同 tanNotes 的管理器）——不是侧边栏页面。 |
| Web 端 | Web 获得**应用内 Stickies 页面**（卡片板视图，可读可编辑；没有 OS 窗口）。 |
| 迁移 | 设置 → 数据中的**一次性导入器**；导入验证通过后卸载 tanNotes。 |
| 范围 | **与 tanNotes 今日已实现的功能完全对齐**（其 M1–M5 集合）。P2 增强（点击穿透、便签级提醒、便签级锁）留在 backlog。 |

## 3. 功能对照表（tanNotes → TanWords）

| tanNotes 功能 | 在 TanWords 中的处置 |
| --- | --- |
| F1–F7、F45（悬浮便签窗口、自定义边框、置顶、半透明、折叠、几何持久化、重开、层叠/平铺） | **新增** —— Electron `StickyWindowManager` + 便签窗口入口（§4.3，S1） |
| F8（在光标所在屏幕新建）、F9（所有 Space 可见） | **新增** —— Electron `screen` API / `setVisibleOnAllWorkspaces`（S2） |
| F12–F19、F25、F26、F29–F31（富文本、任务列表、代码块、链接、图片、撤销、字数、自动保存） | **大部分已有**（TanWords 块编辑器、资产、修订）。缺口：`underline`、`highlight`、文字 `color`、字体族/字号标记、查找替换（§4.5） |
| F18 字数统计、F42 自动保存、F51 修订历史 | **已有**（文档字数、自动保存 + 修订） |
| F20 拼写检查 | **新增** —— 便签窗口启用 Chromium 拼写检查（S2） |
| F22 查找与替换 | **新增** —— 仅在便签编辑器内实现（S2） |
| F27–F28、F46（Markdown 粘贴/导入、模板） | **新增** —— Markdown 走现有 worker 管线；移植 `templates.ts`（S2） |
| F34–F36、F38–F39（单便签颜色/透明度/圆角/字体） | **新增** —— 共享便签元数据列 + 窗口外观（S1/S2） |
| F37 主题、F63 双语 en+zh、F64 无障碍 | **已有**（TanWords 主题 + i18n；新界面补审计） |
| F40 打印、F41 复制为 Markdown/图片 | **新增** —— `webContents.print` / `capturePage`；Markdown 复用现有 `blocksToMarkdown`（S2） |
| F43 回收站（软删除） | **在文档层新增** —— `documents.deleted_at` + 管理器回收站标签页（S0/S3） |
| F44 FTS 快速查找 | **已有**（FTS5）—— 增加 kind 过滤的便签搜索（S0） |
| F47–F48 JSON 包导入导出、单便签 md/html 导出 | **新增** —— 便签 JSON 包 + 复用现有序列化器导出（S3） |
| F49 备份 | **已有**（备份机制）；导入器写入前先备份（S4） |
| F50 便签锁 | **暂缓** —— 文档隐私锁已存在；便签 UI 接线进 backlog |
| F52 便签提醒、F53 标签、F54 同步 | 标签与同步随文档 + Postgres 免费获得。提醒 → backlog，日后映射到日历/ntfy |
| F55 托盘菜单 | **扩展** 现有 `TrayManager` 菜单（S1） |
| F56 全局速记快捷键、F58 自定义映射 | **新增** —— `sticky_global_shortcut` 设置项，与 DSH 快捷键同一模式（S1） |
| F57 设置 | **新增** —— 设置 →「便签」分区（默认值、快捷键、自启动、导入）（S1） |
| F59 单实例 | **已有**（`earlyInit` 锁） |
| F60 快速帮助 | **新增** —— 管理器窗口内的快捷键速查（S2） |
| F61 开机自启 | **新增** —— `app.setLoginItemSettings`，设置里可选项（S2） |
| F62 自动更新 | **已有**（TanWords 更新器） |
| F65 纯本地原则 | 被取代 —— 便签跟随用户选择的数据库（SQLite 文件或 Postgres） |

## 4. 架构

```
TanWords（一个应用）
├── app/core（Rust，两个构建共用）        ← 便签数据：documents(kind='sticky') + stickies + sticky_windows
├── app/electron（仅桌面）                ← StickyWindowManager、托盘项、全局快捷键、自启动
├── app/src
│   ├── sticky.html  → StickyWindow       ← 每条打开的便签一个无边框透明窗口
│   ├── stickyManager.html → Manager      ← 无边框工具窗口：打开/全部/回收站、搜索、模板、数据包
│   └── pages/ StickiesPage               ← 仅 Web 的卡片板页面（能力位门控），同一编辑器
└── web/server                            ← 无需改动：/invoke 分发按用户服务便签命令
```

### 4.1 数据模型（S0）

`sql/schema.sql` 与 `sql/schema_postgres.sql` 必须同步修改（现有 schema 指纹机制会在既有数据库上重跑幂等迁移）。
`documents.id` 在 SQLite 为 `INTEGER` / Postgres 为 `BIGINT IDENTITY` —— 外键跟随各自方言。

```sql
ALTER TABLE documents ADD COLUMN kind       TEXT;   -- NULL/'document' = 普通文档；'sticky' = 便签
ALTER TABLE documents ADD COLUMN deleted_at TEXT;   -- NULL = 在用（回收站支持，F43）

-- 共享的便签身份 —— 随数据库走，Postgres 用户在每台机器看到同一条便签。
CREATE TABLE stickies (
  document_id    <documents-id> NOT NULL PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  color          TEXT    NOT NULL DEFAULT 'yellow',
  corner         TEXT    NOT NULL DEFAULT 'rounded',   -- rounded | square
  opacity        INTEGER NOT NULL DEFAULT 80,          -- 10–100，CSS 表面 alpha（文字保持不透明）
  always_on_top  INTEGER NOT NULL DEFAULT 1,
  font_family    TEXT,
  font_size      INTEGER
);

-- 机器绑定的窗口状态 —— 按设备隔离，绝不跨机器（Windows 的布局在 macOS 上毫无意义）。
CREATE TABLE sticky_windows (
  document_id  <documents-id> NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  device_id    TEXT NOT NULL,                         -- 现有设备注册表 UUID（web 服务端用其自己的 id）
  x INTEGER, y INTEGER,
  w INTEGER NOT NULL DEFAULT 260,
  h INTEGER NOT NULL DEFAULT 480,
  collapsed   INTEGER NOT NULL DEFAULT 0,
  is_open     INTEGER NOT NULL DEFAULT 0,             -- 在「本设备」上是否打开
  updated_at  TEXT NOT NULL (...),
  PRIMARY KEY (document_id, device_id)
);
```

设计规则：

1. **共享**：内容（`documents.content`，BlockNote 风格 blocks）、派生 `title`（取纯文本第一行，≤80 字符
   —— 便签本身无标题）、标签、隐私保护，以及整行 `stickies`。
2. **按设备**：只有 `sticky_windows`。启动时重开「打开中」的便签，只查当前设备的行。
3. tanNotes 的 `z` 列**弃用** —— tanNotes 永远写 0、实际按 `updated_at` 排序；我们按 `updated_at DESC`
   排序，堆叠交还给 OS 管理。
4. 便签行必须从所有普通文档界面中排除：列表、FTS 搜索、Dashboard 统计、导入导出包、localdocs。
   每条 `documents` 查询都要加 `kind`（及 `deleted_at IS NULL`）过滤 —— 用测试保证清查无遗漏（§7）。

### 4.2 核心命令（S0，由 `build.rs` 分发表扫描自动注册）

`sticky_create`（可带种子文档/模板）· `sticky_list`（documents ⋈ stickies ⋈ 当前设备窗口状态的联查）·
`sticky_get` · `sticky_save_content`（复用文档内容更新路径 + 标题派生 + 字数）· `sticky_update_meta` ·
`sticky_update_window_state`（自动限定到当前设备）· `sticky_delete` / `sticky_restore` / `sticky_purge`
（purge 经现有资产清理删除附件）· `sticky_trash_list` · `sticky_search`（对 `kind='sticky'` 的 FTS5，
LIKE 回退 —— 与 tanNotes 同款）· `sticky_bundle_export` / `sticky_bundle_import`（tanNotes JSON 包格式，
与 tanNotes 一致仅含内容）。

### 4.3 桌面窗口（S1–S2，`app/electron/main/stickyWindows.ts`）

- 每条打开的便签一个 `BrowserWindow`：`frame:false, transparent:true, alwaysOnTop, skipTaskbar:true,
  resizable:true, show:false → ready-to-show`，最小尺寸 200×40（标题栏高 40，对齐 tanNotes）。加载
  `app://…/sticky.html?id=…`，走标准 preload 握手。
- 透明：透明窗口之上的 CSS-alpha 便签表面（tanNotes 的做法 —— 文字保持清晰）。macOS 用
  `vibrancy: 'under-window'`；Windows 用 `backgroundMaterial: 'acrylic' | 'mica'`（Win11）；Linux 普通
  半透明、无毛玻璃。设置里提供不透明回退开关（tanNotes 风险 #2）。
- 拖动：标题栏 `-webkit-app-region: drag`；按钮区 `no-drag`。缩放：Windows/Linux 上无边框窗口在窗口
  管理器支持时用原生边缘缩放；**回退方案** = tanNotes 式 8 向边缘把手，调 `stickywin_resize(id, edge, dx,
  dy)`（main 进程执行 `setBounds`）—— S1 spike 定夺。
- 几何持久化：move/resize 防抖保存 + 关闭时冲刷 + `before-quit` 全量保存（对齐 tanNotes
  `persist_all`）。折叠缩到 40px 标题栏高度；数据库里保留完整高度。
- 新便签在光标所在屏幕生成（`screen.getCursorScreenPoint` + `getDisplayMatching`），无存储几何时按
  28px 级联偏移（F8）。
- macOS：`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`（F9）。
- 应用锁交互：应用锁定时隐藏便签窗口（便签终究是文档）。
- IPC 命名：窗口操作用 `stickywin_` 前缀，加入 `app/src/ipc/backend.ts` 的 `MAIN_PROCESS_COMMANDS`；
  数据操作保持 `sticky_*` 走 Rust 分发。命令：`stickywin_new`、`_open`、`_close`、`_set_collapsed`、
  `_arrange('cascade'|'tile')`、`_show_all/_hide_all`、`_print`、`_capture_image`、`_open_manager`、
  `_resize`，以及自启动读写。
- 托盘：扩展 `TrayManager`，加入「新建便签」「便签管理…」「显示/隐藏便签」（沿用托盘现有双语标签模式）。
- 全局快捷键：`sticky_global_shortcut` 设置（默认 `CmdOrCtrl+Alt+N`），完全复用现有 DSH 快捷键的注册与
  「已被占用」回退逻辑（F56/F58）。
- 自启动：`app.setLoginItemSettings({ openAsHidden: true })` + 设置中的可选项（F61）。

### 4.4 渲染层

- 在 `floatingBrowser` 旁新增 Vite 入口：`sticky.html`（`stickyWindowMain.tsx`）与
  `stickyManager.html`（`stickyManagerMain.tsx`）—— 同一多页面模式，同一 `app://` 协议 + preload。
- **StickyWindow**：标题栏（管理器返回钮、调色板弹层、带实时表面预览的透明度滑杆、置顶、折叠、关闭）
  + **现有 `LazyTiptapDocumentEditor` + blockAdapter** + 移植的 Toolbar（格式行、颜色/高亮调色板、
  字体族/字号、页脚字数）+ 400ms 防抖自动保存，失焦/关闭时冲刷（F42 对齐）。
- **管理器窗口**：无边框 + 移植的 `TitleBar`；打开/全部/回收站三个标签页；多选 + 批量
  打开/关闭/恢复/删除/彻底删除（ConfirmDialog）；防抖 FTS 搜索；模板菜单；数据包导入导出按钮；
  快捷键速查（F60）；设置弹层引导到主窗口设置。
- **Web 便签页**：`pageCatalog` 条目 + `NavPage` id `stickies`，由新增 `stickyBoard` 能力位门控
  （仅 web —— 桌面用悬浮管理器）。响应式彩色卡片板；点击就地编辑（同一编辑器）；搜索。
  遵循上一份移动端计划的约定（44px 触控目标、bottom-sheet 安全）。

### 4.5 编辑器对齐（S2）

- `TextInline` 增加可选 `underline`、`highlight`（多色）、`textColor`、`fontFamily`、`fontSize`；
  `inlineAdapter`/`blockAdapter` 映射到 Tiptap 标记（Underline、Highlight multicolor、TextStyle+Color、
  FontFamily、FontSize）—— 正是 tanNotes 工具栏集合（F12–F15、F38–F39）。
- 便签内查找与替换：移植 tanNotes 的 ProseMirror 搜索方案（F22）。Documents 页的查找替换不在本期范围。
- 拼写检查：便签窗口 `webPreferences.spellcheck`（F20）。
- 代码块（Shiki）、表格、mermaid、图片、Markdown 粘贴在 TanWords 中已达到或超过对齐线。

### 4.6 迁移导入器（S4，设置 → 数据 →「导入 tanNotes 数据」，仅桌面）

1. 选择 `tanNotes.db`（默认路径提示：Linux `~/.local/share/com.tannotes.app`、macOS
   `~/Library/Application Support/com.tannotes.app`、Windows `%APPDATA%\com.tannotes.app`）。
2. 预览：N 条在用便签、M 条已删除、K 个附件、发现的设置项。
3. 先备份当前 TanWords 数据库（现有备份机制），然后**单事务**写入：
   - 每条便签：tanNotes 的 Tiptap PM JSON → TanWords blocks，经新的 `tanNotesImport.ts`（映射 underline /
     highlight / color / font 标记、`taskList`/`taskItem`、`codeBlock` 语言；图片：从
     `com.tannotes.app/attachments/<noteId>/…` 读文件 → 插入为文档资产 → 重写 `src`；无法映射的内容优雅降级
     并上报，不丢便签）；
   - `color/corner/opacity/always_on_top/font_*` → `stickies`；`x/y/w/h/collapsed/is_open` → 当前设备的
     `sticky_windows`；`deleted_at` → 回收站；`default.*` 设置 → TanWords 便签默认值。
4. 报告成功/失败；随后执行退役清单（§8）。

## 5. 阶段

### S0 —— 数据与命令地基
双方言 schema、每条 documents 查询的 `kind`/`deleted_at` 清查、便签命令、回收站命令、i18n 词条。
*验收：* `cargo test` 全绿，含新测试（CRUD、按设备状态隔离、回收站往返、kind 过滤）；Documents 页面行为不变。

### S1 —— 便签窗口 MVP + 应用外壳
便签窗口（无边框、透明、置顶、拖动、缩放 spike、自动保存、几何持久化、启动重开）、托盘项、全局快捷键、
悬浮管理器 v1（打开/全部标签，新建/打开/关闭、批量操作）、层叠/平铺、光标屏幕生成、设置 →「便签」分区。
*验收：* tanNotes M1 标准 —— 3 条半透明彩色便签重启后位置/大小/内容原样；快捷键在任意应用前台都能新建便签；
**在本机尽早验证无边框便签内的 CJK 输入法**（tanNotes 风险 #5）。

### S2 —— 窗口与编辑器打磨
透明度滑杆（实时预览）+ 半透明/不透明回退开关、圆角切换、所有 Space 可见、拼写检查、查找替换、字体选择器、
单便签默认字体、打印、复制为 Markdown/图片、模板 + `.md`/`.txt` 导入、自启动、快速帮助。
*验收：* tanNotes M2/M3 界面对齐走查。

### S3 —— 回收站 + 数据工具
回收站标签页（恢复 / 彻底删除并清理附件）、便签 JSON 包导入导出往返、单便签 Markdown/HTML 导出。
*验收：* tanNotes M4 标准 —— 导出 → 清空便签 → 导入 → 完全一致。

### S4 —— 迁移 + 退役
按 §4.6 落地导入器，用本机真实的 `com.tannotes.app` 数据库验证；README 补功能说明；执行退役清单。
*验收：* tanNotes 的每条便签（内容、颜色、几何、图片）都在 TanWords 中且管理器可见；设置项迁移完成。

### S5 —— Web 便签页
`stickyBoard` 能力位、目录条目、响应式卡片板 + 就地编辑 + 搜索、对照 Postgres 的跨设备验证
（内容相同、几何独立）、移动端走查。*验收：* 手机上编辑的便签在桌面便签中实时可见，反之亦然。

（S1–S2 可交错推进；S0 完成后 S5 随时可开工。）

## 6. 验证

```bash
cd app && bun run typecheck && bun run test:run     # 渲染层 + 管理器 + 导入器测试
cd app/core && cargo test                            # schema、命令、按设备隔离、回收站
cd web/server && cargo build                         # web 构建仍可编译（feature = "web"）
```

手工矩阵：重启持久化（3 条便签）；任意应用前台下的快捷键 + 托盘；多显示器光标生成；折叠/展开保持几何；
透明度预览；便签内 CJK 输入法；Postgres 双机共享（内容一致、几何独立）；Web 页编辑 → 桌面便签；
管理器与 Web 页 axe 检查。

## 7. 风险

1. **`kind`/`deleted_at` 清查** —— 漏掉一条 documents 查询就会让便签混进 Documents 或让回收站复活。
   对策：穷举 grep + 按查询族补测试（list/search/dashboard/stats/import）。
2. **无边框缩放/拖动的跨平台差异** —— S1 做 spike；自定义边缘拖拽回退方案已设计好。
3. **Linux 窗口管理器下的透明窗口** —— 半透明做成设置开关，提供不透明回退。
4. **每窗口内存** —— Electron 窗口共享一个 Chromium 进程（比 tanNotes 每窗口 WebKitGTK 便宜）；
   关闭即销毁窗口；S1 实测 10 条打开的便签。
5. **全局快捷键冲突** —— 复用 DSH 快捷键的「加速键被占用」回退。
6. **导入保真度**（嵌套任务、高亮颜色、字体标记、图片绝对路径）—— 用 tanNotes 参考笔记重建验证；
   降级 + 上报，绝不丢便签。
7. **SQLite/Postgres 漂移** —— 两个 schema 文件一起改；指纹重跑机制覆盖升级路径。
8. **应用锁 UX** —— 锁屏绘制前必须先隐藏便签窗口。

## 8. 退役 tanNotes（S4 之后）

1. 本机导入器验证通过（全部便签、图片、回收站、设置）。
2. 卸载 tanNotes（`.deb` / AppImage）；归档仓库 —— 不再开发。
3. `~/.local/share/com.tannotes.app`（及各平台对应目录）作为冷备份保留 ≥ 2 周日常 TanWords 便签使用期，
   之后再删除。

## 9. 明确不做 / backlog（tanNotes 的 P2 项）

点击穿透（F10）· macOS 真 NSPanel（F11）· 便签级密码 UI（F50 —— 底层文档保护已存在）·
便签级提醒（F52 —— 日后映射到 TanWords 日历 + ntfy）· Web PWA/离线 · tanNotes 更新器内部实现
（TanWords 已有自己的更新器）。

---

## 10. 实施状态（构建后备注）

全部阶段已完成（S0–S5）。与原设计的偏差，留档如下：

- **设置位于悬浮管理窗口**（齿轮图标），而非主应用设置页 — 便签是桌面窗口功能；tanNotes 导入入口也在这里。
- **管理窗口 v1 为单列表**，没有 tanNotes 的"打开/全部"标签 — 打开的便签显示 `●` 标记；回收站为可折叠分区（恢复/彻底删除）。
- **便签 = TanWords 文档**（`kind='sticky'`）+ 软删除回收站（`deleted_at`）— 文档与便签共用一个存储层，搜索、附件、保护、Web 端全部复用现有机制。
- **窗口几何按设备存储**（`sticky_windows` 以设备 id 为键）；内容/颜色/透明度/字体全局共享。Bundle 导出携带导出设备的几何信息，与 tanNotes 一致。
- **Web 端为便签看板页**（`stickyBoard` capability，仅 Web；桌面使用悬浮管理窗口 + 系统窗口）— 同一份数据、就地编辑，跨设备经服务器同步。
- **tanNotes 导入器（S4）**：预览 → 备份 → 转换 → 应用；PM-JSON→blocks 转换在渲染端（`tanNotesImport.ts`，复用 TanWords 自己的适配器，标记完整保留），核心端单事务写入（`sticky_tannotes_apply`）。附件：data URI 在渲染端解码；文件经受控主进程通道从 `<dbDir>/attachments/<noteId>/` 读取并转为文档资产。设置迁移映射 `default.color/corner/opacity` 与 `autostart`。
- **快捷帮助**为管理窗口内的弹层（对应 F60）；Electron 快捷键默认 `CommandOrControl+Alt+N`（管理窗口可改），自启动从 `sticky_autostart` 设置恢复。

退役清单（§8）现已可执行：导入器已对本机真实 `~/.local/share/com.tannotes.app/tanNotes.db` 验证。
