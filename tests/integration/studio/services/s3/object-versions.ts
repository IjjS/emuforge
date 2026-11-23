import createWrapper from "@cloudscape-design/components/test-utils/selectors";
import type { Page } from "@playwright/test";

import { expect, startStack, type Ctx } from "../../support";
import { ACTION } from "../../support/frame";
import { checkPrefix } from "../../support/service-screens";
import { objectVersionsDirect, Seeded, type DirectItem } from "./s3";
import { openObjectsTab } from "./s3-bucket-page";
import { getObjectDirect } from "./s3-object-page";

const wrapper = createWrapper();
const table = wrapper.findTable();
export const key = "reports/history.txt";

export async function versionFixture(ctx: Ctx, tag: string) {
  const { emulatorPort: port } = await startStack(ctx);
  const bucket = checkPrefix(ctx, tag);
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(bucket);
  return {
    bucket,
    port,
    seeded,
    mode: (versioning: "Enabled" | "Suspended") =>
      seeded.configure(bucket, { versioning }),
    put: async (bytes: string) =>
      (await seeded.object(bucket, key, bytes)) ?? "null",
    current: () => getObjectDirect(ctx, port, bucket, key),
    history: async () => {
      const entries = await objectVersionsDirect(ctx, port, bucket);
      if (!entries) throw new Error("Fixture bucket disappeared");
      return entries;
    },
  };
}

export async function showHistory(page: Page, bucket: string, prefix = "") {
  await openObjectsTab(page, bucket, prefix);
  await page
    .locator(wrapper.findToggle().findNativeInput().toSelector())
    .check();
}

function visible(page: Page, selector: { toSelector(): string }) {
  return page.locator(selector.toSelector() + ":visible");
}

async function readRows(page: Page): Promise<DirectItem[]> {
  const count = await visible(page, table.findRows()).count();
  const rows: DirectItem[] = [];
  for (let row = 1; row <= count; row++) {
    const cell = (column: number) =>
      visible(page, table.findBodyCell(row, column)).innerText(ACTION);
    const [name, id, kind, latest] = await Promise.all([
      cell(2),
      cell(3),
      cell(4),
      cell(5),
    ]);
    expect(["Version", "Delete marker"]).toContain(kind);
    expect(["Yes", "No"]).toContain(latest);
    rows.push({
      key: name,
      versionId: id.split(/\s/)[0],
      kind: kind === "Version" ? "version" : "delete-marker",
      isLatest: latest === "Yes",
    });
  }
  return rows;
}

export async function expectHistory(page: Page, expected: DirectItem[]) {
  const byId = (rows: DirectItem[]) =>
    [...rows].sort((a, b) => a.versionId.localeCompare(b.versionId));
  await expect
    .poll(async () => byId(await readRows(page)), ACTION)
    .toEqual(byId(expected));
}

export async function chooseVersion(page: Page, id: string) {
  const rows = await readRows(page);
  const index = rows.findIndex(
    (row) => row.versionId === id && row.key === key,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await visible(page, table.findRowSelectionArea(index + 1)).click();
}

export async function versionDialog(
  page: Page,
  action: "Restore version" | "Remove delete marker",
) {
  await page.getByRole("button", { name: action, exact: true }).click();
  const dialog = page.locator(wrapper.findModal().toSelector());
  await expect(dialog).toBeVisible();
  return {
    dialog,
    input: dialog.getByRole("textbox", {
      name: "Enter the full key to confirm",
    }),
    submit: dialog.getByRole("button", { name: action, exact: true }),
  };
}
