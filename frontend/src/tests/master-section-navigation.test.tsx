// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { MasterSectionLayout } from "../components/navigation/MasterSectionLayout";
afterEach(cleanup);
function Example() {
  const [selected, setSelected] = useState("vehicles");
  return (
    <MasterSectionLayout
      label="Example Master"
      sections={[
        { id: "vehicles", label: "Vehicles", group: "Setup" },
        { id: "charts", label: "Seat charts", group: "Setup" },
        { id: "crew", label: "Crew", group: "People" },
      ]}
      selected={selected}
      onSelect={setSelected}
    >
      <p>Current section: {selected}</p>
    </MasterSectionLayout>
  );
}
it("supports vertical keyboard navigation and links the active section to its content", async () => {
  render(<Example />);
  const user = userEvent.setup();
  const vehicles = screen.getByRole("tab", { name: "Vehicles" });
  vehicles.focus();
  await user.keyboard("{ArrowDown}");
  const charts = screen.getByRole("tab", { name: "Seat charts" });
  expect(document.activeElement).toBe(charts);
  expect(charts.getAttribute("aria-selected")).toBe("true");
  const panel = screen.getByRole("tabpanel");
  expect(panel.id).toBe(charts.getAttribute("aria-controls"));
  expect(panel.getAttribute("aria-labelledby")).toBe(charts.id);
  expect(screen.getByText("Current section: charts")).toBeTruthy();
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: "Crew" }),
  );
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(vehicles);
});
it("keeps the compact selector and desktop navigation on the same section", () => {
  render(<Example />);
  const selector = screen.getByLabelText(
    "Example Master section",
  ) as HTMLSelectElement;
  fireEvent.change(selector, { target: { value: "crew" } });
  expect(screen.getByText("Current section: crew")).toBeTruthy();
  expect(
    screen.getByRole("tab", { name: "Crew" }).getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "Vehicles" }));
  expect(selector.value).toBe("vehicles");
});
