import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AppBackground } from "./AppBackground";
import { useSettingsStore } from "@/store/settingsStore";
import { useLayoutStore } from "@/store/layoutStore";

describe("AppBackground", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      appBackgroundImage: "data:image/jpeg;base64,wallpaper",
      appBackgroundVisible: true,
      appBackgroundBlur: 0,
      appBackgroundImagePosition: { x: 50, y: 50 },
      appBackgroundDimming: 0,
    });
    useLayoutStore.setState({ zenMode: false });
  });

  it("renders exactly the selected dimming percentage", () => {
    useSettingsStore.setState({ appBackgroundDimming: 35 });
    const { getByTestId } = render(<AppBackground />);

    expect(getByTestId("app-background-dimming")).toHaveStyle({
      backgroundColor: "rgb(0 0 0 / 35%)",
    });
  });

  it("renders the original image without a dark overlay when dimming is zero", () => {
    const { container } = render(<AppBackground />);

    expect(container.querySelector(".absolute.inset-0")).not.toBeInTheDocument();
  });
});
