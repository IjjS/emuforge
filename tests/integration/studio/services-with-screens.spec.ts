// What Studio's two first pages say about which services have a Studio screen, in the built app served by
// `bun run serve` in front of a real engine and the run's emulator (test-criteria.md, issues 494 and 61, Integration):
// `studio.home-providers-line-counts-services-with-a-screen`, `studio.aws-index-groups-services-by-screen`.
//
// Neither check holds the names or the number of the services that have a screen: both compute them from the checkout
// under test, the service folders that hold a `screens.ts` (`SERVICES_ON_DISK`). Amazon Simple Storage Service is
// named only as the one service whose link is followed. The pages call no AWS operation.

import type { Page, Response } from '@playwright/test';

import { expect, startStack, test } from './support';
import {
  ACTION,
  addressOf,
  cloudscapeElements,
  expectInAwsArea,
  expectNoScreenYet,
  providersSection,
} from './support/frame';
import { SERVICES_ON_DISK } from './support/home';
import { Lines } from './support/lines';

const S3 = 'Amazon Simple Storage Service';
const BUCKETS = 'Buckets';

const WITH = SERVICES_ON_DISK.filter((service) => service.hasScreen).map((service) => service.label);
const WITHOUT = SERVICES_ON_DISK.filter((service) => !service.hasScreen).map((service) => service.label);
const S = SERVICES_ON_DISK.length;
const W = WITH.length;

/** The visible text of `page`'s element, a no-break space read as a space and runs of white space as one. */
function plain(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** Records every script and stylesheet the page receives, by resource type or by content type, with its text. */
function recordAssets(page: Page): { received: { url: string; body: string }[]; settle: () => Promise<void> } {
  const received: { url: string; body: string }[] = [];
  const pending: Promise<unknown>[] = [];
  page.on('response', (response: Response) => {
    const type = response.request().resourceType();
    const contentType = response.headers()['content-type'] ?? '';
    if (type !== 'script' && type !== 'stylesheet' && !/javascript|text\/css/u.test(contentType)) return;
    pending.push(
      response
        .body()
        .then((body) => received.push({ url: response.url(), body: body.toString('utf8') }))
        .catch(() => received.push({ url: response.url(), body: '' })),
    );
  });
  return { received, settle: async () => void (await Promise.all(pending)) };
}

/** The labels of the links inside the group named `name` on the index: an element named by a level-3 heading. */
async function groupLinks(page: Page, name: string): Promise<string[]> {
  await expect(page.getByRole('heading', { level: 3, name, exact: true }), `the level-3 heading "${name}"`).toHaveCount(
    1,
  );
  const group = page.getByRole('region', { name, exact: true });
  await expect(group, `the element named "${name}"`).toHaveCount(1);
  return (await group.getByRole('link').allInnerTexts()).map(plain);
}

test('studio.home-providers-line-counts-services-with-a-screen', async ({ ctx, page, context }) => {
  await startStack(ctx);
  const lines = new Lines(ctx);
  // The check is about a build in which a service has a screen; in any other it does not apply, and says so.
  expect(W, 'services of the checkout whose folder holds a screens.ts').toBeGreaterThan(0);
  // Nothing comes from a cache, so the scripts and stylesheets of the fresh load are all observed.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const assets = recordAssets(page);
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true }), 'both rows "Connected"').toHaveCount(2);

  await lines.line(
    'On that fresh load of `/`, before any link is followed → no script or stylesheet of the AWS area was requested',
    async () => {
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
      await assets.settle();
      expect(assets.received.length, 'scripts and stylesheets received').toBeGreaterThan(0);
      // Every screen of the area is built from Cloudscape, so a file of the area holds a Cloudscape class name.
      const ofArea = assets.received.filter((r) => r.body.includes('awsui_')).map((r) => new URL(r.url).pathname);
      expect(ofArea, 'received with a Cloudscape class name').toEqual([]);
      expect(await cloudscapeElements(page), 'elements with a Cloudscape class').toEqual([]);
    },
  );

  await lines.line(
    'Open `/` → under "Amazon Web Services" in "Providers" the line reads "S services · W with a Studio screen", and no text of the section says "no Studio screen yet"; following "Amazon Simple Storage Service" from the section opens the bucket list, whose `h1` is "Buckets" (regression, issue 494)',
    async () => {
      const section = providersSection(page);
      await expect(section.getByRole('link', { name: 'Amazon Web Services' })).toBeVisible();
      const text = plain(await section.innerText());
      const line = `${String(S)} ${S === 1 ? 'service' : 'services'} · ${String(W)} with a Studio screen`;
      expect(text, `the section's text holds "${line}"`).toContain(line);
      expect(text, 'the section does not say "no Studio screen yet"').not.toContain('no Studio screen yet');
      await section.getByRole('link', { name: S3, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf('/aws/s3'));
      await expectInAwsArea(page, BUCKETS);
    },
  );

  lines.end();
});

test('studio.aws-index-groups-services-by-screen', async ({ ctx, page }) => {
  await startStack(ctx);
  const lines = new Lines(ctx);
  // The check is about a build in which some services have a screen and some have none; in any other it does not
  // apply, and says so.
  expect(W, 'services of the checkout whose folder holds a screens.ts').toBeGreaterThan(0);
  expect(W, 'and at least one service has none').toBeLessThan(S);
  const withName = `With a Studio screen (${String(W)})`;
  const withoutName = `No Studio screen yet (${String(S - W)})`;

  await lines.line(
    'Open `/aws` → "Services (S)" has the description "W of S services have a Studio screen." (or "1 of S services has a Studio screen." when W is one), and the page nowhere says "No service has a Studio screen yet." (regression, issue 61)',
    async () => {
      await page.goto('/aws');
      await expectInAwsArea(page, 'Amazon Web Services');
      const main = plain(await page.getByRole('main').innerText());
      const statement =
        W === 1
          ? `1 of ${String(S)} services has a Studio screen.`
          : `${String(W)} of ${String(S)} services have a Studio screen.`;
      await expect(page.getByRole('heading', { level: 2, name: /^Services\b/u })).toContainText(`(${String(S)})`);
      expect(main, `the page says "${statement}"`).toContain(statement);
      expect(main, 'the page does not say that no service has a screen').not.toContain(
        'No service has a Studio screen yet.',
      );
    },
  );

  await lines.line(
    'On `/aws` → a group is a level-3 heading with the group\'s name and an element (a list or a region) whose accessible name is that heading\'s text, found by role and name; the group named "With a Studio screen (W)" holds exactly the links of the services whose folder holds a `screens.ts`, by their labels, in label order; the group named "No Studio screen yet (S − W)" holds exactly the others, in label order; every service is linked once',
    async () => {
      await page.goto('/aws');
      await expectInAwsArea(page, 'Amazon Web Services');
      expect(await groupLinks(page, withName), `the links of "${withName}"`).toEqual(WITH);
      expect(await groupLinks(page, withoutName), `the links of "${withoutName}"`).toEqual(WITHOUT);
      // Every service is linked once in "Services": the two groups together hold each label exactly once. (The
      // area's side navigation, which lists the services too, is outside both groups.)
      const linked = [...(await groupLinks(page, withName)), ...(await groupLinks(page, withoutName))];
      expect([...linked].sort(), 'the links of both groups together').toEqual(
        SERVICES_ON_DISK.map((service) => service.label).sort(),
      );
    },
  );

  await lines.line(
    'Follow "Amazon Simple Storage Service" from the first group → the bucket list; go back and follow the first link of the second group → that service\'s "no screen yet" page, with its label as the `h1`',
    async () => {
      await page.goto('/aws');
      await expectInAwsArea(page, 'Amazon Web Services');
      await page
        .getByRole('region', { name: withName, exact: true })
        .getByRole('link', { name: S3, exact: true })
        .click(ACTION);
      await expect(page).toHaveURL(addressOf('/aws/s3'));
      await expectInAwsArea(page, BUCKETS);
      await page.goBack();
      await expectInAwsArea(page, 'Amazon Web Services');
      const first = WITHOUT[0] ?? '';
      const link = page.getByRole('region', { name: withoutName, exact: true }).getByRole('link').first();
      await expect(link, 'the first link of the second group').toHaveText(first);
      const href = (await link.getAttribute('href')) ?? '';
      await link.click(ACTION);
      await expectNoScreenYet(page, first, href);
    },
  );

  lines.end();
});
