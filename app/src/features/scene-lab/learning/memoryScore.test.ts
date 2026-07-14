import { learningStatus, memoryScore } from "./memoryScore";

it("rewards accurate delayed recall", () => {
  const strong = Array.from({ length: 6 }, () => ({ correct: true, responseMs: 1200, hintsUsed: 0, ageDays: 1 }));
  expect(memoryScore(strong)).toBeGreaterThanOrEqual(80);
  expect(learningStatus(strong)).toBe("mastered");
  expect(learningStatus([{ correct: false, responseMs: 9000, hintsUsed: 2 }])).toBe("learning");
});
