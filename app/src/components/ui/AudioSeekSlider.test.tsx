import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AudioSeekSlider } from "./AudioSeekSlider";

describe("AudioSeekSlider", () => {
  it("holds the committed position until the player confirms the seek", async () => {
    const onSeek = vi.fn();
    const { rerender } = render(
      <AudioSeekSlider
        position={5}
        duration={100}
        onSeek={onSeek}
        ariaLabel="Seek"
      />,
    );
    const slider = screen.getByRole("slider", { name: "Seek" }) as HTMLInputElement;

    fireEvent.input(slider, { target: { value: "60" } });
    fireEvent.pointerUp(slider);

    expect(onSeek).toHaveBeenCalledWith(60);
    expect(slider.value).toBe("60");

    rerender(
      <AudioSeekSlider
        position={60.2}
        duration={100}
        onSeek={onSeek}
        ariaLabel="Seek"
      />,
    );

    await waitFor(() => expect(slider.value).toBe("60.2"));
  });
});
