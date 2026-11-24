import { expect, test } from "./support";
import { fixture, localKey } from "./services/ssm/fixture";
import {
  button,
  detail,
  field,
  list,
  success,
  ui,
} from "./services/ssm/screen";

test("studio.ssm-parameter-save", async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  const key = await localKey(ctx, f.emulatorPort);
  await page.goto(list + "/parameters/create");
  await field(page, "Name").fill(f.name);
  for (const [index, option] of ["SecureString", "Advanced"].entries()) {
    await page
      .locator(ui.findSelect().findTrigger().toSelector())
      .nth(index)
      .click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }
  await field(page, "KMS key ID").fill(key);
  for (const version of [1, 2]) {
    const editing = version === 2;
    if (editing) await page.getByRole("link", { name: "Edit parameter", exact: true }).click();
    const value = "synthetic-" + version;
    const description = "Integration version " + version;
    const pattern = "^synthetic-" + version + "$";
    const policy = {
      Type: "Expiration",
      Version: "1.0",
      Attributes: { Timestamp: "2099-01-0" + version + "T00:00:00Z" },
    };
    await field(page, editing ? "New value" : "Value").fill(value);
    await field(page, "Description").fill(description);
    await field(page, "Allowed pattern").fill(pattern);
    await field(page, "Parameter policies").fill(JSON.stringify([policy]));
    await button(page, editing ? "Save changes" : "Create parameter").click();
    await expect(page).toHaveURL(detail(f.name));
    await expect(success(page)).toHaveText(
      "Parameter " + f.name + (editing ? " updated." : " created."),
    );
    const metadata = await f.metadata();
    expect(metadata).toMatchObject({
      Name: f.name,
      Version: version,
      KeyId: key,
      Type: "SecureString",
      Tier: "Advanced",
      DataType: "text",
      Description: description,
      AllowedPattern: pattern,
    });
    expect(
      metadata.Policies?.map((entry) => JSON.parse(entry.PolicyText!)),
    ).toEqual([policy]);
    const pairs = page.locator(ui.findKeyValuePairs().toSelector());
    for (const text of [
      key,
      description,
      pattern,
      "SecureString",
      "Advanced",
      "text",
      String(version),
    ])
      await expect(pairs.getByText(text, { exact: true })).toBeVisible();
    await expect(
      page.getByText(JSON.stringify(policy, null, 2), { exact: true }),
    ).toBeVisible();
    expect(await f.read()).toMatchObject({
      Name: f.name,
      Version: version,
      Value: value,
    });
  }
  for (const version of [1, 2])
    expect(await f.read(f.name + ":" + version)).toMatchObject({
      Version: version,
      Value: "synthetic-" + version,
    });
});

test("studio.ssm-parameter-duplicate", async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed();
  await page.goto(list + "/parameters/create");
  await field(page, "Name").fill(f.name);
  await field(page, "Value").fill("replacement");
  const rejection = page.waitForResponse(
    (r) =>
      r.request().headers()["x-amz-target"]?.endsWith(".PutParameter") ===
        true && r.status() === 400,
  );
  await button(page, "Create parameter").click();
  const body = await (await rejection).json();
  const reason = body.message ?? body.Message;
  expect(typeof reason).toBe("string");
  expect(reason.length).toBeGreaterThan(0);
  await expect(
    page.locator(ui.findAlert().toSelector()).filter({ hasText: reason }),
  ).toBeVisible();
  await expect(field(page, "Name")).toHaveValue(f.name);
  await expect(field(page, "Value")).toHaveValue("replacement");
  expect(await f.read()).toMatchObject({
    Name: f.name,
    Value: "fixture-one",
    Version: 1,
  });
});
