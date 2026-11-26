// A service's entries as a user meets them (test-criteria.md, issue 650, Integration; requirement R3 to R5): the
// inventory the requirement confirmed, the side navigation built from it, and the page of an entry that has no
// screen. Used by `aws-service-entries.spec.ts`.
//
// - The inventory is `aws-entries.json` beside this file: the entries of requirement R3 as data, a copy of the
//   issue's confirmed table, never read from Studio's source. A service is named by its folder; its route is the
//   first two segments of its entries' paths.
// - The navigation is read through Cloudscape's selectors: its links, the sections around each link (a section's
//   title is the text of its expand button) and what is current. The words "No screen yet" beside a link are tied
//   to it as its description (`aria-describedby`), so they are read from the link.
// - The Cloudscape selectors made by `createWrapper()` start with `body `, so they are rooted at the page.

import fs from 'node:fs';
import path from 'node:path';

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { expect } from './check';
import { ACTION, SIDE_NAVIGATION } from './frame';

// ---------------------------------------------------------------------------------------------------------------
// The inventory (requirement R3).
// ---------------------------------------------------------------------------------------------------------------

/** A resource kind's entry. */
export interface InventoryEntry {
  label: string;
  path: string;
  listedBy: string;
  /** The entry's own path has a screen on the branch the requirement was written from. */
  screenToday: boolean;
  /** The path of the entry it is listed inside, when its list read needs that parent. */
  listedInside: string | null;
  /** Where Studio shows the kind today, when no screen lists it across the service. */
  shownIn: { entry: string; place: string } | null;
}

/** A group of a service's entries: the service itself first, then each sub-service. */
export interface InventoryGroup {
  model: string;
  /** The group's name; `null` in a service of one group. */
  name: string | null;
  subService: { name: string; path: string } | null;
  entries: InventoryEntry[];
}

/** The inventory: each service's groups, by the name of the service's folder. */
export const INVENTORY = JSON.parse(fs.readFileSync(path.join(__dirname, 'aws-entries.json'), 'utf8')) as Record<
  string,
  InventoryGroup[]
>;

/** A link as text and address. */
export interface LinkPair {
  text: string;
  href: string;
}

/** The groups of `service`; a service the inventory does not hold fails the check that asks. */
export function groupsOf(service: string): InventoryGroup[] {
  const groups = INVENTORY[service];
  if (groups === undefined) throw new Error(`the inventory holds no service "${service}"`);
  return groups;
}

/** The route of `service`: the first two segments of its first entry's path (`/aws/ec2`). */
export function routeOf(service: string): string {
  return groupsOf(service)[0].entries[0].path.split('/').slice(0, 3).join('/');
}

/** The links one group gives: its sub-service's own entry, when it is one, then each resource kind. */
export function groupLinks(group: InventoryGroup): LinkPair[] {
  return [
    ...(group.subService === null ? [] : [{ text: group.subService.name, href: group.subService.path }]),
    ...group.entries.map((entry) => ({ text: entry.label, href: entry.path })),
  ];
}

/** Every link the inventory gives `service`: each sub-service's name and path, each resource kind's label and path. */
export function inventoryLinks(service: string): LinkPair[] {
  return groupsOf(service).flatMap(groupLinks);
}

/** The entry of `service` at `entryPath`. */
export function entryAt(service: string, entryPath: string): InventoryEntry {
  const entry = groupsOf(service)
    .flatMap((group) => group.entries)
    .find((candidate) => candidate.path === entryPath);
  if (entry === undefined) throw new Error(`the inventory holds no entry at ${entryPath}`);
  return entry;
}

/** The words beside the link of an entry without a screen (R4.4). */
export const NO_SCREEN_STATUS = 'No screen yet';

// ---------------------------------------------------------------------------------------------------------------
// The side navigation (R4).
// ---------------------------------------------------------------------------------------------------------------

/** The navigation's header link. */
const HEADER_LINK = createWrapper().findSideNavigation().findHeaderLink().toSelector();
/** A section of the navigation, and its expand button, whose text is the section's title. */
const SECTION = createWrapper().findExpandableSection().toSelector();
const SECTION_BUTTON = createWrapper().findExpandableSection().findExpandButton().toSelector();
/** The expand buttons of the navigation's sections, in document order: a section's own before those inside it. */
const NAVIGATION_SECTION_BUTTONS = `${SIDE_NAVIGATION} ${SECTION_BUTTON.replace(/^body /, '')}`;

/** A link of the navigation as shown. */
export interface NavigationLink extends LinkPair {
  /** The titles of the sections around the link, the outermost first. */
  sections: string[];
  /** The text the link is described by (`aria-describedby`); empty when it has none. */
  description: string;
  current: boolean;
  /** The link is drawn: no section around it is closed. */
  shown: boolean;
}

/** A section of the navigation as shown. */
export interface NavigationSection {
  title: string;
  /** No other section is around it. */
  outermost: boolean;
  open: boolean;
}

/** The navigation as shown now. */
export interface NavigationTree {
  /** The header link's text; `null` when the page shows no navigation. */
  header: string | null;
  headerCurrent: boolean;
  /** The links below the header, in document order. */
  links: NavigationLink[];
  /** The sections, in document order. */
  sections: NavigationSection[];
}

/** Reads the navigation now; never waits. */
export async function navigationTree(page: Page): Promise<NavigationTree> {
  const nav = page.locator(SIDE_NAVIGATION).filter({ visible: true });
  if ((await nav.count()) === 0) return { header: null, headerCurrent: false, links: [], sections: [] };
  return nav.first().evaluate(
    (root, selectors) => {
      const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
      const button = (section: Element) => section.querySelector(selectors.button);
      const around = (el: Element) => el.parentElement?.closest(selectors.section) ?? null;
      const header = root.querySelector(selectors.header);
      const links = [...root.querySelectorAll('a[href]')]
        .filter((link) => link !== header)
        .map((link) => {
          const sections: string[] = [];
          for (let section = link.closest(selectors.section); section !== null; section = around(section)) {
            sections.unshift(clean(button(section)?.textContent));
          }
          const description = (link.getAttribute('aria-describedby') ?? '')
            .split(/\s+/)
            .filter((id) => id !== '')
            .map((id) => clean(document.getElementById(id)?.textContent))
            .join(' ');
          return {
            text: clean(link.textContent),
            href: link.getAttribute('href') ?? '',
            sections,
            description,
            current: link.getAttribute('aria-current') === 'page',
            shown: link.getClientRects().length > 0,
          };
        });
      const sections = [...root.querySelectorAll(selectors.section)].map((section) => ({
        title: clean(button(section)?.textContent),
        outermost: around(section) === null,
        open: button(section)?.getAttribute('aria-expanded') === 'true',
      }));
      return {
        header: header === null ? null : clean(header.textContent),
        headerCurrent: header?.getAttribute('aria-current') === 'page',
        links,
        sections,
      };
    },
    { header: HEADER_LINK, section: SECTION, button: SECTION_BUTTON },
  );
}

/** The expand button of the navigation's section titled `title`: found by its place among the sections as read. */
export async function sectionButton(page: Page, title: string): Promise<Locator> {
  const index = (await navigationTree(page)).sections.findIndex((section) => section.title === title);
  if (index < 0) throw new Error(`the navigation has no section "${title}"`);
  return page.locator(NAVIGATION_SECTION_BUTTONS).nth(index);
}

/** Opens the navigation's section titled `title` when it is closed, and waits until it is open. */
export async function openSection(page: Page, title: string): Promise<void> {
  const button = await sectionButton(page, title);
  if ((await button.getAttribute('aria-expanded', ACTION)) !== 'true') await button.click(ACTION);
  await expect(button, `the section "${title}" is open`).toHaveAttribute('aria-expanded', 'true');
}

/**
 * Opens every section of the navigation that is closed, the outer ones first (a closed section's own sections are
 * drawn once it is open), until none is closed. The bound is the number of sections, never a time.
 */
export async function openEverySection(page: Page): Promise<void> {
  const closed = page.locator(`${NAVIGATION_SECTION_BUTTONS}[aria-expanded="false"]`).filter({ visible: true });
  const most = (await page.locator(NAVIGATION_SECTION_BUTTONS).count()) + 1;
  for (let opened = 0; opened < most; opened++) {
    if ((await closed.count()) === 0) return;
    const first = closed.first();
    await first.click(ACTION);
    await expect(first, 'the section just opened is no longer among the closed ones').not.toHaveAttribute(
      'aria-expanded',
      'false',
    );
  }
  expect(await closed.count(), 'sections still closed').toBe(0);
}

/** The navigation's link to `href`, by Cloudscape's own selector. */
export function navigationLink(page: Page, href: string): Locator {
  return page.locator(createWrapper().findSideNavigation().findLinkByHref(href).toSelector()).filter({ visible: true });
}

/**
 * What is wrong with the navigation's links for `service` (R4.1): they are exactly the inventory's entries of the
 * service as pairs of text and address, none twice by its address. Reads the navigation as it is now.
 */
export function entryLinkProblems(tree: NavigationTree, service: string): string[] {
  const pair = (link: LinkPair) => `${link.text} → ${link.href}`;
  const wanted = inventoryLinks(service).map(pair);
  const shown = tree.links.map(pair);
  const problems: string[] = [];
  if (tree.header === null) problems.push('no side navigation');
  const missing = wanted.filter((link) => !shown.includes(link));
  const extra = shown.filter((link) => !wanted.includes(link));
  if (missing.length > 0) problems.push(`missing: ${missing.join('; ')}`);
  if (extra.length > 0) problems.push(`not of the inventory: ${extra.join('; ')}`);
  const addresses = tree.links.map((link) => link.href);
  const twice = [...new Set(addresses.filter((href, at) => addresses.indexOf(href) !== at))];
  if (twice.length > 0) problems.push(`twice: ${twice.join('; ')}`);
  const hidden = tree.links.filter((link) => !link.shown).map((link) => link.href);
  if (hidden.length > 0) problems.push(`not drawn with every section open: ${hidden.join('; ')}`);
  return problems;
}

/** The current links of the whole navigation, its header included, as texts. */
export function currentOf(tree: NavigationTree): string[] {
  return [
    ...(tree.headerCurrent && tree.header !== null ? [`header ${tree.header}`] : []),
    ...tree.links.filter((link) => link.current).map((link) => link.text),
  ];
}

/** Waits until exactly one link of the whole navigation, its header included, is current, and it is `text`, drawn. */
export async function expectOneCurrent(page: Page, text: string): Promise<void> {
  await expect
    .poll(async () => currentOf(await navigationTree(page)), {
      message: `"${text}" is the one current link`,
      ...ACTION,
    })
    .toEqual([text]);
  const tree = await navigationTree(page);
  expect(
    tree.links.filter((link) => link.current).map((link) => link.shown),
    `the current link "${text}" is drawn (its sections are open)`,
  ).toEqual([true]);
}

// ---------------------------------------------------------------------------------------------------------------
// The page of an entry without a screen (R5).
// ---------------------------------------------------------------------------------------------------------------

/** The statements of the page (R5). */
export const NO_SCREEN_FOR_THIS = 'Studio has no screen for this yet.';
export const acrossStatement = (crumb: string) => `Studio has no screen that lists these across ${crumb} yet.`;
export const shownInStatement = (place: string) => `It shows them in ${place}.`;

const PAIR = createWrapper().findKeyValuePairs().findItems().toSelector();
const FIRST_PAIR = createWrapper().findKeyValuePairs().findItems().get(1);
/** A pair's label and value, as selectors below the pair. */
const PAIR_LABEL = FIRST_PAIR.findLabel().toSelector().slice(FIRST_PAIR.toSelector().length).trim();
const PAIR_VALUE = FIRST_PAIR.findValue().toSelector().slice(FIRST_PAIR.toSelector().length).trim();

/** The page's values as label and value, in order (Cloudscape's key-value pairs inside `main`). */
export async function pagePairs(page: Page): Promise<Record<string, string>> {
  const pairs = page.getByRole('main').locator(PAIR.replace(/^body /, ''));
  const read = await pairs.evaluateAll(
    (els, selectors) =>
      els.map((el) => {
        const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
        return [
          clean(el.querySelector(selectors.label)?.textContent),
          clean(el.querySelector(selectors.value)?.textContent),
        ];
      }),
    { label: PAIR_LABEL, value: PAIR_VALUE },
  );
  return Object.fromEntries(read) as Record<string, string>;
}

/** Waits until the page's values hold each of `wanted`, and none of the labels `absent`. */
export async function expectPairs(page: Page, wanted: Record<string, string>, absent: string[] = []): Promise<void> {
  await expect
    .poll(
      async () => {
        const shown = await pagePairs(page);
        return {
          wanted: Object.fromEntries(Object.keys(wanted).map((label) => [label, shown[label] ?? null])),
          absent: absent.filter((label) => label in shown),
        };
      },
      { message: `the values ${JSON.stringify(wanted)}, none of ${JSON.stringify(absent)}`, ...ACTION },
    )
    .toEqual({ wanted, absent: [] });
}

/** A statement of the page: the text, whole, inside `main`. */
export function statement(page: Page, text: string): Locator {
  return page.getByRole('main').getByText(text, { exact: true });
}

/** The links under the page's heading "Resource kinds" (a sub-service's page), each with its description. */
export async function resourceKindLinks(page: Page): Promise<(LinkPair & { description: string })[]> {
  const container = page
    .getByRole('main')
    .locator(
      createWrapper()
        .findContainer()
        .toSelector()
        .replace(/^body /, ''),
    )
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Resource kinds', exact: true }) });
  return container.getByRole('link').evaluateAll((els) =>
    els.map((el) => {
      const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
      return {
        text: clean(el.textContent),
        href: el.getAttribute('href') ?? '',
        description: (el.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .filter((id) => id !== '')
          .map((id) => clean(document.getElementById(id)?.textContent))
          .join(' '),
      };
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The navigation's Tab stops (design.md, D6 C).
// ---------------------------------------------------------------------------------------------------------------

/** True when the focused element is inside the side navigation. */
export async function focusInNavigation(page: Page): Promise<boolean> {
  return page.evaluate((navigation) => document.activeElement?.closest(navigation) != null, SIDE_NAVIGATION);
}

/** What a keyboard check knows of a Tab stop, as far as the navigation's stops need it. */
export interface NavigationStop {
  role: string;
  name: string;
  /** Inside the side navigation (`focusInNavigation`). */
  inNavigation: boolean;
}

/** One expected stop of a keyboard check's walk, as its `orderProblems` reads it. */
export interface ExpectedNavigationStop<S extends NavigationStop> {
  what: string;
  match: (stop: S) => boolean;
  optional?: boolean;
  many?: boolean;
}

/**
 * The stops of a service's side navigation in a Tab walk, since the navigation holds every entry of the service
 * (issue 650; `decisions.md`, PM decisions, Tab-stop lists): the header `header`, then every stop inside the
 * navigation, any number (its other links and the toggles of its sections), with the links `links` among them in
 * that order. The stops after the navigation are the walk's own.
 */
export function navigationStops<S extends NavigationStop>(
  header: string,
  links: string[],
): ExpectedNavigationStop<S>[] {
  const others = (): ExpectedNavigationStop<S> => ({
    what: 'the other stops of the side navigation (its other entries and the toggles of its sections)',
    match: (stop) => stop.inNavigation && !(stop.role === 'link' && links.includes(stop.name)),
    optional: true,
    many: true,
  });
  return [
    {
      what: `the side navigation's header "${header}"`,
      match: (stop) => stop.role === 'link' && stop.name === header,
    },
    ...links.flatMap((link) => [
      others(),
      {
        what: `the side navigation's link "${link}"`,
        match: (stop: S) => stop.role === 'link' && stop.name === link,
      },
    ]),
    others(),
  ];
}
