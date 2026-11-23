import createWrapper from "@cloudscape-design/components/test-utils/selectors";

import { expect, test } from "./support";
import { ACTION } from "./support/frame";
import {
  chooseVersion,
  expectHistory,
  expectNullETag,
  showHistory,
  versionDialog,
  versionFixture,
} from "./services/s3/object-versions";
import { deleteObjectDirect, s3Direct } from "./services/s3/s3";
import { expectFlash } from "./services/s3/s3-bucket-actions";
import {
  expectBucketPage,
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
    await expectBucketPage(page, f.bucket);
    await expect.poll(status, ACTION).toBe(mode);
    const successes = createWrapper().findFlashbar().findItemsByType("success");
    await expect(
      page
        .locator(successes.toSelector())
        .filter({ hasText: "Bucket versioning updated." }),
    ).toBeVisible();
    if (mode === "Enabled") {
      await page
        .locator(successes.get(1).findDismissButton().toSelector())
        .click();
      await expect(page.locator(successes.toSelector())).toHaveCount(0);
    }
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
  const older = await f.put("older body");
  await f.mode("Enabled");
  const newer = await f.put("newer body");
  const marker = await f.seeded.deleteMarker(f.bucket, f.key);
  const outside = "other/" + f.filename;
  const outsideId = await f.seeded.object(f.bucket, outside, "outside prefix");
  expect(older).toBe("null");
  expect(marker).toBeTruthy();
  expect(newer).not.toBe(older);
  const all = await f.history();
  expect(all).toHaveLength(4);
  expect(all).toEqual(
    expect.arrayContaining([
      { key: f.key, versionId: older, kind: "version", isLatest: false },
      { key: f.key, versionId: newer, kind: "version", isLatest: false },
      { key: f.key, versionId: marker, kind: "delete-marker", isLatest: true },
      { key: outside, versionId: outsideId, kind: "version", isLatest: true },
    ]),
  );
  await showHistory(page, f.bucket, "reports/");
  await expectHistory(
    page,
    all.filter((row) => row.key.startsWith("reports/")),
  );
  await chooseVersion(page, f.key, "null");
  expect(await download(page)).toEqual({
    name: f.filename,
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
  await chooseVersion(page, f.key, "null");
  const modal = await versionDialog(page, "Restore version");
  await modal.input.fill(f.key);
  await modal.submit.click();
  await expect(modal.dialog).toBeHidden();
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
  await expectFlash(page, "success", "Version restored.");
  await expect(
    page.locator(
      createWrapper().findFlashbar().findItemsByType("success").toSelector(),
    ),
  ).toBeVisible();
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
  await chooseVersion(page, f.key, older);
  const modal = await versionDialog(page, "Restore version");
  await expect(modal.dialog).toContainText(
    "replaces any existing null version",
  );
  await expect(modal.dialog).toContainText(f.key);
  await modal.input.fill("wrong key");
  await expect(modal.submit).toBeDisabled();
  expect(await f.current()).toEqual(Buffer.from("current null body"));
  await modal.input.fill(f.key);
  await modal.submit.click();
  await expect(modal.dialog).toBeHidden();
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
  // The current null ID survives this write. Its displayed ETag witnesses the new body.
  const current = await s3Direct(ctx, f.port, {
    method: "GET",
    pathname: "/" + f.bucket + "/" + f.key,
  });
  if ("error" in current) throw new Error(current.error);
  expect(current.status).toBe(200);
  expect(current.bytes).toEqual(Buffer.from("older body"));
  expect(current.headers.etag).toBeTruthy();
  await expectNullETag(page, f.key, current.headers.etag);
  await expectFlash(page, "success", "Version restored.");
  await expect(
    page.locator(
      createWrapper().findFlashbar().findItemsByType("success").toSelector(),
    ),
  ).toBeVisible();
});

test("studio.s3-remove-delete-marker", async ({ ctx, page }) => {
  const f = await versionFixture(ctx, "marker500");
  await f.mode("Enabled");
  const older = await f.put("older body");
  const newer = await f.put("newer body");
  const marker = await f.seeded.deleteMarker(f.bucket, f.key);
  if (!marker) throw new Error("Expected a versioned delete marker");
  await showHistory(page, f.bucket);
  await expectHistory(page, await f.history());
  await chooseVersion(page, f.key, marker);
  const modal = await versionDialog(page, "Remove delete marker");
  await modal.input.fill(f.key);
  await modal.submit.click();
  await expect(modal.dialog).toBeHidden();
  const after = await f.history();
  expect(after).toHaveLength(2);
  expect(after).toEqual(
    expect.arrayContaining([
      { key: f.key, versionId: older, kind: "version", isLatest: false },
      { key: f.key, versionId: newer, kind: "version", isLatest: true },
    ]),
  );
  await expectHistory(page, after);
  await expectFlash(page, "success", "Delete marker removed.");
  await expect(
    page.locator(
      createWrapper().findFlashbar().findItemsByType("success").toSelector(),
    ),
  ).toBeVisible();
  expect(await f.current()).toEqual(Buffer.from("newer body"));
});

test("studio.s3-version-download-refused", async ({ ctx, page }) => {
  const f = await versionFixture(ctx, "refused500");
  await f.mode("Enabled");
  const older = await f.put("older body");
  const newer = await f.put("newer body");
  await showHistory(page, f.bucket);
  await expectHistory(page, await f.history());
  await chooseVersion(page, f.key, older);
  const removed = await deleteObjectDirect(ctx, f.port, f.bucket, f.key, older);
  if ("error" in removed) throw new Error(removed.error);
  expect(removed.status).toBe(204);
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const refusal = page
    .locator(
      createWrapper().findFlashbar().findItemsByType("error").toSelector(),
    )
    .filter({ hasText: "NoSuchVersion" })
    .filter({ hasText: "The specified version does not exist." });
  await expect(refusal).toBeVisible();
  expect((await f.history()).find((row) => row.isLatest)?.versionId).toBe(
    newer,
  );
  expect(await f.current()).toEqual(Buffer.from("newer body"));
});
