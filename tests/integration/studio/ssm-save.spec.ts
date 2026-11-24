import { expect, test } from "./support";
import { fixture, localKey } from "./services/ssm/fixture";
import {
  button,
  detail,
  field,
  expectPair,
  list,
  success,
  ui,
} from "./services/ssm/screen";

test("studio.ssm-parameter-save", async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  const key = await localKey(ctx, f.emulatorPort);
  await page.goto(list + "/parameters/create");
  await field(page, "Name").fill(f.name);
  const formField = ui.findFormField();
  const fields = page.locator("form").locator(formField.toSelector());
  for (const [index, label, value] of [
    [1, "Type", "SecureString"],
    [4, "Tier", "Advanced"],
  ] as const) {
    const descendants = fields.nth(index).locator("*");
    await expect(page.locator(formField.findLabel().toSelector()).and(descendants)).toHaveText(label);
    const select = formField.findControl().findSelect();
    await page.locator(select.findTrigger().toSelector()).and(descendants).click();
    await page.locator(select.findDropdown().findOptionByValue(value).toSelector()).and(descendants).click();
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
    await expectPair(page, 2, "Type", metadata.Type!);
    await expectPair(page, 3, "Version", String(metadata.Version));
    await expectPair(page, 6, "Tier", metadata.Tier!);
    await expectPair(page, 7, "Data type", metadata.DataType!);
    await expectPair(page, 8, "Description", metadata.Description!);
    await expectPair(page, 9, "KMS key ID", metadata.KeyId!);
    await expectPair(page, 10, "Allowed pattern", metadata.AllowedPattern!);
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
  const response = await rejection;
  expect(response.request().postDataJSON().Name).toBe(f.name);
  const body = await response.json();
  expect((body.__type ?? response.headers()["x-amzn-errortype"])?.split("#").pop()).toBe("ParameterAlreadyExists");
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
