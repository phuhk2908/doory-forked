import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/utils";
import { StartDesigningTrigger } from "./StartDesigningDialog";

function Location() {
  const { pathname, search } = useLocation();
  return (
    <output data-testid="location">
      {pathname}
      {search}
    </output>
  );
}

describe("start designing chooser", () => {
  it("offers the design and whiteboard entry points", async () => {
    renderWithProviders(
      <>
        <StartDesigningTrigger>Start designing</StartDesigningTrigger>
        <Location />
      </>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Start designing" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "What would you like to create?",
    });
    expect(
      within(dialog).getByRole("button", { name: /^Start a design/ }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^Start a whiteboard/ }),
    ).toBeInTheDocument();
  });

  it("routes to the whiteboard without changing the guest flow", async () => {
    renderWithProviders(
      <>
        <StartDesigningTrigger>Start designing</StartDesigningTrigger>
        <Location />
      </>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Start designing" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /^Start a whiteboard/ }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/drawings/new");
  });

  it("routes to the existing design creator", async () => {
    renderWithProviders(
      <>
        <StartDesigningTrigger>Start designing</StartDesigningTrigger>
        <Location />
      </>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Start designing" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /^Start a design/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Start a design" }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Start a design" })).getByRole(
        "button",
        { name: /Instagram Post/ },
      ),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/create?preset=instagram-post",
    );
  });

  it("opens the full size picker from the quick-start step", async () => {
    renderWithProviders(
      <StartDesigningTrigger>Start designing</StartDesigningTrigger>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Start designing" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /^Start a design/ }),
    );
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Start a design" })).getByRole(
        "button",
        { name: /All sizes/ },
      ),
    );
    expect(
      await screen.findByRole("dialog", { name: "Create a design" }),
    ).toBeInTheDocument();
  });
});
