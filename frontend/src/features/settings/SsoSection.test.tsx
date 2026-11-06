import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderApp } from "@/test/app";
import { makeConfig, makeUser } from "@/test/factories";

const err = (
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
) => HttpResponse.json({ error: { code, message, ...extra } }, { status });
const withSso = () =>
  makeConfig({
    oidc_button_label: "Sign in with Authentik",
    features: { ...makeConfig().features, oidc_login: true },
  });
const PROVIDER = "https://idp.example.com/authorize/?state=s";

afterEach(() => vi.unstubAllGlobals());

async function section() {
  const heading = await screen.findByRole("heading", {
    name: "Single sign-on",
  });
  return heading.closest("section") as HTMLElement;
}

describe("settings: single sign-on", () => {
  it("is not there when the server has no provider and the account isn’t connected", async () => {
    renderApp("/settings", { user: makeUser(), config: makeConfig() });
    await screen.findByRole("heading", { name: "Change password" });
    expect(
      screen.queryByRole("heading", { name: "Single sign-on" }),
    ).not.toBeInTheDocument();
  });

  it("connects after the password, at the provider", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const bodies: unknown[] = [];
    renderApp("/settings", {
      user: makeUser(),
      config: withSso(),
      handlers: [
        http.post("*/api/v1/auth/oidc/connection/", async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json({ redirect_url: PROVIDER });
        }),
      ],
    });
    const card = await section();
    expect(card).toHaveTextContent("Not connected");
    expect(card).toHaveTextContent(
      "Connect your account to log in with the “Sign in with Authentik” button.",
    );
    await userEvent.click(
      within(card).getByRole("button", { name: "Connect…" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Connect single sign-on",
    });
    await userEvent.type(
      within(dialog).getByLabelText("Your password", { selector: "input" }),
      "plum-umbrella",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Continue" }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith(PROVIDER));
    expect(bodies).toEqual([{ password: "plum-umbrella" }]);
  });

  it("accounts without a password confirm with their email address", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const bodies: unknown[] = [];
    renderApp("/settings", {
      user: makeUser({ has_password: false, google_linked: true }),
      config: withSso(),
      handlers: [
        http.post("*/api/v1/auth/oidc/connection/", async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json({ redirect_url: PROVIDER });
        }),
      ],
    });
    await userEvent.click(
      within(await section()).getByRole("button", { name: "Connect…" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Connect single sign-on",
    });
    await userEvent.type(
      within(dialog).getByLabelText("Type your email address to confirm"),
      " ada@example.com ",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Continue" }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith(PROVIDER));
    expect(bodies).toEqual([{ confirm_email: "ada@example.com" }]);
  });

  it("shows a wrong password and stays in the dialog", async () => {
    renderApp("/settings", {
      user: makeUser(),
      config: withSso(),
      handlers: [
        http.post("*/api/v1/auth/oidc/connection/", () =>
          err("validation_error", "Invalid input.", 400, {
            fields: { password: ["Incorrect password."] },
          }),
        ),
      ],
    });
    await userEvent.click(
      within(await section()).getByRole("button", { name: "Connect…" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Connect single sign-on",
    });
    await userEvent.type(
      within(dialog).getByLabelText("Your password", { selector: "input" }),
      "wrong",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Continue" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Incorrect password.",
    );
  });

  it("disconnects a connected account", async () => {
    renderApp("/settings", {
      user: makeUser({ oidc_linked: true }),
      config: withSso(),
      handlers: [
        http.delete("*/api/v1/auth/oidc/connection/", () =>
          HttpResponse.json({ user: makeUser({ oidc_linked: false }) }),
        ),
      ],
    });
    const card = await section();
    expect(card).toHaveTextContent("Connected");
    expect(card).toHaveTextContent(
      "You can log in with the “Sign in with Authentik” button.",
    );
    await userEvent.click(
      within(card).getByRole("button", { name: "Disconnect" }),
    );
    expect(
      await screen.findByText("Single sign-on disconnected"),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent("Not connected");
  });

  it("keeps the only way in of an account without a password or Google", async () => {
    renderApp("/settings", {
      user: makeUser({ oidc_linked: true, has_password: false }),
      config: withSso(),
    });
    const card = await section();
    expect(
      within(card).queryByRole("button", { name: "Disconnect" }),
    ).not.toBeInTheDocument();
    expect(card).toHaveTextContent(
      "Set a password to be able to disconnect: it’s your only way to log in.",
    );
  });

  it("can still disconnect after the server stopped offering single sign-on", async () => {
    renderApp("/settings", {
      user: makeUser({ oidc_linked: true }),
      config: makeConfig(),
    });
    expect(
      within(await section()).getByRole("button", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });

  it("confirms a connection the provider sent back, and takes it off the address", async () => {
    const { router } = renderApp("/settings?sso=connected", {
      user: makeUser({ oidc_linked: true }),
      config: withSso(),
    });
    expect(
      await screen.findByText("Single sign-on connected"),
    ).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("explains a connection that failed", async () => {
    const { router } = renderApp("/settings?sso_error=oidc_identity_in_use", {
      user: makeUser(),
      config: withSso(),
    });
    expect(await within(await section()).findByRole("alert")).toHaveTextContent(
      "That account at your sign-in provider is already connected to another Doory account.",
    );
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("does not tell accounts made by single sign-on that they signed in with Google", async () => {
    renderApp("/settings", {
      user: makeUser({ oidc_linked: true, has_password: false }),
      config: withSso(),
    });
    await screen.findByRole("heading", { name: "Set a password" });
    expect(
      screen.getByText("Add a password to also log in with your email."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/signed in with Google/)).not.toBeInTheDocument();
  });
});
