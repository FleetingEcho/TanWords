# Scene Lab: 3D 场景词汇学习设计

## 目标

新增“场景学习 / Scene Lab”页面，用可交互的 3D 空间帮助用户建立词汇的空间记忆、语义联系和任务顺序。首版只提供一个精制的低多边形 Kitchen 场景，并由 AI 根据用户的 CEFR 设置动态生成单词、搭配、动作句和学习任务。

该功能必须形成完整学习闭环：探索场景、主动回忆、识别薄弱词、选择加入现有 Vocabulary、进入 FSRS 长期复习。3D 是记忆线索，不是装饰性关系图。

## 产品范围

### MVP 包含

- 一个低多边形 Kitchen 3D 场景，约 15–25 个有稳定标识的可交互物体。
- AI 根据用户 CEFR、已有词库和场景物体清单生成单词、搭配、动作句与任务链。
- 探索、语义、任务、测试四种视角，共享同一个 3D 空间。
- 空间、语义和任务三类关系。
- 场景课程、生成内容和学习进度永久保存。
- 学习中随时收藏，以及结束后根据表现批量推荐薄弱词。
- 收藏后写入现有 Vocabulary，并复用 enrichment、TTS 和 FSRS。
- 3D 无法加载时的对象列表降级模式。

### MVP 不包含

- 任意场景的 3D 自动生成或动态模型拼装。
- 独立的三维关系星图或 D3.js。
- VR、AR、多人、排行榜、复杂物理模拟。
- 用户编辑 3D 场景。
- Kitchen 之外的精制场景。

## 核心用户流程

主导航新增 Scene Lab。首页展示“我的场景”，Kitchen 卡片显示课程进度、已学习词数和下次建议回访时间。首版其他场景只显示 Coming Soon。

进入 Kitchen 后，页面采用主场景加侧栏结构：

```text
┌─────────────────────────────────────────────────────────┐
│ Kitchen · 探索 / 语义 / 任务 / 测试     进度 12/30      │
├──────────────────────────────────┬──────────────────────┤
│                                  │ 当前对象：Sink       │
│          3D Kitchen              │ sink /sɪŋk/ 水槽     │
│                                  │ rinse vegetables     │
│  旋转、缩放、移动、点击物体       │ running water        │
│                                  │ “Rinse them…”        │
│                                  │ [播放] [加入词库]     │
├──────────────────────────────────┴──────────────────────┤
│ 学习任务 / 提示 / 当前反馈                 [结束本轮]    │
└─────────────────────────────────────────────────────────┘
```

四种视角的职责如下：

- 探索：自由点击物体，查看发音、中文释义、搭配和动作句。
- 语义：按 appliances、cookware、ingredients、actions 等类别组织内容，并在场景中显示有限的关系连线。
- 任务：按顺序完成场景操作，例如寻找锅、接水、找到炉灶、选择 boil。
- 测试：隐藏标签，根据发音、中文释义或动作句在空间中定位对象。

一轮结束后显示用时、掌握词、薄弱词和推荐收藏项。用户可调整选择后批量加入 Vocabulary，也可在学习过程中逐词收藏。

## 3D 场景架构

使用 React Three Fiber 作为 React 与 Three.js 的集成层，使用 Drei 提供相机控制、标签和加载辅助。MVP 的 Kitchen 用代码原生低多边形几何体组成，随 Scene Lab 按需加载，不影响其他页面启动；以后可替换为 GLB/GLTF 美术资产。

每个可学习对象都是独立 R3F 节点，拥有稳定的 `object_key`，并与 manifest 及数据库记录一致，例如 `sink`、`faucet`、`refrigerator`、`stove` 和 `cutting_board`。未来换用 GLB 时继续沿用这些节点名。

```text
用户点击 R3F 对象节点
        ↓
解析 object_key
        ↓
查询对应场景词汇
        ↓
高亮对象并轻微聚焦相机
        ↓
侧栏显示学习内容并支持 TTS/收藏
```

模型采用低多边形视觉风格。颜色用于清晰辨识对象和适度提示薄弱项。低性能设备可关闭阴影、关系线和非必要动画。

## AI 生成边界

应用先从 Kitchen manifest 读取允许的 `object_key`、对象标签和预定义动作。AI 只能引用该清单，不负责生成模型、坐标或任意动作。

生成输入包括：

- 用户目标 CEFR。
- Kitchen 对象与动作清单。
- 用户已拥有或已知词汇的去重列表。
- 需要生成的词数和内容类型。
- prompt schema 和版本。

生成结果采用严格结构化 JSON，至少包含：

- 词、中文释义、IPA、CEFR、类别和重要性。
- 关联的 `object_key`。
- 常用搭配、动作句及中文解释。
- `located_near`、`used_for`、`followed_by`、`belongs_to` 等允许的关系。
- 仅由预定义动作构成的任务步骤。

保存前执行 schema 校验、对象引用校验、关系类型校验和大小写归一化。不存在的对象、动作或非法关系只丢弃对应项目；有效项目仍可保存。生成后课程永久保存，重新进入不调用 AI。用户可以显式选择扩充课程或按当前水平重新生成新版本。

## 数据模型

现有 `words` 表继续作为唯一全局词库。场景中尚未收藏的内容不得提前污染 `words`。

### `scenes`

- `id`
- `name`
- `scene_type`
- `asset_path`
- `generation_version`
- 创建和更新时间

### `scene_objects`

- `id`
- `scene_id`
- `object_key`，在场景内唯一
- `label`
- `position_xyz`
- `metadata_json`

### `scene_lessons`

- `id`
- `scene_id`
- `target_levels`
- `status`
- `prompt_version`
- `generated_at`

### `scene_vocabulary`

- `id`
- `lesson_id`
- `object_id`
- 可空的 `word_id`，收藏后关联 `words.id`
- `word`、`zh`、`ipa`
- `category`、`importance`
- `learning_status`

### `scene_examples`

- `id`
- `scene_vocabulary_id`
- `kind`：`collocation`、`action` 或 `sentence`
- `content_en`
- `content_zh`

### `scene_relations`

- `lesson_id`
- `source_type`、`source_key`
- `relation`
- `target_type`、`target_key`

### `scene_tasks`

- `id`
- `lesson_id`
- `title_en`、`title_zh`
- `steps_json`，仅保存通过 manifest 校验的有限状态步骤
- `sort_order`

### `scene_sessions`

- `id`
- `lesson_id`
- `mode`
- `started_at`
- `completed_at`

### `scene_attempts`

- `session_id`
- `scene_vocabulary_id`
- `mode`
- `correct`
- `response_ms`
- `hints_used`
- `attempted_at`

关系表使用受控的 source/target 类型和 relation 枚举，不接受任意字符串。每轮学习先创建 session，所有 attempt 归属于该 session，结束报告只聚合当前 session。数据库迁移应建立外键、必要索引和唯一约束。

## Vocabulary 与 FSRS 集成

`scene_vocabulary.word_id` 初始为空。用户收藏时：

1. 归一化单词并查询现有 `words`。
2. 已存在时直接关联其 ID，不重复插入。
3. 不存在时通过现有数据库 API 创建 `words` 和 `word_definitions`。
4. 保存场景搭配和动作句作为 enrichment 的上下文输入。
5. 触发现有 enrichment 流程。
6. 后续长期复习由现有 FSRS 管理。

批量收藏必须使用单个数据库事务。场景熟悉度和 FSRS 调度相互独立：前者衡量空间/任务表现，后者负责长期复习时间。

## 学习与推荐机制

场景内状态为：

```text
New → Learning → Familiar → Mastered
         ↑           │
         └─ 答错 ────┘
```

状态由可解释的规则计算，输入包括正确率、反应时间、提示次数、连续错误和延迟回访表现。MVP 不使用黑盒模型计算熟悉度。

结束时只推荐以下内容：

- 尚未关联 `words.id`。
- 状态为 New 或 Learning。
- 本轮出现错误、反应较慢或使用提示。
- 重要性达到课程设定阈值。

用户始终拥有最终选择权。推荐不会自动写入 Vocabulary。

## 任务执行

任务使用有限状态机执行。AI 生成的步骤必须来自 manifest 的对象和动作集合，客户端负责逐步验证。

```text
find(pot)
   ↓
find(faucet)
   ↓
select(fill)
   ↓
find(stove)
   ↓
select(boil)
```

AI 不在任务运行期间实时控制场景。错误选择提供反馈和可选提示，但不自动跳过步骤。

## 错误处理与降级

- AI 请求失败：保留已有课程和进度，允许显式重试。
- AI 部分输出无效：保存通过校验的项目，汇总被丢弃项目数量。
- 没有配置 AI provider：引导用户到 Settings，不创建空课程。
- WebGL 创建或场景渲染失败：切换到按对象分组的列表模式，保留学习、TTS、测试和收藏能力。
- 词汇已存在：关联现有记录并提示，不重复创建。
- 批量收藏失败：事务回滚，不产生半完成状态。
- 模型版本升级：通过稳定 `object_key` 迁移记录；无法映射的旧对象保留历史数据但不在 3D 中显示。

## 测试策略

- 单元测试：AI schema 校验、对象/关系过滤、去重、熟悉度状态转换和推荐规则。
- 数据库测试：迁移、约束、课程持久化、已有词关联、批量收藏及事务回滚。
- React 组件测试：模式切换、词卡、任务步骤、提示和结束报告。
- 3D 交互测试：节点到 `object_key` 的映射、点击、高亮、相机聚焦和缺失节点处理。
- 集成测试：生成 Kitchen 课程、完成测试、收藏推荐词、确认 Vocabulary 可见。
- 手动检查：首次加载时间、常见桌面尺寸、键鼠操作、低性能降级和列表模式。

## 成功标准

MVP 完成需满足：

- 用户能生成并永久保存一份与其 CEFR 匹配的 Kitchen 课程。
- 3D 中至少 15 个对象可以稳定选择并映射到学习内容。
- 用户可以完成一轮探索、任务和空间定位测试。
- 系统能依据行为推荐薄弱词，但不自动收藏。
- 单个和批量收藏均能正确去重并进入现有 Vocabulary/FSRS。
- 重启应用后课程、尝试记录和进度仍存在。
- 3D 不可用时仍能完成非空间学习流程。

## 后续路线

1. 根据 Kitchen MVP 的记忆效果和性能反馈修正学习规则。
2. 增加 Airport 和 Office 等预制场景。
3. 增加场景热力图和跨日自适应回访。
4. 为任意主题提供 3D 关系星图降级方案。
5. 建立可复用模型资产库，再评估 AI 动态拼装场景。
