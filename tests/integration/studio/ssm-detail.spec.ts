import { expect, test } from "./support";
import { fixture } from "./services/ssm/fixture";
import {
  button,
  cell,
  detail,
  field,
  expectPair,
  modal,
  rows,
  ui,
} from "./services/ssm/screen";

test("studio.ssm-parameter-versions", async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed({ Type: "SecureString" });
  await f.seed({ Type: "SecureString", Value: "fixture-two", Overwrite: true });
  await page.goto(detail(f.name));
  const control = page.getByRole("radio", { name: "Version 1", exact: true });
  for (const version of [2, 1]) {
    if (version === 1) {
      await button(page, "Version history").click();
      await control.check();
      await expect(await cell(page, control, 2, "Version")).toHaveText("1");
    }
    const direct = await f.read(version === 2 ? f.name : f.name + ":1");
    expect(direct).toMatchObject({
      Version: version,
      Value: version === 2 ? "fixture-two" : "fixture-one",
    });
    if (version === 2) await expectPair(page, 3, "Version", String(direct.Version));
    const region = page.getByRole("region", {
      name: version === 2 ? "Current value" : "Version 1 actions",
    });
    const shown = region.getByText(direct.Value!, { exact: true });
    await expect(shown).toBeHidden();
    await button(region, "Show value").click();
    await expect(shown).toBeVisible();
    await button(region, "Hide value").click();
    await expect(shown).toBeHidden();
  }
  for (const adding of [true, false]) {
    const action = adding ? "Add labels" : "Remove labels";
    await button(
      page.getByRole("region", { name: "Version 1 actions" }),
      action,
    ).click();
    if (adding) await field(modal(page), "Labels").fill("stable");
    else await modal(page).getByRole("checkbox", { name: "stable" }).check();
    await button(modal(page), action).click();
    await expect(modal(page)).toBeHidden();
    const versions = (await f.client.getParameterHistory({ Name: f.name }))
      .Parameters!;
    const first = versions.find((entry) => entry.Version === 1)!;
    expect(first.Labels ?? []).toEqual(adding ? ["stable"] : []);
    await expect(await cell(page, control, 4, "Labels")).toHaveText(
      first.Labels?.join(", ") || "-",
    );
  }
});

test("studio.ssm-parameter-tags", async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed();
  await page.goto(detail(f.name));
  await button(page, "Tags").click();
  const table = page.getByRole("table", { name: "Parameter tags" });
  const tagRows = rows(page).and(table.getByRole("row"));
  const empty = page.locator(ui.findTable().findEmptySlot().toSelector()).and(table.locator("*"));
  await expect(empty).toHaveText("No tags");
  await expect(tagRows).toHaveCount(0);
  for (const [action, submit, value] of [
    ["Add tag", "Add tag", "first"],
    ["Edit tag scope", "Save tag", "second"],
    ["Remove tag scope", "Remove tag", ""],
  ] as const) {
    await button(page, action).click();
    if (action === "Add tag") await field(modal(page), "Key").fill("scope");
    if (value) await field(modal(page), "Value").fill(value);
    await button(modal(page), submit).click();
    await expect(modal(page)).toBeHidden();
    const tags =
      (
        await f.client.listTagsForResource({
          ResourceType: "Parameter",
          ResourceId: f.name,
        })
      ).TagList ?? [];
    expect(tags).toEqual(value ? [{ Key: "scope", Value: value }] : []);
    await expect(tagRows).toHaveCount(tags.length);
    if (value) {
      const key = page.getByRole("rowheader", { name: "scope", exact: true });
      await expect(await cell(page, key, 1, "Key")).toHaveText(tags[0]!.Key!);
      await expect(await cell(page, key, 2, "Value")).toHaveText(tags[0]!.Value!);
    } else {
      await expect(empty).toHaveText("No tags");
    }
  }
});

test("studio.ssm-parameter-resource-policy", async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  await f.seed({ Tier: "Advanced" });
  const arn = (await f.read()).ARN!;
  const policies = async () =>
    (await f.client.getResourcePolicies({ ResourceArn: arn })).Policies ?? [];
  await page.goto(detail(f.name));
  await button(page, "Resource policies").click();
  let id = "";
  for (const sid of ["Original", "Revised"]) {
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: sid,
          Effect: "Allow",
          Principal: { AWS: "arn:aws:iam::111111111111:root" },
          Action: "ssm:GetParameter",
          Resource: arn,
        },
      ],
    };
    await button(
      page,
      id ? "Edit resource policy " + id : "Create resource policy",
    ).click();
    await field(modal(page), "Policy document").fill(JSON.stringify(policy));
    await button(modal(page), "Save resource policy").click();
    await expect(modal(page)).toBeHidden();
    const records = await policies();
    expect(records).toHaveLength(1);
    if (!id) id = records[0]!.PolicyId!;
    expect(id).toBeTruthy();
    expect(records[0]!.PolicyId).toBe(id);
    const direct = JSON.parse(records[0]!.Policy!);
    expect(direct).toEqual(policy);
    const panel = page
      .locator(ui.findContainer().toSelector())
      .filter({ has: button(page, "Edit resource policy " + id) });
    await expect(
      panel.getByText(JSON.stringify(direct, null, 2), { exact: true }),
    ).toBeVisible();
  }
  await button(page, "Delete resource policy " + id).click();
  await field(modal(page), "Confirmation").fill("delete");
  await button(modal(page), "Delete resource policy").click();
  await expect(modal(page)).toBeHidden();
  await expect(
    page.getByText("No resource policies", { exact: true }),
  ).toBeVisible();
  await expect(button(page, "Edit resource policy " + id)).toHaveCount(0);
  expect(await policies()).toEqual([]);
});
