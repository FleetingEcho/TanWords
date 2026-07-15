# Knowledge Map：按主题类型分化生成分支

## 目标

修复 Knowledge Map（Infinite Knowledge Map / Scene Lab 页面下的知识地图功能）生成阶段的一个核心问题：无论用户输入什么主题，都会生成同一套固定的 7 个分类分支（Core Vocabulary、Actions & Processes、Objects & Concepts、Situations & Use Cases、Common Situational Sentences、Problems & Solutions、Advanced Expressions）。这套分支是为宽泛主题设计的，用在单个单词（如 "resilient"）上会显得臃肿、不相关，浪费生成配额也影响浏览体验。

`SceneLabPage.create()` 已经有一个 `rootType`（`"topic" | "situation"`）的启发式分类，但目前只用于展示标签，并未真正影响生成的分支集合——这是本次要补上的缺口。

## 范围

### 包含

- 将主题分类从 2 类扩展为 3 类：`word`（单个词）、`topic`（短语/宽泛主题）、`situation`（场景/完整句子，沿用现有判定逻辑）。
- 为每种类型定义独立的分支预设，替换掉当前唯一的 `DEFAULT_BRANCHES` 常量。
- `word` 类型分支收窄为 4 个：Synonyms & Related Words、Collocations & Common Phrases、Example Sentences、Contrasts & Common Mistakes。
- `topic` 类型分支从 7 个精简为 5 个：去掉与 Actions/Objects 重叠度高、区分度最低的 Situations & Use Cases 与 Problems & Solutions。
- `situation` 类型分支维持现状（7 个），因为该类型不在本次反馈范围内。
- 「完整双语例句」生成逻辑（`generator.ts` 中目前按分支名精确匹配 `"Common Situational Sentences"` 触发）改为按分支集合匹配，使 `word` 类型的 "Example Sentences" 分支也能复用这条生成路径，得到真实的双语例句而不是孤立单词。

### 不包含

- 不引入额外的 AI 调用来动态生成分支名（保持确定性、无额外延迟）。
- 不改动分支内部的生成 prompt 结构或每条内容的字段格式。
- 不改动 UI 展示（Outline / Board / Canvas 均不变）。
- 不改动 `situation` 类型的判定阈值或分支集合。
- 不处理未来可能需要的第 4 种类型（如语法点），留待后续单独评估。

## 主题分类与分支预设

### 分类判定（`app/src/components/SceneLab/SceneLabPage.tsx` 内 `create()`）

```text
输入是单个词（trim 后不含空白、不含句末标点）        → word
输入较长或含多个词（沿用现有 length>18 / 词数>=5 / 句末标点判定） → situation
其余（短语、宽泛主题）                              → topic
```

`word` 判定需在现有 `situation` 判定之前生效：先排除 situation，再判断是否为单词，否则归为 topic。

### 分支预设（`app/src/features/knowledge-map/generator.ts`）

`DEFAULT_BRANCHES: NewKnowledgeNode[]` 常量替换为按类型分组的预设，例如 `BRANCH_PRESETS: Record<RootType, NewKnowledgeNode[]>`：

- **word**（4 个）
  1. Synonyms & Related Words / 近义词与关联词
  2. Collocations & Common Phrases / 常见搭配与短语
  3. Example Sentences / 例句
  4. Contrasts & Common Mistakes / 易混词与常见错误

- **topic**（5 个，从原 7 个中去掉 Situations & Use Cases、Problems & Solutions）
  1. Core Vocabulary / 核心词汇
  2. Actions & Processes / 动作与过程
  3. Objects & Concepts / 对象与概念
  4. Common Situational Sentences / 常用情景句
  5. Advanced Expressions / 高级表达

- **situation**（7 个，与当前 `DEFAULT_BRANCHES` 完全一致，不改动）

### 「例句」分支的生成路径

`generator.ts` 中判断是否触发 5 句双语例句生成逻辑的条件，从：

```ts
const sentences = parent.label === "Common Situational Sentences";
```

改为对一个小集合的成员判断（如 `SENTENCE_BRANCH_LABELS = new Set(["Common Situational Sentences", "Example Sentences"])`），使 `word` 类型下的 "Example Sentences" 分支复用相同的双语例句生成与校验逻辑（含不足 5 句时的补生成、fallback 兜底）。

## 调用点改动

`SceneLabPage.create()` 中：

```ts
const rootType = ...; // 扩展为三分类
const branches = BRANCH_PRESETS[rootType];
const id = await db.createKnowledgeMap(topic, rootType, levels);
...
const categoryIds = await db.addKnowledgeNodes(id, root.id, branches);
```

`open()` 中「进入已有地图时补齐 Common Situational Sentences 分支」的逻辑，需要按该地图的 `root_type` 去查找对应预设里的例句分支名（`word` 地图对应 "Example Sentences"，其余对应 "Common Situational Sentences"），而不是硬编码一个名字。

## 兼容性

已生成的历史地图数据不受影响——分支预设只影响新地图创建时的初始分类集合，不回填、不迁移旧地图的节点结构。旧地图仍按其已保存的节点浏览、扩展（`expand()` 是按节点扩展，与本次改动的创建阶段无关）。

## 测试策略

- 单元测试：分类判定函数对单词 / 短语 / 场景句的边界输入（含中文输入、纯标点、超长单词等）。
- 单元测试：`generator.ts` 中例句分支判断改为集合匹配后，"Common Situational Sentences" 与 "Example Sentences" 两个分支名都能正确触发双语例句生成路径，其他分支名不触发。
- 手动检查：分别用单个词、短语主题、完整场景句创建地图，确认生成的分支数量与名称符合预设，且 `word` 类型不再出现 Situations/Problems 等不相关分支。

## 成功标准

- 输入单个词创建地图时，只生成 4 个分支，且都是与该词直接相关的内容（近义词、搭配、例句、易混词）。
- 输入短语类主题时，生成 5 个分支，不再包含 Situations & Use Cases / Problems & Solutions。
- 输入场景句时，生成结果与改动前一致（7 个分支）。
- `word` 类型的 Example Sentences 分支返回的是完整双语例句，而不是退化成单个词条。
