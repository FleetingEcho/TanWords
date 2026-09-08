# Plan: Web 手机端 UI 与交互优化

## 目标

让 TanWords Web 版在 360–430px 宽的手机上适合单手、触屏和软键盘操作，同时保持 Electron 与桌面 Web 的现有布局和功能。

本计划基于 2026-09-07 的实际浏览器检查：使用系统 Google Chrome Stable 152，以 390×844、360×640 和 1440×900 视口逐页操作了登录、Dashboard、RSS、文档列表与编辑器、聊天、聊天抽屉和设置页，并运行了 axe WCAG A/AA 检查。

## 已确认的问题

1. 文档列表在 390px Chrome 视口中只有 313px 宽，右侧留下约 77px 空白。原因是移动端仍保留桌面列表外层的 shrink-to-fit Flex 结构和侧边折叠把手。
2. 手机聊天会话抽屉与 `MobileNavDock` 同为 `z-50`；导航在抽屉上方可见并可能接收点击。
3. 手机顶部栏分成两行，高约 88px。RSS、主题、头像等操作与底部导航或设置入口重复，内容区高度被持续占用。
4. 多个高频触控目标只有 20–32px，例如顶部按钮、文档筛选、新建按钮和 Dashboard 的 `View all`。手机端应以至少 44×44px 的实际点击区域为目标。
5. 当前扇形导航在默认少量入口时可用，但入口增加后会拥挤；它还依赖纯图标和展开动画，难以形成稳定的肌肉记忆。
6. 360×640 下，Dashboard 首屏几乎全部被统计卡片、快捷操作、上传和文件管理占据；句子、单词、订阅和最近文档均在首屏之外。
7. Dashboard 手机端仍显示 “Drag and drop”，不符合主要交互方式。
8. 设置页手机端隐藏了分类导航，只剩一个很长的滚动弹窗。
9. 聊天输入区贴近底部导航。项目已有 `useMobileViewportHeight`，但当前未接入聊天页面；真实手机软键盘可能遮住输入区或造成额外空白。
10. axe 检查发现 Dashboard 上传说明 `text-muted-foreground/70` 对比度不足。

## 产品决定

1. 手机导航改为固定底栏：最多 4 个常用入口，加一个“更多”入口。不要继续使用扇形展开作为主导航。
2. “更多”打开底部 Sheet，列出剩余可见页面和设置。入口继续遵循 `sidebarTabOrder`、`visibleSidebarTabs` 和 `hostCapabilities`。
3. 当前页面不在前 4 个入口时，“更多”显示 active 状态；不要临时替换固定入口的位置。
4. 手机顶部栏只保留头像、搜索和搜索模式切换。RSS、主题及其他工具移到“更多”或现有命令面板。桌面顶部栏不变。
5. 手机详情页统一使用“返回、标题、更多操作”的 44–48px 顶栏。
6. 手机弹层分两类：短选择使用底部 Sheet；设置和复杂表单使用接近全屏的 Dialog。所有弹层必须覆盖底部导航。
7. 小屏布局以 360px 宽为最低验收基线，并同时验证 390×844、430×932、横屏和 768px 临界点。

## 实施阶段

### 阶段 1：修复阻断操作的问题

#### 1.1 文档列表满宽

修改：

- `app/src/components/Documents/DocumentsPage.tsx`
- `app/src/components/Documents/DocSelector.tsx`
- `app/src/components/Documents/LocalDocsSidebar.tsx`（保持相同行为）

要求：

- 小于 `lg` 时，列表外层使用确定的 `absolute inset-0 w-full` 或等价结构，不允许依赖循环的 `width: 100%` + shrink-to-fit 计算。
- 手机端隐藏 `ListPanelEdgeHandle`。手机已经通过列表/编辑器切换，不需要桌面折叠把手。
- 桌面仍保留 `LIST_PANEL_WIDTH` 和折叠把手。
- 文档列表和编辑器之间切换时宽度必须始终等于视口内容宽度。

验收：390px 视口中列表根节点宽度为 390px，不出现右侧空白和水平滚动。

#### 1.2 弹层高于底部导航

修改：

- `app/src/components/AiChat/AiChatPage.tsx`
- `app/src/components/Layout/MobileNavDock.tsx` 或新的底栏组件
- 检查 `Dialog`、Popover、文档新建弹窗和其他手机抽屉

要求：

- 建立清晰层级：页面内容 < 顶栏/底栏 < 页面抽屉 < 全局 Dialog/Sheet < Toast。
- 聊天会话抽屉打开时底栏不可见、不可点击。
- 弹层打开后锁定背景滚动；Escape、遮罩点击和关闭按钮行为一致。
- 抽屉或 Sheet 关闭后把焦点还给触发按钮。

### 阶段 2：手机导航和顶部栏

#### 2.1 替换扇形导航

建议新增：

- `app/src/components/Layout/MobileBottomNav.tsx`
- `app/src/components/Layout/MobileMoreSheet.tsx`

修改：

- `app/src/components/Layout/Sidebar.tsx`
- 删除或停止渲染 `MobileNavDock.tsx`；若保留文件，不能再作为主导航入口

底栏要求：

- 固定在可视视口底部，包含 `env(safe-area-inset-bottom)`。
- 导航主体高 56px，每项触控区域至少 44×44px。
- 图标上方或旁边显示短文字，不能只依赖图标。
- 最多显示 4 个固定页面和一个“更多”。固定项来自用户可见顺序，Settings 放在 Sheet 内。
- active、focus-visible、disabled 状态清晰；支持键盘和屏幕阅读器。
- 页面内容的 `padding-bottom` 由一个共享 CSS 变量或常量决定，不在多个组件中重复魔法数字。
- Podcast 播放条出现时，底栏位于播放条上方；两者的占位只计算一次。
- 检测软键盘打开时隐藏底栏，释放输入区域。

“更多”Sheet 要求：

- 从底部打开，宽度 100%，顶部圆角，最大高度不超过可视视口的 75%。
- 每个页面显示图标和名称，行高至少 48px。
- 列出未固定的可见页面、工作区和 Settings；继续执行 capability 过滤。
- 选择后关闭 Sheet 并导航。

#### 2.2 顶部栏压缩为一行

修改：

- `app/src/components/Layout/CommandBar.tsx`
- 可能需要调整 `WordSearchBox` 和 `SentenceSearchBox` 的 inline variant

手机布局：

```text
[头像 44] [搜索框                      ][模式 44]
```

要求：

- 总高度控制在 52–56px，保持一行。
- 搜索输入字体至少 16px，避免 iOS 聚焦自动缩放。
- 搜索模式按钮可整合进输入框右侧，但必须保持 44px 点击区域。
- 移除手机顶部的 RSS 和 Theme 快捷图标；这些入口在底栏/更多 Sheet 中仍可达。
- 加载、分析或锁定等临时状态可显示紧凑状态按钮，但不能挤压搜索框到不可用宽度。
- `lg` 以上保留当前桌面实现和 Electron 窗口控制。

### 阶段 3：Dashboard 手机首屏

修改：

- `app/src/components/Dashboard/DashboardPage.tsx`
- `app/src/components/Dashboard/QuickActionsBar.tsx`
- `app/src/components/Dashboard/UploadsCard.tsx`
- 视需要调整 `DashboardWidgetGrid.tsx`

要求：

- 统计卡片手机端降低高度和 padding：数字、标签仍清晰，单个卡片目标高度约 72–80px。
- Greeting 与日期缩紧垂直间距。
- 将文件上传和 Manage files 合并为一个紧凑卡片或单行入口；手机文案使用“Upload files/上传文件”，桌面才显示 Drag and drop。
- 首屏优先展示可继续操作的内容。建议顺序：Greeting → 统计 → Quick actions → 最近文档/最近阅读；上传入口放到后面。
- 无数据时不要让多个巨大空卡片占据整屏；空状态高度应明显低于有内容卡片。
- `View all` 的可点击区域至少 44px 高，可以用透明 padding 扩大而不改变视觉字号。
- 修复上传说明文字对比度，移除 `/70` 或使用满足当前背景对比度的 token。

### 阶段 4：设置页适配

修改：

- `app/src/components/Settings/SettingsPage.tsx`
- 设置外层 Dialog 的调用处
- `app/src/components/ui/dialog.tsx`（仅在能保持其他 Dialog 兼容时改共享组件）

要求：

- 小于 `sm` 时在 Settings 标题下显示分类选择器。推荐一个 44px 高的 Select，显示当前分类；选中后滚动到对应 section。
- `sm` 以上保留横向 pills。
- 手机 Settings Dialog 使用 `inset-0`、无外边距或最多 8px 外边距，圆角可以缩小，最大高度改用 `100dvh`/可视视口变量。
- 标题栏和分类选择器 sticky；内容独立滚动。
- 各 SettingRow 在窄屏允许 label、说明和 control 上下排列，控件不要被压缩。
- Web 版只显示 Web 可用的 section 和选项；继续遵循现有 capability gate。

### 阶段 5：聊天与软键盘

修改：

- `app/src/components/AiChat/AiChatPage.tsx`
- `app/src/components/AiChat/AiChatComposer.tsx`
- `app/src/components/AiChat/hooks/useMobileViewportHeight.ts`

要求：

- 将 `useMobileViewportHeight` 接入聊天根容器，并同时考虑 `visualViewport.height` 与 `visualViewport.offsetTop`。
- 软键盘打开时，composer 始终在键盘上方，最近一条消息仍可见。
- 键盘打开时隐藏底部导航及其 padding；键盘关闭后恢复。
- 输入框保持 16px 字号，发送、录音、权限按钮至少 44px 点击区域。
- 手机聊天页自己的标题栏由约 24px 提升到 44px；Sessions、Voice、Temporary chat 和 More 按钮都有足够触控区域。
- 会话抽屉宽度可使用 `min(88vw, 360px)`，但关闭按钮、搜索和新建操作至少 44px。
- 处理旋转、地址栏伸缩、键盘关闭和页面返回后的高度恢复，不允许残留空白。

### 阶段 6：全局触控与细节统一

重点检查：

- `DocPanelHeader.tsx`：搜索框、新建、筛选和更多按钮。
- `DocumentsPage.tsx`：返回列表按钮。
- `VocabularyPage.tsx`：手机详情返回栏。
- `FeedsPage.tsx` 及 Feed 工具栏：横向滚动、按钮间距和操作密度。
- `dialog.tsx`、Dropdown、Popover：视口边界和安全区。

要求：

- 高频独立按钮至少 44×44px；密集工具栏至少保证 40px 目标并有 4px 间距。
- 视觉图标可保持 16–20px，通过 padding 扩大点击区域。
- 不依赖 hover 暴露必要操作。
- 保持 `focus-visible`，支持 reduced motion。
- 所有底部固定元素使用安全区；所有长内容只保留一个明确的纵向滚动容器。
- 不能通过 `overflow-x-hidden` 掩盖真实宽度错误；先修布局来源。

### 阶段 7：手机返回行为与详情模式统一

修改：

- `app/src/store/navStore.ts`
- `app/src/App.tsx`
- `app/src/components/Documents/DocumentsPage.tsx`
- `app/src/components/Vocabulary/VocabularyPage.tsx`
- `app/src/components/AiChat/AiChatPage.tsx`
- Settings Dialog 和新的 More Sheet

要求：

- Web 手机端接入 `history.pushState` / `popstate`，让 Android 返回键、浏览器返回按钮和 iOS 返回手势优先处理应用内状态。
- 返回优先级固定为：关闭最上层 Dialog/Sheet → 关闭页面抽屉 → 详情返回列表 → 返回上一应用页面 → 离开应用。
- 不要把每次输入、筛选或滚动写进 history；只记录用户能明确感知的导航层级。
- Electron 保持当前内部导航行为，不依赖浏览器 history。
- 避免 `popstate` 与 store 更新互相触发形成循环；由一个小型 Web history 适配器集中同步。
- 文档、词汇和聊天的手机详情顶栏统一为 44–48px，并统一返回按钮位置、标题截断、更多操作、加载状态和空状态。
- 从详情返回列表时恢复原来的滚动位置和选中项，不能每次回到列表顶部。

验收场景：依次打开文档列表 → 文档详情 → 更多 Sheet → Dialog，连续按返回应逐层关闭，最后回到进入 Documents 之前的页面。

### 阶段 8：移动表单、弱网反馈与内容可读性

#### 8.1 表单和软键盘语义

检查登录、注册、全局搜索、Feed 搜索、文档搜索、聊天输入和 Settings 表单。

要求：

- 使用正确的 `type`、`autocomplete`、`inputMode` 和 `enterKeyHint`。
- 邮箱使用邮箱键盘；数字、时间和 URL 字段使用对应键盘；搜索显示 Search；聊天显示 Send。
- 文本输入字体不低于 16px，防止 iOS Safari/Chrome 聚焦缩放。
- Enter/Search/Send 行为明确，组合输入法 composing 阶段不能误提交。
- 聚焦后输入框和关联错误信息必须处于 visual viewport 内。
- 表单提交期间阻止重复提交；失败后保留全部非敏感输入和当前滚动位置。
- 错误提示靠近对应字段，并通过 `aria-describedby` / live region 提供给辅助技术。

#### 8.2 弱网和异步状态

要求：

- 页面和局部操作使用与其真实范围匹配的 loading 状态，避免用全屏 spinner 阻塞无关内容。
- 加载失败显示就地错误和 Retry；不能把网络错误伪装成“没有数据”。
- 页面切换时保留上一次成功内容，避免短暂闪回空状态。
- 新建文档、保存设置、发送聊天、收藏和上传等 mutation 必须有重复操作保护和明确的成功/失败反馈。
- 用户输入、草稿和待上传选择在可恢复的网络失败后保留。
- `navigator.onLine` 只能用于提示，不作为是否发起请求的唯一依据。

#### 8.3 阅读、文档和富内容

重点检查 Reader、Documents、Vocabulary detail、AI Chat 消息和 Feed article。

要求：

- 手机正文水平 padding 约 16px，并允许用户已有的文档字号和行距设置继续生效。
- 普通段落、长单词、长 URL 和引用不能撑宽页面。
- 表格、代码块、Mermaid 和宽媒体在自己的容器内横向滚动或缩放，不产生页面级横向滚动。
- 图片、视频和 iframe 最大宽度为内容区域宽度，并保持比例。
- 文字选择工具栏根据 visual viewport 和选区位置决定上下方向，不能遮挡选中文字或落到软键盘后面。
- 工具栏操作不能只在 hover 时出现；触屏必须有明确入口。
- 阅读进度和列表滚动位置在进入详情再返回后恢复。

### 后续版本，不纳入本轮

- PWA manifest、安装引导、独立窗口模式和应用图标。
- Service Worker 离线缓存和后台同步。
- Web Push 通知体验的系统级整合。

这些能力值得单独设计缓存失效、版本升级和权限流程，不应与本轮响应式 UI 修改一起上线。

## 建议的共享实现

避免在每个页面单独计算手机高度和底部占位。建议增加一个小的移动视口模块：

- `useMobileVisualViewport()`：返回 `{ height, offsetTop, keyboardOpen }`。
- 在根布局设置 CSS 变量：`--mobile-visual-height`、`--mobile-nav-height`、`--mobile-bottom-inset`。
- MainLayout、BottomNav、Podcast bar、Chat composer 共同消费这些变量。
- `keyboardOpen` 应根据 visual viewport 与 layout viewport 的高度差设置合理阈值，例如大于 120px；旋转和浏览器地址栏变化不能误判为键盘。

该模块只负责测量与变量，不承载页面业务逻辑。

## 自动化测试

新增或更新：

- `app/src/components/Layout/Sidebar.test.tsx`
  - 窄屏渲染 BottomNav，不渲染桌面 sidebar。
  - 固定项最多 4 个，剩余项进入 More。
  - capability 和用户排序过滤正确。
- `app/src/components/Layout/MobileBottomNav.test.tsx`
  - active 状态、更多 Sheet、导航、焦点恢复。
  - 键盘打开时隐藏。
- `app/src/components/Documents/DocumentsPage.test.tsx` 或现有相关测试
  - 移动端列表/编辑器互斥，折叠把手不出现。
- `app/src/components/AiChat/AiChatPage.test.tsx`
  - 抽屉覆盖底栏。
  - visual viewport resize 后 composer 高度更新。
- `app/src/components/Settings/SettingsPage.test.tsx`
  - 手机分类选择器可跳转；桌面 pills 仍存在。

不要编写只断言 Tailwind 字符串的脆弱测试。优先测试可见性、ARIA 状态、导航结果和关键 DOM 几何约束。

## Chrome 手工验收矩阵

必须使用真正的 Google Chrome，而不是 Electron renderer。开发命令：

```bash
cd app
CHOKIDAR_USEPOLLING=1 bun run dev:web
```

视口：

- 360×640：最低手机基线。
- 390×844：主要验收尺寸。
- 430×932：大屏手机。
- 844×390：手机横屏。
- 768×1024：当前 `lg`/tablet 临界行为。
- 1440×900：确认桌面无回归。

逐项操作：

1. 登录、注册、错误提示和输入键盘。
2. Dashboard 滚动、统计入口、上传和最近内容。
3. BottomNav 每个固定入口和 More Sheet。
4. RSS 卡片/列表切换、搜索、筛选、文章操作。
5. 文档列表、新建、打开、返回、编辑、Zen mode。
6. 词汇列表与详情。
7. 聊天会话抽屉、输入、软键盘、发送、关闭键盘。
8. Settings 分类跳转、表单、Select、Slider、图片选择。
9. Podcast bar 与 BottomNav 同时出现。
10. 深色/浅色、自定义背景、安全区和横屏。
11. 使用浏览器/系统返回逐层关闭 Dialog、Sheet、抽屉和详情，并确认列表滚动位置恢复。
12. 在网络限速和临时断网条件下检查加载、重试、重复提交保护和输入保留。
13. 检查邮箱、搜索、数字、时间和聊天字段的移动键盘类型与 Enter 行为。
14. 用包含长 URL、宽表格、代码块、图片和 Mermaid 的内容检查页面级横向滚动。

同时执行：

- Chrome DevTools Device Mode 的 touch 模拟。
- axe WCAG A/AA 检查。
- 检查控制台错误和未处理 Promise。
- 检查页面级水平滚动：`document.documentElement.scrollWidth === innerWidth`。
- 抽样测量触控目标尺寸。

## 验证命令

```bash
cd app
bun run typecheck
bun run test:run
bun run build
```

## 完成标准

1. 360px 宽时没有页面级横向滚动或非预期空白。
2. 文档列表、编辑器、聊天抽屉和 Settings 均使用完整可用宽度。
3. 主导航无需展开动画即可单手到达常用页面，其余页面在一次点击后的 Sheet 中可见。
4. 手机顶部栏只有一行，搜索可正常输入且不会触发 iOS 自动缩放。
5. 关键触控目标至少 44×44px，密集工具栏不低于 40px。
6. 软键盘不会遮住聊天输入、发送按钮或当前编辑区域。
7. 任意抽屉/Dialog 打开时，底部导航不可见且不可点击。
8. 360×640 Dashboard 首屏能看到至少一个可继续使用的内容区域或明确的紧凑空状态。
9. axe 不再报告已确认的上传说明对比度问题。
10. 768px 以上桌面/平板布局和 Electron 窗口控制无回归。
11. Android 返回键、Chrome 返回按钮和 iOS 返回手势遵循统一的应用内返回层级。
12. 登录、搜索、聊天和设置输入使用正确的移动键盘语义，失败后不丢失用户输入。
13. 弱网或请求失败时有就地重试，空状态不会掩盖网络错误，mutation 不会重复提交。
14. 长 URL、宽表格、代码块、图片和 Mermaid 不会撑宽手机页面。

## 实施注意事项

- 当前 Tailwind 将 `lg` 自定义为 48rem（768px）。不要假设默认 Tailwind 的 1024px `lg`。
- Web 与 Electron 共用 React 源码。所有手机变更以 viewport/input 能力为条件，不要用 Web host 判断来替代响应式布局；仅功能可用性继续使用 `hostCapabilities`。
- 保留用户现有 sidebar 排序与可见性设置，不能另建第二份手机导航配置。
- 不要一次重写所有页面。按上述阶段提交，每阶段完成后运行真实 Chrome 检查。
- 工作区在 compact 模式下也使用新 BottomNav；确认自定义 workspace 仍可从 More Sheet 进入。
