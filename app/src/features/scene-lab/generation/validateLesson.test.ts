import { validateSceneLesson } from "./validateLesson";

it("drops invalid objects, actions and duplicate words", () => {
  const lesson = validateSceneLesson({
    vocabulary: [
      { object_key: "sink", word: "Rinse", zh: "冲洗", importance: 9, examples: [] },
      { object_key: "moon", word: "orbit", zh: "绕行", examples: [] },
      { object_key: "faucet", word: "rinse", zh: "冲洗", examples: [] },
    ],
    relations: [],
    tasks: [{ title_en: "Wash", steps: [{ type: "find", object_key: "sink" }, { type: "select", action: "teleport" }] }],
  });
  expect(lesson.vocabulary).toHaveLength(1);
  expect(lesson.vocabulary[0].importance).toBe(5);
  expect(lesson.tasks[0].steps).toHaveLength(1);
});
