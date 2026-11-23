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

export async function versionFixture(ctx: Ctx, tag: string) {
  const { emulatorPort: port } = await startStack(ctx);
  const bucket = checkPrefix(ctx, tag);
  const filename = bucket + "-history.txt";
  const key = "reports/" + filename;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(bucket);
  return {
    bucket,
    key,
    filename,
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

function readRows(page: Page) {
  // Expand only the row index of each Cloudscape selector inside the atomic DOM read.
  const rowSlot = 987654321;
  const columns = [2, 3, 4, 5].map((column) =>
    table.findBodyCell(rowSlot, column).toSelector(),
  );
  return visible(page, table.findRows()).evaluateAll(
    (elements, { columns, rowSlot }) =>
      elements.map((row, index) => {
        const [key, id, type, latest] = columns.map(
          (selector) =>
            row.querySelector<HTMLElement>(
              selector.replace(String(rowSlot), String(index + 1)),
            )?.innerText,
        );
        return { key, versionId: id?.split(/\s/)[0] ?? "", type, latest };
      }),
    { columns, rowSlot },
  );
}

export async function expectHistory(page: Page, expected: DirectItem[]) {
  const byId = (a: { versionId: string }, b: { versionId: string }) =>
    a.versionId.localeCompare(b.versionId);
  const wanted = expected
    .map((row) => ({
      key: row.key,
      versionId: row.versionId,
      type: row.kind === "version" ? "Version" : "Delete marker",
      latest: row.isLatest ? "Yes" : "No",
    }))
    .sort(byId);
  await expect
    .poll(async () => (await readRows(page)).sort(byId), ACTION)
    .toEqual(wanted);
}

export async function chooseVersion(page: Page, key: string, id: string) {
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
