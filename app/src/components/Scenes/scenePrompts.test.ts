import { describe, it, expect } from "vitest";
import { SCENE_SYSTEM_PROMPT, buildSceneUserPrompt, sceneSessionTitle } from "./scenePrompts";

/** These are renderer contracts, not prose taste: the Scenes page renders the
 *  reply with the AiChat Markdown component, whose SpeakingBlockquote gives
 *  every `> ` line a TTS + save button, and whose inline parser understands
 *  `==highlights==`. Silent prompt drift breaks the page the user sees. */
describe("scene prompts", () => {
  it("locks every English line to the single-blockquote contract", () => {
    expect(SCENE_SYSTEM_PROMPT).toContain("`> `");
    expect(SCENE_SYSTEM_PROMPT).toMatch(/每个 blockquote 只放一句英文/);
  });

  it("keeps the ==highlight== token the Markdown component parses", () => {
    expect(SCENE_SYSTEM_PROMPT).toContain("==高亮==");
  });

  it("ships the four handbook sections a first reply must cover", () => {
    for (const section of ["## 场景地图", "## 高频对话", "## 突发情况", "## 核心词块", "## 文化提示"]) {
      expect(SCENE_SYSTEM_PROMPT).toContain(section);
    }
  });

  it("aims the first reply at a full handbook, not a skeleton", () => {
    expect(SCENE_SYSTEM_PROMPT).toContain("80-120 句");
  });

  it("defines the follow-up behaviors the suggestion chips advertise", () => {
    for (const mode of ["再来更多句子", "整理成对话剧本", "模拟对话考我"]) {
      expect(SCENE_SYSTEM_PROMPT).toContain(mode);
    }
  });

  it("quotes the topic in the user prompt so it can't be read as an instruction", () => {
    expect(buildSceneUserPrompt("咖啡厅", "zh")).toContain("「咖啡厅」");
    expect(buildSceneUserPrompt("phone a bank", "zh")).toContain("我想学的场景是");
  });

  it("follows the UI language for the first visible bubble", () => {
    expect(buildSceneUserPrompt("咖啡厅", "en")).toContain('"咖啡厅"');
    expect(buildSceneUserPrompt("咖啡厅", "en")).toContain("I want to learn this scene");
    expect(buildSceneUserPrompt("cafe", "en")).not.toContain("我想学的场景是");
  });

  it("understands the English follow-up chip labels too", () => {
    for (const trigger of ["Give me more lines", "dialogue script", "Role-play and quiz me"]) {
      expect(SCENE_SYSTEM_PROMPT).toContain(trigger);
    }
  });

  it("flattens and truncates the title to one line", () => {
    expect(sceneSessionTitle("  咖啡厅 \n 点单 ")).toBe("咖啡厅 点单");
    const long = "a very long scene description that keeps going";
    expect(sceneSessionTitle(long)).toHaveLength(25);
  });
});
