import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// settingsStore subscribes to the colour-scheme media query at import time, and
// useT pulls it in — so this has to be installed before the imports below.
vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

import { RecommendedModelsList } from "./RecommendedModelsList";
import { RECOMMENDED_TTS_MODELS } from "@/lib/recommendedTtsModels";

const noop = () => {};

function renderList(scannedModels: Parameters<typeof RecommendedModelsList>[0]["scannedModels"] = []) {
  return render(
    <RecommendedModelsList
      scannedModels={scannedModels}
      defaultModelsDir="/tmp/models"
      downloadingId={null}
      progress={null}
      onDownload={noop}
      onDeleteRequest={noop}
    />,
  );
}

const nameOf = (group: string) =>
  RECOMMENDED_TTS_MODELS.find((m) => m.group === group)!.name;

describe("RecommendedModelsList", () => {
  it("shows Pocket entries up front and keeps the other engines folded away", async () => {
    renderList();

    expect(screen.getByText(nameOf("pocket"))).toBeInTheDocument();
    expect(screen.queryByText(nameOf("kokoro"))).not.toBeInTheDocument();
    expect(screen.queryByText(nameOf("piper"))).not.toBeInTheDocument();
  });

  it("reveals a folded engine's models once its header is clicked", async () => {
    renderList();

    fireEvent.click(screen.getByText("Kokoro"));

    expect(screen.getByText(nameOf("kokoro"))).toBeInTheDocument();
    // Opening one group leaves the others alone.
    expect(screen.queryByText(nameOf("piper"))).not.toBeInTheDocument();
  });

  it("offers deletion only for downloaded models, after the download button", async () => {
    const pocket = RECOMMENDED_TTS_MODELS.find((m) => m.group === "pocket")!;
    const onDeleteRequest = vi.fn();

    render(
      <RecommendedModelsList
        scannedModels={[
          {
            id: `/tmp/models/${pocket.id}`,
            name: pocket.id,
            kind: "pocket",
            path: `/tmp/models/${pocket.id}`,
            num_speakers: 2,
            voice_names: ["Bria", "Loona"],
          },
        ]}
        defaultModelsDir="/tmp/models"
        downloadingId={null}
        progress={null}
        onDownload={noop}
        onDeleteRequest={onDeleteRequest}
      />,
    );

    const deleteButtons = screen.getAllByLabelText(/^Delete /);
    expect(deleteButtons).toHaveLength(1);

    // Trailing position: the destructive action sits after the primary one.
    const row = deleteButtons[0].closest("div")!;
    const buttons = Array.from(row.querySelectorAll<HTMLElement>("button"));
    expect(buttons.indexOf(deleteButtons[0])).toBe(buttons.length - 1);

    fireEvent.click(deleteButtons[0]);
    expect(onDeleteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/tmp/models/${pocket.id}` }),
    );
  });

  it("counts downloaded models in a folded header so they stay discoverable", async () => {
    const kokoro = RECOMMENDED_TTS_MODELS.find((m) => m.group === "kokoro")!;
    const kokoroCount = RECOMMENDED_TTS_MODELS.filter((m) => m.group === "kokoro").length;

    renderList([
      {
        id: `/tmp/models/${kokoro.id}`,
        name: kokoro.id,
        kind: "kokoro",
        path: `/tmp/models/${kokoro.id}`,
        num_speakers: 0,
        voice_names: [],
      },
    ]);

    // Without this the only way to delete a downloaded model would be to guess
    // which collapsed group it is hiding in.
    expect(screen.getByText(`1/${kokoroCount}`)).toBeInTheDocument();
  });
});
