# Knowledge Map：视觉重新设计（空状态页 + 详情页）

## 目标

当前 Knowledge Map（Scene Lab 页面）的空状态页和详情页视觉上过于单薄、缺乏产品感：空状态页大片留白、没有引导新用户输入什么内容；详情页的分类卡片在生成过程中容易让用户误以为"卡住了"。本次只做视觉与信息组织层面的重新设计，不改变已有的数据模型、生成逻辑和交互流程（拖拽画布 `KnowledgeMapCanvas` 仍保持不使用，不在本次范围内）。

设计方向已通过可视化原型确认：空状态页选定"Editorial Hero"方向，详情页选定"分类色带 + 强化主题卡片视觉层级"方向。

## 范围

### 包含

- 空状态页（未打开任何地图时的首屏）重新设计：
  - 保留衬线大标题，背景加入淡淡的点阵纹理（呼应地图的"点"视觉，与 `KnowledgeMapCanvas` 背景的点阵网格同源）。
  - 输入框下方增加可点击的示例词条（复用 placeholder 里已经列出的例子：kitchen、job interview、distributed systems、bank），点击即可填入输入框，帮助不知道输什么的新用户。
  - "我的地图"卡片按 `root_type` 加左侧色带（word/topic/situation 三种颜色，复用 `KnowledgeOutline`/`KnowledgeMapCanvas` 里已有的 DOT/COLORS 配色），展示节点数与相对更新时间（如"2 小时前"），而不是绝对时间戳。
- 详情页（打开地图后的 Outline + 主题卡片 + 分类卡片视图）重新设计：
  - Outline 每一行前面加类型色点，颜色与空状态页卡片色带、以及 `KnowledgeMapCanvas` 的 COLORS 常量保持同一套配色，不再各处各自定义。
  - 根节点主题卡片（如 "kitchen"）背景加一层淡紫色渐变，突出"这是一张地图的入口"而非普通分类卡片。
  - 分类卡片在其内容还在生成中时，用一条渐变进度条 + "AI 生成中…" 文案替代当前的骨架块占位，观感上更接近"正在为你准备"，而不是空白/骨架。
  - 主题卡片里已有的概述文字 + 精选单词/例句预览（上一轮已实现）保留，视觉上纳入新的卡片样式。
- 统一配色来源：把 `KnowledgeOutline.tsx` 里的 `DOT` 常量和 `KnowledgeMapCanvas.tsx` 里的 `COLORS` 常量合并成 `features/knowledge-map` 下的一个共享常量（如 `NODE_KIND_COLORS`），避免两处硬编码同一份颜色导致以后改一处漏一处。

### 不包含

- 不改变地图的生成逻辑、分支预设、AI 调用方式（上两轮已完成的部分）。
- 不改变 `KnowledgeMapCanvas`（画布视图）的启用状态——它依旧不接入主流程。
- 不新增数据库字段或迁移；相对时间展示（"2 小时前"）只在前端对已有的 `updated_at` 字符串做格式化，不改动后端。
- 不改变已有交互流程：搜索/探索、批量加入词库、展开分支等功能保持不变，只调整外观和信息排布。
- 不做响应式/移动端适配之外的额外布局工作（沿用应用现有的桌面单窗口布局假设）。

## 空状态页设计细节

```text
INFINITE KNOWLEDGE MAP
Infinite Knowledge Map
输入任意单词、场景或主题，快速展开相关英语知识。

[ 输入框                                    ] [ 生成知识地图 ]
试试看  🍳 kitchen  💼 job interview  🌐 distributed systems  🏦 bank

我的地图
┌─────────────────┐ ┌─────────────────┐
│▎kitchen          │ │▎interview        │
│ 单词 · 36 节点   │ │ 主题 · 82 节点   │
│ 2 小时前         │ │ 昨天             │
└─────────────────┘ └─────────────────┘
```

- 示例词条是纯展示 + 点击填充输入框的静态列表（沿用 placeholder 里的四个例子），不需要额外状态或持久化。
- 卡片左侧色带宽度 3px，颜色取自 `NODE_KIND_COLORS.word/topic/situation`（对应 `root_type`）。
- 相对时间使用已有的日期库（项目中已引入 `date-fns`）格式化 `updated_at`，无需新依赖。
- 生成中的进度条（`generating` 状态）逻辑不变，仍在标题下方，只是随新布局微调位置。

## 详情页设计细节

- `KnowledgeOutline.tsx`：每一行的圆点颜色从 `DOT` 常量改为共享的 `NODE_KIND_COLORS`。
- `KnowledgeBoard.tsx` 根节点卡片：
  - 卡片背景增加 `bg-gradient-to-br from-primary/10 to-transparent`（或等效的 CSS 渐变），其余结构（标题、译文、CEFR 徽章、加入词库按钮）不变。
  - 概述文字块、精选单词 chip、精选例句（上一轮已实现的部分）保持在同一张卡片内，样式上与新背景协调即可，不改变数据来源。
- `KnowledgeBoard.tsx` 分类卡片的"生成中"占位：
  - 用一条 4px 高的渐变进度条 + "AI 生成中…" 文案替换当前 `animate-pulse` 骨架网格。
  - 进度条本身是不确定进度的视觉效果（persistent indeterminate animation），不需要绑定真实百分比（分类级别没有精确的完成度数据，只有"还没有子节点 + 整体 generating=true"这一个信号）。
- `NODE_KIND_COLORS` 新增共享常量放在 `app/src/features/knowledge-map/colors.ts`，导出后 `KnowledgeOutline.tsx`、`KnowledgeBoard.tsx`（如需要）、`KnowledgeMapCanvas.tsx` 都改为引用它，删除各自原有的重复定义。

## 兼容性

纯前端展示层改动，不涉及数据库结构或已保存地图数据，旧地图打开后直接按新样式渲染。

## 测试策略

- 单元测试：`NODE_KIND_COLORS` 常量本身以及颜色查找的边界情况（未知 kind 时的兜底）。
- 手动检查：
  - 空状态页在有/无历史地图两种情况下的展示。
  - 点击示例词条能正确填入输入框。
  - 三种 `root_type`（word/topic/situation）的地图卡片色带颜色正确对应。
  - 详情页在生成中/生成完成两种状态下的视觉表现（进度条 → 真实内容的过渡）。

## 成功标准

- 空状态页不再是"大片留白 + 一个输入框"，新用户能通过示例词条快速上手。
- "我的地图"列表能一眼看出每张地图的类型和新鲜度（相对时间）。
- 详情页生成中的分类不再看起来像"卡住了"或"空的"，而是清晰传达"正在生成"。
- 颜色定义只有一处来源，不存在两份可能不同步的硬编码色值。
