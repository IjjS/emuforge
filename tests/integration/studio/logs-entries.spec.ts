// The entries of CloudWatch Logs in the area's navigation, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 71; the entries by issue 650's rule).
//
// `studio.logs-entries-lead-to-a-screen-or-no-screen-yet`.
//
// The entries are the requirement's table, held in `services/logs/logs.ts` (`ENTRIES`); the navigation is read with
// the readers of `support/aws-entries.ts`. The one log group the check makes carries its prefix `<p>` and is deleted
// when it ends (`LogsSeeded`).

import { expect, startStack, test } from './support';
import { expectOneCurrent, navigationLink, navigationTree } from './support/aws-entries';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  ENTRIES,
  groupPath,
  groupScreen,
  LOG_EVENTS,
  LOG_EVENTS_PATH,
  LOG_GROUPS,
  LOG_GROUPS_PATH,
  LogsSeeded,
  NAVIGATION_HEADER,
  open,
  withGroup,
} from './services/logs/logs';

test('studio.logs-entries-lead-to-a-screen-or-no-screen-yet', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ln-entries');
  const seeded = new LogsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}/nav`);
  const wanted = ENTRIES.map((entry) => `${entry.label} → ${entry.path}`).sort();
  /** The navigation's header and its links below it, as pairs of label and path. */
  const navigation = async () => {
    const tree = await navigationTree(page);
    return { header: tree.header, links: tree.links.map((link) => `${link.text} → ${link.href}`).sort() };
  };
  const expectNavigation = (what: string) =>
    expect.poll(navigation, { message: what, ...ACTION }).toEqual({ header: NAVIGATION_HEADER, links: wanted });

  await lines.line(
    "Each entry of that table is in the navigation under its label and leads to its path, and the navigation holds no other link below the service's header",
    async () => {
      await open(page, LOG_GROUPS_PATH, LOG_GROUPS);
      await expectNavigation("the navigation's links are the table's entries and no other");
      const tree = await navigationTree(page);
      expect(
        tree.links.filter((link) => !link.shown).map((link) => link.text),
        'the entries whose label is not drawn',
      ).toEqual([]);
    },
  );

  await lines.line('"Log groups" and "Log streams" each lead to their screen, named by its title', async () => {
    await open(page, LOG_GROUPS_PATH, LOG_GROUPS);
    for (const entry of [...ENTRIES.filter((each) => each.screen)].reverse()) {
      await navigationLink(page, entry.path).click(ACTION);
      await expect(page, `the address of "${entry.label}"`).toHaveURL(addressOf(entry.path));
      await expect(heading(page, entry.label), `the screen titled "${entry.label}"`).toBeVisible();
      await expectOneCurrent(page, entry.label);
    }
  });

  await lines.line(
    'Every other entry of that table leads to the area\'s page for an entry without a screen: it is titled by the entry\'s label, keeps the service\'s navigation with that entry current, and is not the area\'s "Page not found"',
    async () => {
      await open(page, LOG_GROUPS_PATH, LOG_GROUPS);
      for (const entry of ENTRIES.filter((each) => !each.screen)) {
        await navigationLink(page, entry.path).click(ACTION);
        await expect(page, `the address of "${entry.label}"`).toHaveURL(addressOf(entry.path));
        await expect(heading(page, entry.label), `the page titled "${entry.label}"`).toBeVisible();
        await expectOneCurrent(page, entry.label);
        await expectNavigation(`the service's navigation on the page of "${entry.label}"`);
        await expect(heading(page, 'Page not found'), `"Page not found" at ${entry.path}`).toHaveCount(0);
      }
    },
  );

  await lines.line(
    'Log events, opened from a group\'s "Search log events", keeps the service\'s navigation with "Log groups" current',
    async () => {
      await open(page, groupPath(group), group);
      await groupScreen(page).searchEvents.click(ACTION);
      await expect(page, 'the address of Log events with the group').toHaveURL(
        addressOf(withGroup(LOG_EVENTS_PATH, group)),
      );
      await expect(heading(page, LOG_EVENTS), 'the h1 "Log events"').toBeVisible();
      await expectNavigation("the service's navigation on Log events");
      await expectOneCurrent(page, LOG_GROUPS);
    },
  );

  lines.end();
});
