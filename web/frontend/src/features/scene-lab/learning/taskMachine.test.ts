import { answerTask, initialTaskState } from "./taskMachine";
import type { SceneTask } from "../types";

const task: SceneTask = { title_en: "Tea", title_zh: "泡茶", steps: [
  { type: "find", object_key: "kettle", instruction_en: "Find it", instruction_zh: "找到水壶" },
  { type: "select", action: "boil", instruction_en: "Boil", instruction_zh: "选择烧水" },
] };

it("does not advance on mistakes and completes valid steps", () => {
  const wrong = answerTask(task, initialTaskState, { type: "find", value: "sink" });
  expect(wrong.state.stepIndex).toBe(0);
  const first = answerTask(task, wrong.state, { type: "find", value: "kettle" });
  const second = answerTask(task, first.state, { type: "select", value: "boil" });
  expect(second.state.complete).toBe(true);
});
