import { expect, test } from "@playwright/test";
import { api } from "./chaos-support";
import { BASE, open } from "./helpers";

test("a guest room renders two editors and reconnects after an API restart", async ({
  browser,
}) => {
  const bootstrap = await browser.newContext({ baseURL: BASE });
  await bootstrap.request.get("/api/v1/auth/csrf/");
  const csrf =
    (await bootstrap.cookies()).find((cookie) => cookie.name === "csrftoken")
      ?.value ?? "";
  const created = await bootstrap.request.post("/api/v1/drawing-rooms/", {
    data: { title: "Browser guest room" },
    headers: { "X-CSRFToken": csrf },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const room = (await created.json()) as { id: string; key: string };
  await bootstrap.close();
  const path = `/drawings/room#room=${room.id},${room.key}`;
  const first = await open(browser, null, path);
  const second = await open(browser, null, path);

  try {
    await expect(first.page.getByLabel("Whiteboard canvas")).toBeVisible();
    await expect(second.page.getByLabel("Whiteboard canvas")).toBeVisible();
    await expect(first.page.getByText(/Live · 1 other/)).toBeVisible();
    await expect(second.page.getByText(/Live · 1 other/)).toBeVisible();

    await api("restart", "graceful");

    await expect
      .poll(() => first.page.getByText(/Live room|Live · 1 other/).count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(() => second.page.getByText(/Live room|Live · 1 other/).count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
  } finally {
    await first.context.close();
    await second.context.close();
  }
});
