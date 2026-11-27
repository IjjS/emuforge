// The entries of EventBridge in the area's navigation, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 75; the entries by issue 650's rule).
//
// `studio.events-entries-lead-to-a-screen-or-no-screen-yet`.
//
// The entries are the requirement's table, held in `services/events/events.ts` (`ENTRY_GROUPS`); the navigation is
// read with the readers of `support/aws-entries.ts`. The check makes nothing in the emulator.

import { expect, startStack, test } from './support';
import {
  expectOneCurrent,
  navigationLink,
  navigationTree,
  openEverySection,
  shownInStatement,
  statement,
} from './support/aws-entries';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { action, goTo, nothingChanged } from './support/no-screen-part';
import {
  CREATE_EVENT_BUS,
  CREATE_EVENT_BUS_PATH,
  CREATE_RULE,
  CREATE_RULE_PATH,
  ENTRY_GROUPS,
  EVENT_BUSES,
  EVENT_BUSES_PATH,
  NAVIGATION_HEADER,
  open,
  RULES,
  RULES_PATH,
  SEND_EVENTS,
  SEND_EVENTS_PATH,
  TARGETS_ENTRY,
} from './services/events/events';

test('studio.events-entries-lead-to-a-screen-or-no-screen-yet', async ({ ctx, page }) => {
  await startStack(ctx);
  const lines = new Lines(ctx);
  const entries = ENTRY_GROUPS.flatMap((group) => group.entries);
  const pair = (text: string, href: string) => `${text} → ${href}`;
  /** The links a group holds in the navigation: its sub-service's own, when it has one, and its entries'. */
  const wantedIn = (group: (typeof ENTRY_GROUPS)[number]) =>
    [
      ...(group.subService === undefined ? [] : [pair(group.subService.name, group.subService.path)]),
      ...group.entries.map((entry) => pair(entry.label, entry.path)),
    ].sort();
  /** The navigation as shown, every section open: its header and, by group, its links as pairs of label and path. */
  const navigation = async () => {
    await openEverySection(page);
    const tree = await navigationTree(page);
    const groupNames = ENTRY_GROUPS.map((group) => group.name);
    return {
      header: tree.header,
      groups: tree.sections.filter((section) => section.outermost).map((section) => section.title),
      links: Object.fromEntries(
        groupNames.map((name) => [
          name,
          tree.links
            .filter((link) => link.sections[0] === name)
            .map((link) => pair(link.text, link.href))
            .sort(),
        ]),
      ),
      outside: tree.links.filter((link) => !groupNames.includes(link.sections[0] ?? '')).map((link) => link.href),
      notDrawn: tree.links.filter((link) => !link.shown).map((link) => link.href),
    };
  };
  const wantedNavigation = {
    header: NAVIGATION_HEADER,
    groups: ENTRY_GROUPS.map((group) => group.name),
    links: Object.fromEntries(ENTRY_GROUPS.map((group) => [group.name, wantedIn(group)])),
    outside: [],
    notDrawn: [],
  };
  const expectNavigation = (what: string) => expect.poll(navigation, { message: what, ...ACTION }).toEqual(wantedNavigation);

  await lines.line(
    "Each entry of that table is in the navigation under its group and its label and leads to its path, each of the three sub-services has its link in its group, and the navigation holds no other link below the service's header",
    async () => {
      await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
      await expectNavigation("the navigation's links are the table's entries and the three sub-services, by group, and no other");
    },
  );

  await lines.line('"Event buses" and "Rules" each lead to their screen, named by its title', async () => {
    await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
    for (const entry of [...entries.filter((each) => each.screen)].reverse()) {
      await openEverySection(page);
      await navigationLink(page, entry.path).click(ACTION);
      await expect(page, `the address of "${entry.label}"`).toHaveURL(addressOf(entry.path));
      await expect(heading(page, entry.label), `the screen titled "${entry.label}"`).toBeVisible();
      await expectOneCurrent(page, entry.label);
      // The screen itself, not the area's page for an entry without one.
      await expect(nothingChanged(page), `the sentence of a page without a screen at ${entry.path}`).toHaveCount(0);
    }
  });

  await lines.line(
    'Every other entry of that table leads to the area\'s page for an entry without a screen: it is titled by the entry\'s label, keeps the service\'s navigation with that entry current, and is not the area\'s "Page not found"; the page of "Targets" says they are shown in a rule\'s page of Rules',
    async () => {
      await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
      for (const entry of entries.filter((each) => !each.screen)) {
        await openEverySection(page);
        await navigationLink(page, entry.path).click(ACTION);
        await expect(page, `the address of "${entry.label}"`).toHaveURL(addressOf(entry.path));
        await expect(heading(page, entry.label), `the page titled "${entry.label}"`).toBeVisible();
        await expect(
          nothingChanged(page),
          `the sentence of the area's page for an entry without a screen at ${entry.path}`,
        ).toBeVisible();
        await expectOneCurrent(page, entry.label);
        await expectNavigation(`the service's navigation on the page of "${entry.label}"`);
        await expect(heading(page, 'Page not found'), `"Page not found" at ${entry.path}`).toHaveCount(0);
        if (entry.path === TARGETS_ENTRY.path) {
          await expect(
            statement(page, shownInStatement(TARGETS_ENTRY.shownPlace)),
            'the page of "Targets" says where they are shown',
          ).toBeVisible();
          await expect(action(page, goTo(RULES)), 'its action leads to Rules').toHaveAttribute('href', RULES_PATH);
        }
      }
    },
  );

  await lines.line(
    'Create event bus and Send events keep "Event buses" current in the navigation; Create rule keeps "Rules"',
    async () => {
      for (const [path, title, current] of [
        [CREATE_EVENT_BUS_PATH, CREATE_EVENT_BUS, EVENT_BUSES],
        [SEND_EVENTS_PATH, SEND_EVENTS, EVENT_BUSES],
        [CREATE_RULE_PATH, CREATE_RULE, RULES],
      ] as const) {
        await open(page, path, title);
        await expectNavigation(`the service's navigation on "${title}"`);
        await expectOneCurrent(page, current);
      }
    },
  );

  lines.end();
});
