import createWrapper from "@cloudscape-design/components/test-utils/selectors";

import { expect, test } from "./support";
import { ACTION } from "./support/frame";
import {
  chooseVersion,
  expectHistory,
  key,
  showHistory,
  versionDialog,
  versionFixture,
} from "./services/s3/object-versions";
import { deleteObjectDirect, s3Direct } from "./services/s3/s3";
import { expectFlash } from "./services/s3/s3-bucket-actions";
import {
  openBucketPage,
  readSection,
  sectionButton,
  VERSIONING,
} from "./services/s3/s3-bucket-page";
import { download } from "./services/s3/s3-object-page";

test("studio.s3-edit-bucket-versioning", async ({ ctx, page }) => {
  const f = await versionFixture(ctx, "settings500");
  const status = async () =>
    (await readSection(page, VERSIONING, [VERSIONING]))?.fields[VERSIONING];
  await openBucketPage(page, f.bucket);
  await expect.poll(status, ACTION).toBe("Disabled");
  for (const mode of ["Enabled", "Suspended"] as const) {
    await sectionButton(page, VERSIONING, "Edit").click();
    await page
      .locator(
        createWrapper().findRadioGroup().findInputByValue(mode).toSelector(),
      )
      .check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expectFlash(page, "success", "Bucket versioning updated.");
    await expect.poll(status, ACTION).toBe(mode);
    const result = await s3Direct(ctx, f.port, {
      method: "GET",
      pathname: "/" + f.bucket,
      query: [["versioning", ""]],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.status).toBe(200);
    expect(result.body).toContain("<Status>" + mode + "</Status>");
  }
});

test("studio.s3-download-historical-version", async ({ ctx, page }) => {
  const f = await versionFixture(ctx, "download500");
  await f.mode("Enabled");
  await f.mode("Suspended");
  await f.put("older body");
  await f.mode("Enabled");
  await f.put("newer body");
  await f.seeded.deleteMarker(f.bucket, key);
  await f.seeded.object(f.bucket, "outside.txt", "outside prefix");
  await showHistory(page, f.bucket, "reports/");
  await expectHistory(
    page,
    (await f.history()).filter((row) => row.key.startsWith("reports/")),
  );
  await chooseVersion(page, "null");
  expect(await download(page)).toEqual({
    name: "history.txt",
    bytes: Buffer.from("older body"),
  });
});

test("studio.s3-restore-enabled-version", async ({ ctx, page }) => {
  const f = await versionFixture(ctx, "enabled500");
  await f.mode("Enabled");
  await f.mode("Suspended");
  await f.put("older body");
  await f.mode("Enabled");
  const newer = await f.put("newer body");
  await showHistory(page, f.bucket);
  await expectHistory(page, await f.history());
  await chooseVersion(page, "null");
  const modal = await versionDialog(page, "Restore version");
  await modal.input.fill(key);
  await modal.submit.click();
  await expectFlash(page, "success", "Version restored.");
  const after = await f.history();
  expect(
    after
      .filter((row) => !row.isLatest)
      .map((row) => row.versionId)
      .sort(),
  ).toEqual(["null", newer].sort());
  const current = after.filter((row) => row.isLatest);
  expect(current).toHaveLength(1);
  expect([newer, "null"]).not.toContain(current[0].versionId);
  await expectHistory(page, after);
  expect(await f.current()).toEqual(Buffer.from("older body"));
});

test("studio.s3-restore-suspended-version", async ({ ctx, page }) => {
  const f = await versionFixture(ctx, "suspended500");
  await f.mode("Enabled");
  const older = await f.put("older body");
  const newer = await f.put("newer body");
  await f.mode("Suspended");
  await f.put("current null body");
  await showHistory(page, f.bucket);
  await expectHistory(page, await f.history());
  await chooseVersion(page, older);
  const modal = await versionDialog(page, "Restore version");
  await expect(modal.dialog).toContainText(
    "replaces any existing null version",
  );
  await expect(modal.dialog).toContainText(key);
  await modal.input.fill("wrong key");
  await expect(modal.submit).toBeDisabled();
  expect(await f.current()).toEqual(Buffer.from("current null body"));
  await modal.input.fill(key);
  await modal.submit.click();
  await expectFlash(page, "success", "Version restored.");
  const after = await f.history();
  expect(
    after.filter((row) => row.isLatest).map((row) => row.versionId),
  ).toEqual(["null"]);
  expect(
    after
      .filter((row) => !row.isLatest)
      .map((row) => row.versionId)
      .sort(),
  ).toEqual([older, newer].sort());
  await expectHistory(page, after);
  expect(await f.current()).toEqual(Buffer.from("older body"));
});

test("studio.s3-remove-delete-marker", async ({ ctx, page }) => {
  const f = await versionFixture(ctx, "marker500");
  await f.mode("Enabled");
  const older = await f.put("older body");
  const newer = await f.put("newer body");
  const marker = await f.seeded.deleteMarker(f.bucket, key);
  if (!marker) throw new Error("Expected a versioned delete marker");
  await showHistory(page, f.bucket);
  await expectHistory(page, await f.history());
  await chooseVersion(page, marker);
  const modal = await versionDialog(page, "Remove delete marker");
  await modal.input.fill(key);
  await modal.submit.click();
  await expectFlash(page, "success", "Delete marker removed.");
  const after = await f.history();
  expect(after.map((row) => row.versionId).sort()).toEqual(
    [older, newer].sort(),
  );
  expect(after.find((row) => row.isLatest)?.versionId).toBe(newer);
  await expectHistory(page, after);
  expect(await f.current()).toEqual(Buffer.from("newer body"));
});

test("studio.s3-version-download-refused", async ({ ctx, page }) => {
  const f = await versionFixture(ctx, "refused500");
  await f.mode("Enabled");
  const older = await f.put("older body");
  const newer = await f.put("newer body");
  await showHistory(page, f.bucket);
  await expectHistory(page, await f.history());
  await chooseVersion(page, older);
  const removed = await deleteObjectDirect(ctx, f.port, f.bucket, key, older);
  if ("error" in removed) throw new Error(removed.error);
  expect(removed.status).toBe(204);
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expectFlash(page, "error", "NoSuchVersion");
  await expectFlash(page, "error", "The specified version does not exist.");
  expect((await f.history()).find((row) => row.isLatest)?.versionId).toBe(
    newer,
  );
  expect(await f.current()).toEqual(Buffer.from("newer body"));
});
