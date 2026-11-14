// `studio.service-routes-say-no-screen-yet`, `studio.unknown-route-shows-page-not-found`: the app shell's routes as a
// user meets them in the built app served by `bun run serve`, with the engine started for that Studio and the run's
// emulator behind it (test-criteria.md, issue 3, Flow).

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';

/** The Cloudscape `SideNavigation` of the shell (requirement 2), wherever the layout puts it. */
const sideNavigation = createWrapper().findSideNavigation().toSelector();

/** Home: the address is `/` and its header is "Home". */
async function expectHome(page: Page) {
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
}

/**
 * The "no screen yet" page for a service (requirement 2.3): the address is `path`, the header is the service label,
 * the statement that Studio has no screen for it yet, and a "Go to Home" link.
 */
async function expectNoScreenYet(page: Page, label: string, path: string) {
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:\\d+${path}$`));
  await expect(page.getByRole('heading', { level: 1, name: label, exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toContainText(`Studio has no screen for ${label} yet.`);
  await expect(page.getByRole('link', { name: 'Go to Home', exact: true })).toBeVisible();
}

test('studio.service-routes-say-no-screen-yet', async ({ ctx, page }) => {
  await startStack(ctx);

  // Choose "Amazon Simple Storage Service" in the side navigation → the "no screen yet" page for it, at `/s3`.
  await page.goto('/');
  await expectHome(page);
  await page.locator(sideNavigation).getByRole('link', { name: 'Amazon Simple Storage Service', exact: true }).click();
  await expectNoScreenYet(page, 'Amazon Simple Storage Service', '/s3');

  // Open `/dynamodb/tables` directly, then refresh the page → the "no screen yet" page for Amazon DynamoDB both times.
  await page.goto('/dynamodb/tables');
  await expectNoScreenYet(page, 'Amazon DynamoDB', '/dynamodb/tables');
  await page.reload();
  await expectNoScreenYet(page, 'Amazon DynamoDB', '/dynamodb/tables');

  // Go back → the previous page again; go forward → the later page again; choose "Go to Home" → Home.
  await page.goBack();
  await expectNoScreenYet(page, 'Amazon Simple Storage Service', '/s3');
  await page.goForward();
  await expectNoScreenYet(page, 'Amazon DynamoDB', '/dynamodb/tables');
  await page.getByRole('link', { name: 'Go to Home', exact: true }).click();
  await expectHome(page);
});

test('studio.unknown-route-shows-page-not-found', async ({ ctx, page }) => {
  await startStack(ctx);

  // Open `/does-not-exist/today` directly → "Page not found" with that path; choose "Go to Home" → Home.
  await page.goto('/does-not-exist/today');
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/does-not-exist\/today$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('/does-not-exist/today');
  await page.getByRole('link', { name: 'Go to Home', exact: true }).click();
  await expectHome(page);
});
