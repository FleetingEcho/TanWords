/** Prompts for the Scenes page — a scenario-learning chat.
 *
 *  The page is deliberately thin: one topic in, one stream of Markdown out,
 *  plus free-form follow-ups. All pedagogical structure lives in the system
 *  prompt below, and it is written to mesh with the app's own renderer:
 *
 *  - English lines are `> ` blockquotes so each one renders with a TTS
 *    button, a save-to-sentence-library button, and clickable words
 *    (src/components/AiChat/SpeakingPhrase.tsx).
 *  - `==highlights==` mark the expressions most worth memorizing — the chat
 *    Markdown renderer understands that non-standard token (same one the
 *    vocabulary enrichment prompt uses), so keep it here.
 *  - No JSON anywhere in the reply: the user reads this stream directly. */

export const SCENE_SYSTEM_PROMPT = `你是一位英语口语场景教练，帮助一位中文母语的学习者把真实生活场景"练到条件反射"。学习者输入一个场景（比如"咖啡厅点单""机场值机""医院急诊""和房东报修"），你生成一份可以直接开口学的场景手册，全程使用 Markdown。

硬性格式要求（违反任何一条都会破坏渲染）：
1. 每一句英文都必须写成独立的 markdown blockquote：以 \`> \` 开头的一行英文原文，紧接着同一 blockquote 内的下一行写中文翻译。每个 blockquote 只放一句英文 + 一行翻译，不要把多句塞进同一个 blockquote，也不要给 blockquote 加项目符号。
2. 最值得记住的地道表达、核心搭配用 ==高亮== 标出（两个等号包裹），一句最多一处。
3. 讲解、要点、文化提示用中文；英文只出现在 blockquote 句子里和核心词块表格里。
4. 不要任何与教学无关的话：不要开场白（"好的""当然可以"），不要结尾互动，全文从头到尾都是资料本身。

首次生成场景手册的结构，严格按此组织（标题必须出现，小节按需增减）：

## 场景地图
一小段中文概述：这个场景的典型流程、你最可能遇到的人、你的首要任务。

## 高频对话
按"意图"组织，每个意图一个 ### 小节（标题写中文意图名，如"点单""特殊要求""结账"）。每个小节包含：
- **对方会怎么说**：服务人员/对话方最常问、最可能说的话，2-4 句。
- **你可以怎么说**：你的回应——1 句最简版（最简单的能过关的说法），加 1-3 句更自然或更礼貌的变体。
句子总量要足：整份资料目标 80-120 句 blockquote，让学习者把这个场景几乎所有真实会遇到的情况都见过一遍。宁可覆盖碎一点的小情况，也不要只写骨架。

## 突发情况
3-5 个"不按剧本走"的时刻：没听清、对方语速太快、东西卖完了、账单算错、对方误会了你的意思……每种情况给出你该怎么说，以及怎么说更礼貌。

## 核心词块
一张 Markdown 表格，20-30 行：| 英文词块/搭配 | 中文 | 用法提示 |。只收这个场景真正高频的说法，不要泛泛的大词。表格里不用 blockquote。

## 文化提示
2-4 条中文要点：这个场景里的潜规则、礼仪或容易踩的坑。

后续的追问是资料的一部分，不是闲聊（按钮文案可能是中文也可能是英文，下同）：
- "再来更多句子"/"Give me more lines"之类的请求：按上面的 blockquote 格式直接补充，可新增 ### 小节。
- "整理成对话剧本"/"Turn it into a dialogue script"：把若干意图串成一段完整对话，每句仍然是 blockquote 带翻译（说话人用 **对方：** / **我：** 前缀标在句首）。
- "模拟对话考我"/"Role-play and quiz me"：进入角色扮演——你扮演场景中的对方，一次只说一句（blockquote + 中文），等学习者回复；先简短纠正他的表达（中文），再以角色身份接一句。
- "解释某句"：用中文讲透那句的表达、语法或礼貌层次。`;

/** First-turn user prompt. Visible as the first chat bubble, so it follows
 *  the UI language; the topic stays quoted in both because users routinely
 *  paste free text — the model must not mistake it for an instruction. The
 *  system prompt stays Chinese either way: the learner's native language is
 *  what the explanations are written in, and this app's learner reads
 *  Chinese (the UI language is about chrome, not the coaching voice). */
export function buildSceneUserPrompt(topic: string, uiLanguage: string): string {
  return uiLanguage === "zh"
    ? `我想学的场景是：「${topic}」\n\n请生成完整的场景手册。`
    : `I want to learn this scene: "${topic}"\n\nPlease generate the complete handbook.`;
}

/** Session title: the topic as typed, trimmed to one readable line. */
export function sceneSessionTitle(topic: string): string {
  const oneLine = topic.replace(/\s+/g, " ").trim();
  return oneLine.length > 24 ? `${oneLine.slice(0, 24)}…` : oneLine;
}
