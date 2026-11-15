// The routes of Studio as a user meets them in the built app served by `bun run serve`, with the engine started for
// that Studio and the run's emulator behind it: issue 3's `studio.service-routes-say-no-screen-yet` and
// `studio.unknown-route-shows-page-not-found`, rewritten for the AWS area under `/aws` (R9.3), and issue 16's
// `studio.old-root-service-paths-show-page-not-found` and `studio.aws-area-unknown-path-shows-page-not-found`
// (test-criteria.md, issue 16, Integration checks).

import { expect, startStack, test } from './support';
import {
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

const S3 = 'Amazon Simple Storage Service';
const DYNAMODB = 'Amazon DynamoDB';

test('studio.service-routes-say-no-screen-yet', async ({ ctx, page }) => {
  await startStack(ctx);
  const lines = new Lines(ctx);

  await lines.line(
    '(changed) On `/`, choose "Amazon Simple Storage Service" in Home\'s "Providers" section → the "no screen yet" page for it inside the AWS area, the address is `/aws/s3`',
    async () => {
      await page.goto('/');
      await expectHome(page);
      await providersSection(page).getByRole('link', { name: S3, exact: true }).click();
      await expectNoScreenYet(page, S3, '/aws/s3');
    },
  );

  await lines.line(
    '(changed) In the AWS area\'s side navigation, choose "Amazon Simple Storage Service" → its "no screen yet" page, the address is `/aws/s3` (open `/aws/dynamodb` first)',
    async () => {
      await page.goto('/aws/dynamodb');
      await expectNoScreenYet(page, DYNAMODB, '/aws/dynamodb');
      await page.locator(SIDE_NAVIGATION).getByRole('link', { name: S3, exact: true }).click();
      await expectNoScreenYet(page, S3, '/aws/s3');
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
      await expectNoScreenYet(page, S3, '/aws/s3');
      await page.goForward();
      await expectNoScreenYet(page, DYNAMODB, '/aws/dynamodb/tables');
      await page.getByRole('link', { name: 'Go to Home', exact: true }).click();
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
  await page.getByRole('link', { name: 'Go to Home', exact: true }).click();
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

  // Open `/aws/does-not-exist/today` directly → inside the AWS area: "Page not found" with that path, breadcrumbs
  // "Amazon Web Services" then "Page not found", the side navigation with no active item; choose "Amazon Web
  // Services" in the breadcrumbs → `/aws`.
  await page.goto(path);
  await expect(page).toHaveURL(addressOf(path));
  await expectInAwsArea(page, 'Page not found');
  await expect(page.getByRole('main')).toContainText(path);
  await expect
    .poll(() => breadcrumbs(page), { message: 'the breadcrumbs' })
    .toEqual(['Amazon Web Services', 'Page not found']);
  await expect(page.locator(SIDE_NAVIGATION_ACTIVE), 'the side navigation’s active item').toHaveCount(0);
  await page
    .locator(BREADCRUMB_GROUP)
    .getByRole('link', { name: 'Amazon Web Services', exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(addressOf('/aws'));
  await expect(heading(page, 'Amazon Web Services')).toBeVisible();
});
