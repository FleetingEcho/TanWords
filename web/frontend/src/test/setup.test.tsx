import React from "react";
import { render, screen } from "@testing-library/react";

function Smoke() {
  return <span>TanWords test environment</span>;
}

it("renders React components in jsdom", () => {
  render(<Smoke />);
  expect(screen.getByText("TanWords test environment")).toBeInTheDocument();
});
