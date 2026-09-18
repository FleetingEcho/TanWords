import React from "react";
import { render, screen } from "@testing-library/react";

function Smoke() {
  return <span>TanNotes test environment</span>;
}

it("renders React components in jsdom", () => {
  render(<Smoke />);
  expect(screen.getByText("TanNotes test environment")).toBeInTheDocument();
});
