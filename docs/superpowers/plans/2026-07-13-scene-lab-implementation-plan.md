# Scene Lab 实施计划

> 对应设计：[2026-07-13-scene-lab-design.md](../specs/2026-07-13-scene-lab-design.md)

## 实施原则

- 按可独立验证的纵向增量推进，每个阶段保持 `npm run build` 和 Rust 测试通过。
- 先固定 Kitchen manifest、数据库和 AI schema，再开发 3D UI。
- `words` 是唯一全局词库；场景生成结果只有收藏后才进入 Vocabulary。
- 3D 页面按需加载。WebGL/模型失败必须保留列表学习模式。
- 新增模块保持边界清晰，避免继续扩大 `useDB.core.ts` 和 `useDB.extra.ts`。

## 任务 1：建立前端测试基础与安装 3D 依赖

**修改文件**

- `app/package.json`
- `app/package-lock.json`
- `app/vite.config.ts`
- 新建 `app/src/test/setup.ts`

**工作内容**

1. 增加运行时依赖 `three`、`@react-three/fiber`、`@react-three/drei`。
2. 增加开发依赖 `vitest`、`jsdom`、`@testing-library/react`、`@testing-library/jest-dom`、`@types/three`。
3. 增加 `test` 和 `test:run` scripts，并在 Vite 配置中启用 jsdom 与 setup 文件。
4. 写一个最小 smoke test，确认路径别名、React 渲染和测试环境可用。

**验证**

```bash
cd app && npm run test:run
cd app && npm run build
```

## 任务 2：定义 Kitchen manifest 与共享类型

**新建文件**

- `app/src/features/scene-lab/types.ts`
- `app/src/features/scene-lab/kitchenManifest.ts`
- `app/src/features/scene-lab/kitchenManifest.test.ts`
- `app/src/assets/scene-lab/kitchen.glb`

**工作内容**

1. 定义场景、物体、课程、词汇、例句、关系、任务步骤、尝试记录和学习状态的 TypeScript 类型。
2. manifest 固定 Kitchen 的场景 ID、资产路径、15–25 个 `object_key`、中英文标签、类别和允许动作。
3. GLB 每个可交互节点名称必须与 `object_key` 一致；环境网格使用保留前缀，不参与选词。
4. 加入 manifest 校验：`object_key` 唯一、任务动作受控、必需对象存在、GLB 映射清单完整。
5. 测试 manifest 的稳定性，防止资产改名破坏已有学习记录。

**验证**

```bash
cd app && npm run test:run -- kitchenManifest
```

## 任务 3：增加 Scene Lab 数据库迁移

**修改文件**

- `app/src-tauri/src/db/migrations.rs`

**新建文件**

- `app/src-tauri/tests/scene_lab_migration_smoke.rs`

**工作内容**

1. 增加 migration version 12，创建：
   - `scenes`
   - `scene_objects`
   - `scene_lessons`
   - `scene_vocabulary`
   - `scene_examples`
   - `scene_relations`
   - `scene_tasks`
   - `scene_sessions`
   - `scene_attempts`
2. 为外键设置合理的 `ON DELETE` 行为。
3. 建立 `(scene_id, object_key)`、课程状态、词汇 lesson/object、attempt 时间等索引和唯一约束。
4. 使用 CHECK 约束限制状态、例句类型和关系类型；布尔值存为 0/1。
5. smoke test 在临时 SQLite 中运行 `init_db`，检查所有表、索引、外键，并验证迁移重复运行安全。

**验证**

```bash
cd app/src-tauri && cargo test --test scene_lab_migration_smoke
```

## 任务 4：实现 Rust 场景数据库 API

**新建文件**

- `app/src-tauri/src/db/scene_lab.rs`
- `app/src-tauri/tests/scene_lab_db_smoke.rs`

**修改文件**

- `app/src-tauri/src/db/mod.rs`
- `app/src-tauri/src/lib.rs`

**命令 API**

- `db_list_scenes`
- `db_get_scene_lesson`
- `db_save_scene_lesson`
- `db_start_scene_session`
- `db_save_scene_attempt`
- `db_finish_scene_session`
- `db_get_scene_progress`
- `db_add_scene_words_to_vocabulary`

**工作内容**

1. 使用专门的 serde 输入/输出结构，不向前端泄露数据库行实现细节。
2. `db_save_scene_lesson` 在一个事务内保存课程、词汇、例句、关系和任务；重复的 generation key 不重复创建。
3. start/finish session 命令界定一轮学习；`db_save_scene_attempt` 追加归属于 session 的不可变记录，并更新词汇的派生学习状态。
4. `db_add_scene_words_to_vocabulary` 在单个事务中：
   - 归一化和去重输入 ID。
   - 复用或创建 `words`。
   - 创建缺失的 definition 和 SRS record。
   - 将场景词回填到 `word_id`。
   - 返回 added、linked、skipped 和逐词结果。
5. 在 `db/mod.rs` 导出模块，并在 `lib.rs` 注册所有 Tauri commands。
6. Rust 集成测试覆盖保存/读取、重复课程、已有词关联、全新词创建和事务回滚。

**验证**

```bash
cd app/src-tauri && cargo test --test scene_lab_db_smoke
cd app/src-tauri && cargo test
```

## 任务 5：增加前端数据库适配层

**新建文件**

- `app/src/hooks/useDB.sceneLab.ts`
- `app/src/hooks/useDB.sceneLab.test.ts`

**修改文件**

- `app/src/hooks/useDB.ts`
- `app/src/hooks/useDB.types.ts`

**工作内容**

1. 在共享类型中加入数据库返回 DTO，或从 Scene Lab 类型模块显式导入公共 DTO。
2. `useDBSceneLab` 封装任务 4 的 invokes，并统一使用现有 `logError` / `reportWriteError`。
3. `useDB()` 组合 core、extra 和 sceneLab；保持现有调用方不变。
4. 测试命令名、参数 camelCase 映射、错误时的安全返回值和写错误上报。

**验证**

```bash
cd app && npm run test:run -- useDB.sceneLab
cd app && npm run build
```

## 任务 6：实现 AI 课程 schema、校验和生成 hook

**新建文件**

- `app/src/features/scene-lab/generation/schema.ts`
- `app/src/features/scene-lab/generation/prompts.ts`
- `app/src/features/scene-lab/generation/validateLesson.ts`
- `app/src/features/scene-lab/generation/validateLesson.test.ts`
- `app/src/features/scene-lab/hooks/useSceneLessonGenerator.ts`

**复用文件**

- `app/src/hooks/useDiscover.ts`
- `app/src/providers/select.ts`
- `app/src/store/settingsStore.ts`

**工作内容**

1. 从旧 `useDiscover` 提取或复用 JSON 修复逻辑，避免复制不一致的模型解析器。
2. prompt 输入仅包含 manifest 中允许的对象/动作、目标 CEFR 和最多 200 个排除词。
3. schema 包含词汇、例句、关系和有限状态任务；为生成格式设置 `prompt_version`。
4. 校验并归一化：非法 object/action/relation 被逐项剔除；重复词合并；孤立例句和任务步骤被移除。
5. 生成成功后调用数据库保存；失败时不创建空课程。
6. 单元测试使用损坏 JSON、未知对象、非法动作、重复词和部分有效结果。

**验证**

```bash
cd app && npm run test:run -- validateLesson
cd app && npm run build
```

## 任务 7：实现 Scene Lab 导航与场景库页面

**新建文件**

- `app/src/components/SceneLab/SceneLabPage.tsx`
- `app/src/components/SceneLab/SceneLibrary.tsx`
- `app/src/components/SceneLab/SceneLibrary.test.tsx`

**修改文件**

- `app/src/store/navStore.ts`
- `app/src/components/Layout/Sidebar.tsx`
- `app/src/components/ui/icons.tsx`
- `app/src/App.tsx`
- `app/src/i18n/en/nav.ts`
- `app/src/i18n/zh/nav.ts`
- `app/src/i18n/en/index.ts`
- `app/src/i18n/zh/index.ts`

**工作内容**

1. 增加 `scene-lab` 导航类型、图标、双语标签和 App 页面分支。
2. 对 Scene Lab 页面使用 `React.lazy` 和 Suspense，确保 Three.js 不进入普通页面的初始 chunk。
3. 场景库读取已有课程和进度；Kitchen 可开始/继续，其他场景显示 Coming Soon。
4. 没有 AI provider 时，生成按钮引导到 Settings。
5. 测试首次状态、继续学习、生成中、失败提示和 Coming Soon 状态。

**验证**

```bash
cd app && npm run test:run -- SceneLibrary
cd app && npm run build
```

## 任务 8：实现 3D Kitchen 基础交互与列表降级

**新建文件**

- `app/src/components/SceneLab/Kitchen/KitchenWorkspace.tsx`
- `app/src/components/SceneLab/Kitchen/KitchenCanvas.tsx`
- `app/src/components/SceneLab/Kitchen/KitchenModel.tsx`
- `app/src/components/SceneLab/Kitchen/SceneCameraController.tsx`
- `app/src/components/SceneLab/Kitchen/ObjectListFallback.tsx`
- `app/src/components/SceneLab/Kitchen/objectSelection.ts`
- `app/src/components/SceneLab/Kitchen/objectSelection.test.ts`

**工作内容**

1. Canvas 支持 orbit、缩放和受限平移，设置合理相机、环境光和低成本阴影。
2. 加载 GLB，根据节点名映射 `object_key`；环境节点不可选择。
3. 点击对象后高亮材质、轻微聚焦相机，并通知 React 侧栏。
4. 无匹配课程内容的合法对象仍可选择，但显示“暂无课程内容”。
5. 捕获 WebGL 创建失败和 GLB 加载失败，切换到对象列表；列表共享同一个 selection state。
6. 单元测试将 Three.js 选择逻辑与 Canvas 渲染分离；手动验证真实 WebGL。

**验证**

```bash
cd app && npm run test:run -- objectSelection
cd app && npm run build
```

## 任务 9：实现探索与语义视角

**新建文件**

- `app/src/components/SceneLab/LessonModeTabs.tsx`
- `app/src/components/SceneLab/ObjectLessonPanel.tsx`
- `app/src/components/SceneLab/SemanticOverlay.tsx`
- `app/src/components/SceneLab/ObjectLessonPanel.test.tsx`

**复用文件**

- `app/src/components/ui/SpeakButton.tsx`
- `app/src/components/ui/LevelBadge.tsx`

**工作内容**

1. 探索视角展示单词、IPA、释义、搭配、动作句、CEFR、TTS 和收藏状态。
2. 语义视角按 category 过滤/着色，仅显示当前对象相关的有限关系线，避免场景噪声。
3. 已在 Vocabulary 的词显示已有状态；收藏操作使用场景批量入库 API，即使单词已存在也回填关联。
4. 收藏成功发出 `vocab-updated`，保持侧栏统计同步。
5. 测试对象切换、TTS props、单词已有/未有状态和收藏反馈。

**验证**

```bash
cd app && npm run test:run -- ObjectLessonPanel
```

## 任务 10：实现任务状态机

**新建文件**

- `app/src/features/scene-lab/learning/taskMachine.ts`
- `app/src/features/scene-lab/learning/taskMachine.test.ts`
- `app/src/components/SceneLab/TaskMode.tsx`
- `app/src/components/SceneLab/ActionPicker.tsx`

**工作内容**

1. 用纯函数实现 `find(object_key)` 和 `select(action)` 步骤状态机。
2. 错误选择记录 attempt，不跳过步骤；提示次数进入结果。
3. 完成任务后保存各步骤的正确性、响应时间和提示使用情况。
4. UI 只展示当前目标、反馈和可选动作，不让 AI 参与运行时决策。
5. 测试正确路径、错误对象、错误动作、提示、重新开始和完成状态。

**验证**

```bash
cd app && npm run test:run -- taskMachine
```

## 任务 11：实现测试模式、熟悉度和推荐

**新建文件**

- `app/src/features/scene-lab/learning/memoryScore.ts`
- `app/src/features/scene-lab/learning/memoryScore.test.ts`
- `app/src/features/scene-lab/learning/recommendations.ts`
- `app/src/features/scene-lab/learning/recommendations.test.ts`
- `app/src/components/SceneLab/TestMode.tsx`
- `app/src/components/SceneLab/SessionSummary.tsx`
- `app/src/components/SceneLab/SessionSummary.test.tsx`

**工作内容**

1. 用明确常量实现 New → Learning → Familiar → Mastered 状态转换；把阈值集中在一个文件。
2. 测试模式支持听音定位、中文定位和动作句定位，隐藏场景标签。
3. 每道题记录 correct、response_ms、hints_used 和 mode。
4. 推荐规则只选择未收藏、New/Learning、表现薄弱且达到 importance 阈值的词。
5. Session Summary 默认勾选推荐词，但允许用户修改后批量收藏。
6. 测试所有阈值边界、跨日回访输入、推荐排除条件和批量确认。

**验证**

```bash
cd app && npm run test:run -- memoryScore recommendations SessionSummary
```

## 任务 12：端到端整合、国际化与性能验证

**修改文件**

- `app/src/components/SceneLab/SceneLabPage.tsx`
- `app/src/components/SceneLab/Kitchen/KitchenWorkspace.tsx`
- `app/src/i18n/en/index.ts`
- `app/src/i18n/zh/index.ts`

**新建文件**

- `app/src/components/SceneLab/SceneLab.integration.test.tsx`
- `app/src/i18n/en/sceneLab.ts`
- `app/src/i18n/zh/sceneLab.ts`

**工作内容**

1. 串联场景库、生成、持久化、四种视角、session/attempt 保存和 Session Summary。
2. 补全双语文案，禁止在 Scene Lab 新组件中硬编码用户可见字符串。
3. 集成测试 mock Tauri 和 R3F，覆盖：生成 Kitchen → 探索 → 测试 → 推荐 → 收藏 → 再进入恢复进度。
4. 验证 3D chunk 懒加载；记录 Kitchen 首次加载体积和开发机帧率。
5. 手动验证 WebGL 禁用、模型 404、AI 未配置、AI 部分无效、已有词和数据库重启恢复。

**最终验证**

```bash
cd app && npm run test:run
cd app && npm run build
cd app/src-tauri && cargo test
cd app/src-tauri && cargo fmt --check
```

## 实施检查点

建议在以下检查点分别提交，方便回滚和评审：

1. 测试基础 + R3F 依赖。
2. manifest + GLB 契约。
3. migration + Rust 数据库 API。
4. 前端 DB adapter + AI 生成校验。
5. 导航 + 场景库。
6. 3D Kitchen + 降级列表。
7. 探索/语义 + 收藏。
8. 任务/测试 + 熟悉度推荐。
9. 集成、国际化和性能收尾。

## 风险与前置条件

- **3D 资产是最大前置条件。** `kitchen.glb` 必须拥有可独立选择、命名稳定的 15–25 个节点，并确认许可允许随应用分发。在开始任务 8 前完成资产验收。
- Three.js 会显著增加 bundle；必须保持页面懒加载并检查 chunk。
- 当前前端没有测试框架，任务 1 必须先完成，不能把测试集中到最后补。
- 场景数据库 API 较多，应保持在独立 Rust/TS 模块，避免继续扩大现有通用 DB 文件。
- AI provider 的 JSON mode 支持不一致，因此本地修复和严格校验仍是必要路径。
