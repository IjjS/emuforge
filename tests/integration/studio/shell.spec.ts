// The routes of Studio as a user meets them in the built app served by `bun run serve`, with the engine started for
// that Studio and the run's emulator behind it: issue 3's `studio.service-routes-say-no-screen-yet` and
// `studio.unknown-route-shows-page-not-found`, rewritten for the AWS area under `/aws` (R9.3), and issue 16's
// `studio.old-root-service-paths-show-page-not-found` and `studio.aws-area-unknown-path-shows-page-not-found`
// (test-criteria.md, issue 16, Integration checks).

import { expect, NO_SCREEN_SERVICE, startStack, test } from './support';
import {
  ACTION,
  addressOf,
  BREADCRUMB_GROUP,
  breadcrumbs,
  expectHome,
  expectInAwsArea,
  expectNoScreenYet,
  expectStudioNotFound,
  heading,
  providersSection,
  SIDE_NAVIGATION,
  SIDE_NAVIGATION_ACTIVE,
} from './support/frame';
import { Lines } from './support/lines';

const SERVICE = NO_SCREEN_SERVICE.label;
const DYNAMODB = 'Amazon DynamoDB';

test('studio.service-routes-say-no-screen-yet', async ({ ctx, page }) => {
  await startStack(ctx);
  const lines = new Lines(ctx);

  await lines.line(
    '(changed) On `/`, choose "Amazon Kinesis" in Home\'s "Providers" section → the "no screen yet" page for it inside the AWS area, the address is `/aws/kinesis`',
    async () => {
      await page.goto('/');
      await expectHome(page);
      await providersSection(page).getByRole('link', { name: SERVICE, exact: true }).click(ACTION);
      await expectNoScreenYet(page, SERVICE, NO_SCREEN_SERVICE.path);
    },
  );

  await lines.line(
    '(changed) In the AWS area\'s side navigation, choose "Amazon Kinesis" → its "no screen yet" page, the address is `/aws/kinesis` (open `/aws/dynamodb` first)',
    async () => {
      await page.goto('/aws/dynamodb');
      await expectNoScreenYet(page, DYNAMODB, '/aws/dynamodb');
      await page.locator(SIDE_NAVIGATION).getByRole('link', { name: SERVICE, exact: true }).click(ACTION);
      await expectNoScreenYet(page, SERVICE, NO_SCREEN_SERVICE.path);
    },
  );

  await lines.line(
    'Open `/aws/dynamodb/tables` directly, then refresh the page → the "no screen yet" page for Amazon DynamoDB both times',
    async () => {
      await page.goto('/aws/dynamodb/tables');
      await expectNoScreenYet(page, DYNAMODB, '/aws/dynamodb/tables');
      await page.reload();
      await expectNoScreenYet(page, DYNAMODB, '/aws/dynamodb/tables');
    },
  );

  await lines.line(
    'Go back → the previous page is shown again; go forward → the later page again; choose "Go to Home" → Home',
    async () => {
      await page.goBack();
      await expectNoScreenYet(page, SERVICE, NO_SCREEN_SERVICE.path);
      await page.goForward();
      await expectNoScreenYet(page, DYNAMODB, '/aws/dynamodb/tables');
      await page.getByRole('link', { name: 'Go to Home', exact: true }).click(ACTION);
      await expectHome(page);
    },
  );

  lines.end();
});

test('studio.unknown-route-shows-page-not-found', async ({ ctx, page }) => {
  await startStack(ctx);

  // Open `/does-not-exist/today` directly → Studio's "Page not found" with that path, outside any provider area;
  // choose "Go to Home" → Home.
  await page.goto('/does-not-exist/today');
  await expectStudioNotFound(page, '/does-not-exist/today');
  await page.getByRole('link', { name: 'Go to Home', exact: true }).click(ACTION);
  await expectHome(page);
});

test('studio.old-root-service-paths-show-page-not-found', async ({ ctx, page }) => {
  await startStack(ctx);
  const lines = new Lines(ctx);

  // Open `/s3` and `/dynamodb/tables` directly → Studio's "Page not found" with that path, the address unchanged (no
  // redirect), no AWS area on the page (R4.2).
  for (const path of ['/s3', '/dynamodb/tables']) {
    await lines.line(
      `Open \`${path}\` directly → Studio's "Page not found" with that path, no redirect, no AWS area`,
      async () => {
        await page.goto(path);
        await expectStudioNotFound(page, path);
        await expect(page.locator(SIDE_NAVIGATION), 'the AWS area’s side navigation').toHaveCount(0);
      },
    );
  }

  lines.end();
});

test('studio.aws-area-unknown-path-shows-page-not-found', async ({ ctx, page }) => {
  await startStack(ctx);
  const path = '/aws/does-not-exist/today';

  // (changed, issue 45) Open `/aws/does-not-exist/today` directly → inside the AWS area: "Page not found" with that
  // path, crumbs "EmuForge", "AWS", "Page not found", the side navigation with no active item; choose "AWS" in the
  // crumbs → `/aws`.
  await page.goto(path);
  await expect(page).toHaveURL(addressOf(path));
  await expectInAwsArea(page, 'Page not found');
  await expect(page.getByRole('main')).toContainText(path);
  await expect
    .poll(() => breadcrumbs(page), { message: 'the breadcrumbs' })
    .toEqual(['EmuForge', 'AWS', 'Page not found']);
  await expect(page.locator(SIDE_NAVIGATION_ACTIVE), 'the side navigation’s active item').toHaveCount(0);
  await page
    .locator(BREADCRUMB_GROUP)
    .getByRole('link', { name: 'AWS', exact: true })
    .filter({ visible: true })
    .click(ACTION);
  await expect(page).toHaveURL(addressOf('/aws'));
  await expect(heading(page, 'Amazon Web Services')).toBeVisible();
});
