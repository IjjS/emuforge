import { expect, test } from "./support";
import {
  ABOUT_CONTROL,
  connectedAt,
  crumbLink,
  expectLine,
  notStartedOn,
} from "./support/aws-area";
import { creationDateText, SEOUL } from "./support/service-screens";
import { direct, fixture } from "./services/ssm/fixture";
import {
  button,
  cell,
  detail,
  link,
  list,
  missing,
  ui,
} from "./services/ssm/screen";
import type { Page } from "@playwright/test";

test.use({ timezoneId: SEOUL.timeZone });

test("studio.ssm-parameter-list", async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  for (let i = 0; i < 50; i++)
    await f.seed({ Name: f.prefix + "/before-" + i });
  await f.seed();
  const target = page.getByRole("link", { name: f.name, exact: true });
  async function checkRow() {
    const metadata = await f.metadata();
    await expect(link(page, f.prefix + "/before-0")).toBeVisible();
    await button(page, "Next page").click();
    for (const [column, value] of Object.entries({
      Name: metadata.Name!,
      Type: metadata.Type!,
      Version: String(metadata.Version),
      "Last modified": creationDateText(
        metadata.LastModifiedDate!.toISOString(),
        SEOUL,
      ),
    }))
      await expect(await cell(page, target, column)).toHaveText(value);
  }
  await page.goto(list);
  await expect(link(page, f.prefix + "/before-0")).toBeVisible();
  await expect(target).toHaveCount(0);
  await checkRow();
  await target.click();
  await expect(page).toHaveURL(detail(f.name));
  await f.seed({ Overwrite: true, Value: "second" });
  await crumbLink(page, "Parameter Store").click();
  await checkRow();
  await f.seed({ Overwrite: true, Value: "third" });
  await button(page, "Refresh").click();
  await expect(link(page, f.prefix + "/before-0")).toBeVisible();
  await checkRow();
  const notice = page.getByRole("region", { name: "Local emulator notice" });
  await button(notice, "Close the local emulator notice").click();
  await expect(notice).toBeHidden();
  await button(page, ABOUT_CONTROL).click();
  await expect(notice).toBeVisible();
});

async function restart(
  page: Page,
  f: Awaited<ReturnType<typeof fixture>>,
  onStop: () => Promise<void>,
) {
  const doc = await page.evaluateHandle(() => document);
  const url = page.url();
  const departures: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && frame.url() !== url)
      departures.push(frame.url());
  });
  await f.emulator!.stop();
  await expectLine(page, notStartedOn(f.emulatorPort));
  await onStop();
  await f.emulator!.startAgain();
  await expectLine(page, connectedAt(f.emulatorPort), 60000);
  return async () => {
    await expect(page).toHaveURL(url);
    expect(departures).toEqual([]);
    expect(await page.evaluate((original) => document === original, doc)).toBe(
      true,
    );
    await doc.dispose();
  };
}

test("studio.ssm-parameter-list-restart", async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  await f.seed();
  await page.goto(list);
  await expect(link(page, f.name)).toBeVisible();
  const same = await restart(page, f, async () => {
    await expect(link(page, f.name)).toBeHidden();
  });
  const empty = page.locator(ui.findTable().findEmptySlot().toSelector());
  await expect(empty.getByText("No parameters", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await expect(
    empty.getByText("Create a parameter to store a configuration value."),
  ).toBeVisible();
  await expect(link(page, f.name)).toBeHidden();
  expect(
    (await direct(ctx, f.emulatorPort).describeParameters({})).Parameters,
  ).toEqual([]);
  await same();
});

test("studio.ssm-parameter-detail-restart", async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  await f.seed({ Description: "Original instance metadata" });
  await page.goto(detail(f.name));
  await expect(
    page.getByText("Original instance metadata", { exact: true }),
  ).toBeVisible();
  await button(page, "Show value").click();
  const value = page.getByText("fixture-one", { exact: true });
  await expect(value).toBeVisible();
  const same = await restart(page, f, async () => {
    await expect(value).toBeHidden();
  });
  await missing(page, f.name);
  await expect(value).toBeHidden();
  await expect(
    page.getByText("Original instance metadata", { exact: true }),
  ).toBeHidden();
  await expect(
    direct(ctx, f.emulatorPort).getParameter({ Name: f.name }),
  ).rejects.toMatchObject({ name: "ParameterNotFound" });
  await same();
});
