import {
  directStacks,
  stacksScreen,
  waitUntilCreated,
} from "./services/cloudformation/stacks";
import { expect, startStack, test } from "./support";
import { crumbLink, expectLine, notStartedOn } from "./support/aws-area";
import { addressOf, SIDE_NAVIGATION } from "./support/frame";
import { checkPrefix, SEOUL } from "./support/service-screens";

test.use({ timezoneId: SEOUL.timeZone });

test("studio.cloudformation-external-stacks", async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx, { ownEmulator: true });
  const direct = directStacks(ctx, emulatorPort);
  const screen = stacksScreen(page);
  const prefix = checkPrefix(ctx, "cfn-external");
  expect((await direct.list()).rows).toEqual([]);
  await page.goto("/aws/cloudformation");
  await expect(screen.title).toHaveText("Stacks");
  await expect(screen.empty).toContainText("No stacks");

  await waitUntilCreated(direct, await direct.create(prefix + "-first"));
  await screen.refresh.click();
  await screen.expectDetails((await direct.list()).rows);

  await page.locator(SIDE_NAVIGATION).getByRole("link", { name: "Stacks", exact: true }).click();
  await expect(page).toHaveURL(addressOf("/aws/cloudformation/stacks"));
  await screen.expectDetails((await direct.list()).rows);
  const originalDocument = await page.evaluateHandle(() => document);
  await crumbLink(page, "AWS").click();
  await expect(page).toHaveURL(addressOf("/aws"));
  expect(await page.evaluate(doc => doc === document, originalDocument)).toBe(true);
  const secondName = prefix + "-second";
  await waitUntilCreated(direct, await direct.create(secondName));
  await page.goBack();
  await expect(page).toHaveURL(addressOf("/aws/cloudformation/stacks"));
  expect(await page.evaluate(doc => doc === document, originalDocument)).toBe(true);
  await originalDocument.dispose();
  const current = (await direct.list()).rows;
  expect(current.map(stack => stack.StackName)).toContain(secondName);
  await screen.expectDetails(current);
});

test("studio.cloudformation-stack-pages", async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx, { ownEmulator: true });
  const direct = directStacks(ctx, emulatorPort);
  const prefix = checkPrefix(ctx, "cfn-pages");
  for (let index = 0; index < 102; index++)
    await direct.create(`${prefix}-${String(index).padStart(3, "0")}`);
  const first = await direct.list();
  expect(first.next).toBeTruthy();
  const second = await direct.list(first.next);
  expect(second.rows).toHaveLength(2);
  expect(second.next).toBeUndefined();
  const match = second.rows[0]!;
  const term = match.StackName!;
  expect(first.rows.some((stack) => stack.StackName === term)).toBe(false);

  const screen = stacksScreen(page);
  await page.goto("/aws/cloudformation/stacks");
  await screen.expectNames(first.rows);
  await screen.filter.fill(term);
  await expect(screen.empty).toContainText("No matching stacks");
  await screen.next.click();
  await screen.expectNames([match]);
  await expect(screen.filter).toHaveValue(term);
  await screen.filter.fill("");
  await expect(screen.filter).toHaveValue("");
  await screen.expectNames(second.rows);
  await screen.refresh.click();
  await screen.expectNames((await direct.list()).rows);
});

test("studio.cloudformation-stacks-reconnect", async ({ ctx, page }) => {
  const { emulator, emulatorPort } = await startStack(ctx, {
    ownEmulator: true,
  });
  const direct = directStacks(ctx, emulatorPort);
  await waitUntilCreated(
    direct,
    await direct.create(checkPrefix(ctx, "cfn-restart")),
  );
  await page.goto("/aws/cloudformation/stacks");
  const screen = stacksScreen(page);
  await screen.expectDetails((await direct.list()).rows);
  await emulator!.stop();
  await expectLine(page, notStartedOn(emulatorPort));
  await expect(screen.empty).toContainText(
    "Check that the local emulator is running on the configured port, then retry.",
  );
  await emulator!.startAgain();
  await expect(screen.empty).toContainText("No stacks", { timeout: 60_000 });
  await expect(screen.rows).toHaveCount(0);
  // Restart writes fresh credentials and a new CA at the same port.
  expect((await directStacks(ctx, emulatorPort).list()).rows).toEqual([]);
});
