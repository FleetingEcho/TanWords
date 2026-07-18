# 本地音乐库设计

日期：2026-07-17
状态：已确认

## 目标

用户在设置里指定一个本地音频文件夹（mp3/wav 等本地音频、录音），新增「音乐」页面浏览并播放其中的音频。未设置路径时页面引导用户去设置。

## 需求（已与用户确认）

- 递归扫描子文件夹，按一级子文件夹分组为「合集」
- 播放能力：播完自动下一首、单曲循环、列表循环、随机播放（不做播放位置记忆）
- 复用底部全局播放条（PodcastPlayerBar），切页面继续播
- UI 走「封面墙 Gallery」方向：拒绝传统左右双栏；合集卡片用名称 hash 确定性生成渐变封面；合集详情为页内切换的沉浸式曲目页

## 架构

### 1. 设置项

- `SettingsPage` 新增「音乐」区块：一行「音乐文件夹」，按钮调 `openDialog({ directory: true })` 选目录，支持更换/清除
- 路径存 `user_settings` 表，key `music_folder_path`，经 `settingsStore` 现有 `saveSetting` 模式持久化并随 `loadFromDB` 加载

### 2. 后端扫描（Rust）

- 新 command `music_scan_library(root: String)`（`app/src-tauri/src/music.rs`）
- 递归遍历 root，按扩展名过滤：mp3 / wav / m4a / flac / ogg / aac
- 用 `lofty` 读取时长与标签（title/artist），失败回退文件名
- 返回按一级子文件夹分组的合集列表；根目录散文件归入「未分类」合集；更深层文件归入其一级祖先文件夹
- 不建库表：每次进页面即时扫描（本地目录，速度足够，免同步问题）
- 路径不存在/不可读返回错误，由前端展示

返回结构：

```ts
interface MusicTrack { path: string; title: string; artist: string | null; durationSec: number | null; }
interface MusicCollection { name: string; tracks: MusicTrack[]; }
```

### 3. 播放（改造 podcastPlayerStore）

- 音频经 Tauri asset protocol（`convertFileSrc`）喂给现有 `<audio>` 管线；tauri.conf 开启 assetProtocol 并放开 scope
- store 新增：`playlist: Track[] | null`、`currentIndex`、`playMode: "order" | "loop-one" | "loop-all" | "shuffle"`
- `ended` 事件按模式选下一首；顺序模式播到末尾停止
- 本地曲目复用现有 track 结构（title=曲名，feedTitle=合集名）→ 底部播放条、TTS 互斥、回到来源页零成本复用
- 无队列（播客单集）时行为完全不变
- 播放条在有队列时显示上一首/下一首按钮

### 4. 页面 UI（`app/src/components/Music/`）

- **MusicPage**：主页封面墙。每合集一张大卡片：hash 渐变封面（同名同色，与主题色系协调）、合集名、曲目数；hover 浮起并显示播放按钮
- **合集详情**：页内切换（非弹窗/抽屉）。顶部同款渐变横幅 + 「播放全部」「随机播放」+ 循环模式切换；曲目行（序号/曲名/时长），当前播放行高亮 + 音符跳动指示
- **空状态（未设置路径）**：整页大图标 + 提示文案 + 跳转 Settings 按钮
- **错误态（路径失效/扫描失败）**：页内提示 + 重新选择入口
- 侧边栏新增「音乐」入口；i18n 新增 en/zh `music.ts`

## 范围外（YAGNI）

播放位置记忆、收藏/歌单、专辑封面图提取、曲目入库、文件监听自动刷新（手动刷新按钮代替）。

## 测试

- 渐变封面生成（hash → 颜色确定性）单测
- playlist 下一首选择逻辑（各 playMode）单测
- Rust 扫描分组逻辑单测（临时目录构造文件树）
