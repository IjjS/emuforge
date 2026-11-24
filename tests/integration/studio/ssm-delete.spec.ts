import { expect, test } from "./support";
import { fixture } from "./services/ssm/fixture";
import {
  button,
  detail,
  cell,
  link,
  list,
  missing,
  modal,
  success,
  ui,
} from "./services/ssm/screen";

test("studio.ssm-parameter-delete", async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed();
  await f.seed({ Value: "second", Overwrite: true });
  const witness = f.prefix + "/retained";
  await f.seed({ Name: witness });
  await page.goto(detail(f.name));
  await button(page, "Delete").click();
  await button(modal(page), "Cancel").click();
  expect(await f.read()).toMatchObject({
    Name: f.name,
    Version: 2,
    Value: "second",
  });
  await button(page, "Delete").click();
  await modal(page).getByRole("textbox").fill(f.name);
  await f.seed({ Name: witness, Overwrite: true, Value: "updated during confirmation" });
  const updated = await f.read(witness);
  expect(updated.Version).toBe(2);
  await button(modal(page), "Delete").click();
  await expect(page).toHaveURL(list);
  await expect(success(page)).toContainText(
    "Parameter " + f.name + " deleted.",
  );
  const retained = page.getByRole("link", { name: witness, exact: true });
  await expect(await cell(page, retained, 4, "Version")).toHaveText(String(updated.Version));
  await expect(link(page, f.name)).toHaveCount(0);
  await page.goto(detail(f.name));
  await missing(page, f.name);
  await expect(f.read()).rejects.toMatchObject({ name: "ParameterNotFound" });
});

test("studio.ssm-parameter-bulk-delete", async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const rejected = f.prefix + "/removed";
  const kept = f.prefix + "/kept";
  for (const Name of [f.name, rejected, kept]) await f.seed({ Name });
  await page.goto(list);
  for (const name of [f.name, rejected])
    await page
      .getByRole("checkbox", { name: "Select " + name, exact: true })
      .check();
  await button(page, "Delete").click();
  await f.client.deleteParameter({ Name: rejected });
  await f.seed({ Name: kept, Overwrite: true, Value: "fresh" });
  await modal(page).getByRole("textbox").fill("delete");
  await button(modal(page), "Delete").click();
  await expect(modal(page)).toBeHidden();
  const removed = success(page).filter({ hasText: "Deleted parameters" });
  const refused = page
    .locator(ui.findFlashbar().findItemsByType("error").toSelector())
    .filter({ hasText: "Rejected parameters" });
  for (const [item, name, other] of [
    [removed, f.name, rejected],
    [refused, rejected, f.name],
  ] as const) {
    await expect(item.getByText(name, { exact: true })).toBeVisible();
    await expect(item.getByText(other, { exact: true })).toHaveCount(0);
  }
  const witness = page.getByRole("link", { name: kept, exact: true });
  await expect(await cell(page, witness, 4, "Version")).toHaveText("2");
  for (const name of [f.name, rejected]) {
    await expect(link(page, name)).toHaveCount(0);
    await expect(f.read(name)).rejects.toMatchObject({
      name: "ParameterNotFound",
    });
  }
  expect(await f.read(kept)).toMatchObject({
    Name: kept,
    Value: "fresh",
    Version: 2,
  });
});
