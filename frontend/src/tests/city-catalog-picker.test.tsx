// @vitest-environment jsdom
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AreaForm } from "../features/area/components/AreaForm";
import { api } from "../api/client";
vi.mock("../api/client", () => ({ api: vi.fn() }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("selects a catalog city, locks canonical names and submits its link through the existing operator form", async () => {
  const ui = userEvent.setup(),
    saved = vi.fn();
  vi.mocked(api).mockResolvedValue({
    data: [
      {
        _id: "0123456789abcdef01234567",
        cityId: "city_fixture_only",
        name: "Pune",
        state: "Maharashtra",
        country: "India",
      },
    ],
  });
  render(
    <AreaForm
      resource="cities"
      cities={[]}
      pois={[]}
      onSaved={saved}
      onClose={vi.fn()}
    />,
  );
  expect(api).not.toHaveBeenCalled();
  await ui.type(screen.getByLabelText("Find a catalog city"), "Pu");
  await ui.selectOptions(
    await screen.findByLabelText("Catalog results"),
    "0123456789abcdef01234567",
  );
  expect((screen.getByLabelText("City name") as HTMLInputElement).value).toBe(
    "Pune",
  );
  expect(
    (screen.getByLabelText("City name") as HTMLInputElement).readOnly,
  ).toBe(true);
  await ui.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith(
    "/operator/area-master/cities",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "Pune",
        state: "Maharashtra",
        country: "India",
        status: "Active",
        catalogId: "0123456789abcdef01234567",
      }),
    }),
  );
});
