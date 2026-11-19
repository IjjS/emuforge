// The policy list (S4, `/aws/iam/policies`) in the built app served by `bun run serve`, in front of a real engine
// started for that Studio and the run's emulator (test-criteria.md of issue 535, Integration): the side navigation's
// "Policies", the choice "Policy type" with its three scopes, the filter, the next page by the emulator's `Marker`,
// "Refresh policies", "Delete" unavailable for an AWS managed policy, and a name leading to the policy's page.
//
// `studio.iam-policy-list-shows-what-the-emulator-holds`.
//
// Other checks make policies on the run's emulator at the same time, so the check names its own with its prefix
// `<p>` and reads them under a filter that holds it. Policies and the role are made directly
// (`services/iam/iam.ts`) and taken apart when the check ends.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION, SIDE_NAVIGATION, SIDE_NAVIGATION_ACTIVE } from './support/frame';
import { Lines } from './support/lines';
import { appeared, watchText } from './support/service-screens';
import { IamSeeded, LAMBDA_BASIC, LAMBDA_BASIC_NAME, policiesPageDirect } from './services/iam/iam';
import {
  addressOf,
  applyFilter,
  button,
  h1,
  iamPrefix,
  policyPath,
  POLICIES_PATH,
  ROLES_PATH,
  rowsOf,
  table,
  TYPE_AWS,
  TYPE_CUSTOMER,
  unavailableReason,
} from './services/iam/iam-screens';

const POLICIES = 'Policies';
const TYPE_CHOICE = 'Policy type';
const ALL_TYPES = 'All types';
const COLUMNS = ['Policy name', 'Type', 'Attached entities', 'Last changed'];
const DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/;
const REFRESHED = 'Policies refreshed';
const NO_MATCHES = 'No matches';
const DELETE_REASON = 'An AWS managed policy cannot be deleted.';
/** The list's page size as it opens. */
const PAGE_SIZE = 20;

/** The rows of the list under `COLUMNS`. */
function rows(page: Page): Promise<string[][]> {
  return rowsOf(table(page, POLICIES), COLUMNS);
}

/** Chooses `label` in "Policy type". */
async function chooseType(page: Page, label: string): Promise<void> {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: new RegExp(`^${TYPE_CHOICE}`) }).click(ACTION);
  await page.getByRole('option', { name: label, exact: true }).click(ACTION);
  await expect(
    main.getByRole('button', { name: new RegExp(`^${TYPE_CHOICE}`) }),
    `"${TYPE_CHOICE}" is "${label}"`,
  ).toContainText(label);
}

/** Opens S4 and waits for its `h1`. */
async function openList(page: Page): Promise<void> {
  await page.goto(POLICIES_PATH);
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1, name: new RegExp(`^${POLICIES}(\\s|$)`) }),
    'the h1 "Policies"',
  ).toBeVisible();
}

test('studio.iam-policy-list-shows-what-the-emulator-holds', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = iamPrefix(ctx, 'pollist');
  const seeded = new IamSeeded(ctx, port);
  const main = page.getByRole('main');

  const alpha = await seeded.policy(`${p}-alpha`);
  await seeded.policy(`${p}-beta`);
  await seeded.role(`${p}-r`);
  await seeded.attach(`${p}-r`, alpha);

  await lines.line(
    'From S1, "Policies" in the side navigation → S4 opens, "Policies" is the current entry and "Policy type" is "Customer managed"; with the filter `<p>-` the table holds `<p>-alpha` ("Customer managed", 1 under "Attached entities") and `<p>-beta` (0), each with a date under "Last changed", and no AWS managed policy',
    async () => {
      await page.goto(ROLES_PATH);
      await expect(
        main.getByRole('heading', { level: 1, name: /^Roles(\s|$)/ }),
        'the role list',
      ).toBeVisible();
      await page.locator(SIDE_NAVIGATION).getByRole('link', { name: POLICIES, exact: true }).click(ACTION);
      await expect.poll(() => addressOf(page), { message: 'the address of S4' }).toBe(POLICIES_PATH);
      await expect(page.locator(SIDE_NAVIGATION_ACTIVE), 'the current entry').toHaveText(POLICIES);
      await expect(
        main.getByRole('button', { name: new RegExp(`^${TYPE_CHOICE}`) }),
        `"${TYPE_CHOICE}" as the list opens`,
      ).toContainText(TYPE_CUSTOMER);
      await applyFilter(main, `${p}-`);
      await expect
        .poll(async () => (await rows(page)).map((r) => r.slice(0, 3)), { message: `the rows under ${p}-` })
        .toEqual([
          [`${p}-alpha`, TYPE_CUSTOMER, '1'],
          [`${p}-beta`, TYPE_CUSTOMER, '0'],
        ]);
      for (const row of await rows(page)) expect(row[3], `"Last changed" of ${row[0]}`).toMatch(DATE);
    },
  );

  await lines.line(
    '"AWS managed", the filter `AWSLambdaBasicExecutionRole` → that policy, "AWS managed"; the filter `<p>-` → the no-match state',
    async () => {
      await openList(page);
      await chooseType(page, TYPE_AWS);
      await applyFilter(main, LAMBDA_BASIC_NAME);
      await expect
        .poll(async () => (await rows(page)).map((r) => r.slice(0, 2)), { message: 'the rows of "AWS managed"' })
        .toEqual([[LAMBDA_BASIC_NAME, TYPE_AWS]]);
      await applyFilter(main, `${p}-`);
      await expect(table(page, POLICIES).getByText(NO_MATCHES, { exact: true }), 'the no-match state').toBeVisible();
      expect(await rows(page), 'no row under the check\'s prefix on "AWS managed"').toEqual([]);
    },
  );

  await lines.line(
    '"AWS managed" with no filter, the next page → its first row is the first policy a direct `ListPolicies` with `Scope` `AWS`, the page\'s size and the first answer\'s `Marker` returns',
    async () => {
      const first = await policiesPageDirect(ctx, port, 'AWS', PAGE_SIZE);
      expect(first.marker, 'a direct first page of `Scope` `AWS` is truncated').not.toBeNull();
      const second = await policiesPageDirect(ctx, port, 'AWS', PAGE_SIZE, first.marker ?? '');
      await openList(page);
      await chooseType(page, TYPE_AWS);
      await expect
        .poll(async () => (await rows(page))[0]?.[0], { message: 'the first row of the first page' })
        .toBe(first.names[0]);
      await main.getByRole('button', { name: 'Next page', exact: true }).click(ACTION);
      await expect
        .poll(async () => (await rows(page))[0]?.[0], { message: 'the first row of the next page' })
        .toBe(second.names[0]);
    },
  );

  await lines.line(
    '"All types", the filter `<p>-alpha` → that policy; the filter `AWSLambdaBasicExecutionRole` → that policy',
    async () => {
      await openList(page);
      await chooseType(page, ALL_TYPES);
      await applyFilter(main, `${p}-alpha`);
      await expect
        .poll(async () => (await rows(page)).map((r) => r.slice(0, 2)), { message: `the rows under ${p}-alpha` })
        .toEqual([[`${p}-alpha`, TYPE_CUSTOMER]]);
      await applyFilter(main, LAMBDA_BASIC_NAME);
      await expect
        .poll(async () => (await rows(page)).map((r) => r.slice(0, 2)), { message: 'the rows under the AWS name' })
        .toEqual([[LAMBDA_BASIC_NAME, TYPE_AWS]]);
    },
  );

  await lines.line(
    'A policy `<p>-late` made directly, then "Refresh policies" on "Customer managed" with the filter `<p>-` → it is listed and "Policies refreshed" is reported',
    async () => {
      await openList(page);
      await applyFilter(main, `${p}-`);
      await expect.poll(async () => (await rows(page)).length, { message: 'the rows before' }).toBe(2);
      await seeded.policy(`${p}-late`);
      await watchText(page, REFRESHED);
      await button(main, 'Refresh policies').click(ACTION);
      await expect
        .poll(async () => (await rows(page)).map((r) => r[0]), { message: 'the rows after "Refresh policies"' })
        .toEqual([`${p}-alpha`, `${p}-beta`, `${p}-late`]);
      await expect.poll(() => appeared(page, REFRESHED), { message: `"${REFRESHED}" is reported` }).toBe(true);
    },
  );

  await lines.line(
    'Choose the AWS managed policy on "AWS managed" → "Delete" is unavailable with "An AWS managed policy cannot be deleted."',
    async () => {
      await openList(page);
      await chooseType(page, TYPE_AWS);
      await applyFilter(main, LAMBDA_BASIC_NAME);
      await expect.poll(async () => (await rows(page)).length, { message: 'the one row' }).toBe(1);
      await main.getByRole('radio', { name: LAMBDA_BASIC_NAME, exact: true }).check(ACTION);
      await expect
        .poll(() => unavailableReason(button(main, 'Delete')), { message: 'the reason on "Delete"' })
        .toBe(DELETE_REASON);
    },
  );

  await lines.line('The name `<p>-alpha` → S5 of its ARN', async () => {
    await openList(page);
    await applyFilter(main, `${p}-alpha`);
    await main.getByRole('link', { name: `${p}-alpha`, exact: true }).click(ACTION);
    await expect.poll(() => addressOf(page), { message: 'the address of S5' }).toBe(policyPath(alpha));
    await expect(h1(page, `${p}-alpha`), "the policy's h1").toBeVisible();
    expect(LAMBDA_BASIC, 'basic is an AWS managed ARN').toContain(':aws:policy/');
  });

  lines.end();
});
