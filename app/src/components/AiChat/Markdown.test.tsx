import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderInline } from "./Markdown";

/** Renders the inline nodes into a container so assertions can be made against
 *  real DOM, the same way the app mounts them. */
function inline(text: string) {
  const { container } = render(<p>{renderInline(text, "k")}</p>);
  return container;
}

describe("renderInline — ==highlight==", () => {
  it("renders a highlight as <mark>, keeping the inner text", () => {
    const c = inline("核心是 ==动作本身== 而非结果");
    expect(c.querySelectorAll("mark")).toHaveLength(1);
    expect(c.querySelector("mark")?.textContent).toBe("动作本身");
    expect(c.textContent).toBe("核心是 动作本身 而非结果");
  });

  it("leaves bold as plain <strong> with no highlight and no colour class", () => {
    const c = inline("**强调** 不是高亮");
    expect(c.querySelector("strong")?.textContent).toBe("强调");
    expect(c.querySelector("strong")?.className).toBe("");
    expect(c.querySelector("mark")).toBeNull();
  });

  it("does not treat spaced equality comparisons as a highlight", () => {
    // The middle term would become a <mark> if the delimiters didn't have to
    // hug their content.
    const c = inline("checks a == b == c carefully");
    expect(c.querySelector("mark")).toBeNull();
    expect(c.textContent).toBe("checks a == b == c carefully");
  });

  it("keeps == inside inline code as literal code", () => {
    const c = inline("use `x == y == z` here");
    expect(c.querySelector("mark")).toBeNull();
    expect(c.querySelector("code")?.textContent).toBe("x == y == z");
  });

  it("supports a single-character highlight and several per line", () => {
    const c = inline("==a== 与 ==b== 都算");
    expect(Array.from(c.querySelectorAll("mark")).map((m) => m.textContent)).toEqual(["a", "b"]);
  });

  it("renders bold nested inside a highlight", () => {
    const c = inline("==这里 **很** 重要==");
    const mark = c.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.querySelector("strong")?.textContent).toBe("很");
  });

  it("leaves an unclosed highlight as literal text", () => {
    const c = inline("==没有收尾");
    expect(c.querySelector("mark")).toBeNull();
    expect(c.textContent).toBe("==没有收尾");
  });
});
