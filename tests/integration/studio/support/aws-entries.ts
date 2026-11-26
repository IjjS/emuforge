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
  /** The words drawn beside the link, in its own item of the list and outside the link; empty when there are none. */
  beside: string;
  /** Every element the link is described by is drawn, in the link's own item. */
  descriptionDrawn: boolean;
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
      // Not drawn, as the text readers of `screen-rules.ts` tell it: the element or one around it is taken out,
      // made invisible or transparent, or clipped away (the screen-reader-only forms).
      const hidden = (el: Element): boolean => {
        for (let a: Element | null = el; a !== null; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
          if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
          if (/inset\(\s*50%/.test(cs.clipPath)) return true;
          const box = a.getBoundingClientRect();
          if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
        }
        return false;
      };
      const drawn = (el: Element | null): boolean => el !== null && el.getClientRects().length > 0 && !hidden(el);
      const header = root.querySelector(selectors.header);
      const links = [...root.querySelectorAll('a[href]')]
        .filter((link) => link !== header)
        .map((link) => {
          const sections: string[] = [];
          for (let section = link.closest(selectors.section); section !== null; section = around(section)) {
            sections.unshift(clean(button(section)?.textContent));
          }
          const ids = (link.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id !== '');
          const described = ids.map((id) => document.getElementById(id));
          const item = link.closest('li');
          // The words drawn beside the link: the texts of its item that are drawn, outside the link and outside a
          // list of the item's own (a section's links).
          const beside: string[] = [];
          if (item !== null) {
            const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
              const parent = node.parentElement;
              const text = clean(node.textContent);
              if (text === '' || parent === null || link.contains(node)) continue;
              const list = parent.closest('ul, ol');
              if (list !== null && item.contains(list)) continue;
              if (!drawn(parent)) continue;
              beside.push(text);
            }
          }
          return {
            text: clean(link.textContent),
            href: link.getAttribute('href') ?? '',
            sections,
            description: described.map((el) => clean(el?.textContent)).join(' '),
            beside: beside.join(' '),
            descriptionDrawn:
              described.length > 0 && described.every((el) => drawn(el) && item !== null && item.contains(el)),
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
 * drawn once it is open), until none is closed. One section a turn, the first closed one that is drawn, found by its
 * place among the sections' buttons; the bound is the number of sections, never a time.
 */
export async function openEverySection(page: Page): Promise<void> {
  const buttons = page.locator(NAVIGATION_SECTION_BUTTONS);
  const firstClosed = () =>
    buttons.evaluateAll((els) =>
      els.findIndex((el) => el.getAttribute('aria-expanded') === 'false' && el.getClientRects().length > 0),
    );
  const most = (await buttons.count()) + 1;
  for (let opened = 0; opened < most; opened++) {
    const index = await firstClosed();
    if (index < 0) return;
    const button = buttons.nth(index);
    await button.click(ACTION);
    await expect(button, 'the section just chosen is open').toHaveAttribute('aria-expanded', 'true');
  }
  expect(await firstClosed(), 'the place of a section still closed (-1: none)').toBe(-1);
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

/** The page's key-value pairs (Cloudscape's, inside `main`) as read now. */
export interface PagePairs {
  /** Label and value of each pair whose label and value are both drawn, in order. */
  drawn: Record<string, string>;
  /** The label of every pair in the page, drawn or not. */
  labels: string[];
}

/** Reads the page's pairs now; never waits. A label or value that is in the page and not drawn is no drawn pair. */
export async function pagePairs(page: Page): Promise<PagePairs> {
  const pairs = page.getByRole('main').locator(PAIR.replace(/^body /, ''));
  const read = await pairs.evaluateAll(
    (els, selectors) => {
      const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
      const hidden = (el: Element): boolean => {
        for (let a: Element | null = el; a !== null; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
          if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
          if (/inset\(\s*50%/.test(cs.clipPath)) return true;
          const box = a.getBoundingClientRect();
          if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
        }
        return false;
      };
      const drawn = (el: Element | null): boolean => el !== null && el.getClientRects().length > 0 && !hidden(el);
      // The drawn text of an element: its text nodes whose own element is drawn.
      const drawnText = (el: Element | null): string => {
        if (el === null) return '';
        const parts: string[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if (drawn(node.parentElement)) parts.push(node.textContent ?? '');
        }
        return clean(parts.join(''));
      };
      return els.map((el) => {
        const label = el.querySelector(selectors.label);
        const value = el.querySelector(selectors.value);
        return {
          label: clean(label?.textContent),
          drawnLabel: drawnText(label),
          drawnValue: drawnText(value),
        };
      });
    },
    { label: PAIR_LABEL, value: PAIR_VALUE },
  );
  return {
    drawn: Object.fromEntries(
      read
        .filter((pair) => pair.drawnLabel !== '' && pair.drawnValue !== '')
        .map((pair) => [pair.drawnLabel, pair.drawnValue]),
    ),
    labels: read.map((pair) => pair.label),
  };
}

/**
 * Waits until the page draws each of `wanted`, label and value in one pair, and holds none of the labels `absent`,
 * drawn or not.
 */
export async function expectPairs(page: Page, wanted: Record<string, string>, absent: string[] = []): Promise<void> {
  await expect
    .poll(
      async () => {
        const shown = await pagePairs(page);
        return {
          wanted: Object.fromEntries(Object.keys(wanted).map((label) => [label, shown.drawn[label] ?? null])),
          absent: absent.filter((label) => shown.labels.includes(label)),
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

/** The container under the page's heading "Resource kinds" (a sub-service's page). */
export function resourceKinds(page: Page): Locator {
  return page
    .getByRole('main')
    .locator(
      createWrapper()
        .findContainer()
        .toSelector()
        .replace(/^body /, ''),
    )
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Resource kinds', exact: true }) });
}

/** A link under the page's heading "Resource kinds". */
export interface ResourceKindLink extends LinkPair {
  /** The text the link is described by (`aria-describedby`); empty when it has none. */
  description: string;
  /** The words drawn beside the link, in its own item of the list and outside the link; empty when there are none. */
  beside: string;
  /** Every element the link is described by is drawn, in the link's own item of the list. */
  descriptionDrawn: boolean;
}

/** The links under the page's heading "Resource kinds", each with the words it is described by. */
export async function resourceKindLinks(page: Page): Promise<ResourceKindLink[]> {
  return resourceKinds(page)
    .getByRole('link')
    .evaluateAll((els) =>
      els.map((el) => {
        const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
        const hidden = (el: Element): boolean => {
          for (let a: Element | null = el; a !== null; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
            if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
            if (/inset\(\s*50%/.test(cs.clipPath)) return true;
            const box = a.getBoundingClientRect();
            if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
          }
          return false;
        };
        const drawn = (target: Element | null): boolean =>
          target !== null && target.getClientRects().length > 0 && !hidden(target);
        const item = el.closest('li');
        // The words drawn beside the link: the drawn texts of its item outside the link.
        const beside: string[] = [];
        if (item !== null) {
          const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            const parent = node.parentElement;
            const text = clean(node.textContent);
            if (text === '' || parent === null || el.contains(node) || !drawn(parent)) continue;
            beside.push(text);
          }
        }
        const described = (el.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .filter((id) => id !== '')
          .map((id) => document.getElementById(id));
        return {
          text: clean(el.textContent),
          href: el.getAttribute('href') ?? '',
          description: described.map((target) => clean(target?.textContent)).join(' '),
          beside: beside.join(' '),
          descriptionDrawn:
            described.length > 0 &&
            described.every((target) => drawn(target) && item !== null && item.contains(target)),
        };
      }),
    );
}

// ---------------------------------------------------------------------------------------------------------------
// The navigation's Tab stops (design.md, D6 C).
// ---------------------------------------------------------------------------------------------------------------

/** Where the focused element is against the side navigation: inside it, and whether it is its header link. */
export async function focusInNavigation(page: Page): Promise<{ inNavigation: boolean; navigationHeader: boolean }> {
  return page.evaluate(
    ([navigation, header]) => {
      const active = document.activeElement;
      return {
        inNavigation: active?.closest(navigation) != null,
        navigationHeader: active?.matches(header) === true,
      };
    },
    [SIDE_NAVIGATION, HEADER_LINK] as const,
  );
}

/** What a keyboard check knows of a Tab stop, as far as the navigation's stops need it. */
export interface NavigationStop {
  role: string;
  name: string;
  /** Inside the side navigation (`focusInNavigation`). */
  inNavigation: boolean;
  /** The navigation's header link, by Cloudscape's own selector. */
  navigationHeader: boolean;
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
 * that order. The header is the navigation's own header link and each named link a stop inside the navigation, so
 * a link of the same name elsewhere on the page stands for neither. The stops after the navigation are the walk's own.
 */
export function navigationStops<S extends NavigationStop>(
  header: string,
  links: string[],
): ExpectedNavigationStop<S>[] {
  const others = (): ExpectedNavigationStop<S> => ({
    what: 'the other stops of the side navigation (its other entries and the toggles of its sections)',
    match: (stop) =>
      stop.inNavigation && !stop.navigationHeader && !(stop.role === 'link' && links.includes(stop.name)),
    optional: true,
    many: true,
  });
  return [
    {
      what: `the side navigation's header "${header}"`,
      match: (stop) => stop.navigationHeader && stop.role === 'link' && stop.name === header,
    },
    ...links.flatMap((link) => [
      others(),
      {
        what: `the side navigation's link "${link}"`,
        match: (stop: S) => stop.inNavigation && stop.role === 'link' && stop.name === link,
      },
    ]),
    others(),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// A list screen a link leads to.
// ---------------------------------------------------------------------------------------------------------------

const TABLE = createWrapper().findTable();
const TABLE_SELECTOR = TABLE.toSelector();
/** A selector of Cloudscape's below the table, made relative to the table it is read in. */
const inTable = (selector: string) => selector.slice(TABLE_SELECTOR.length).trim();
const TABLE_COLUMNS = inTable(TABLE.findColumnHeaders().toSelector());
const TABLE_ROWS = inTable(TABLE.findRows().toSelector());
const TABLE_EMPTY = inTable(TABLE.findEmptySlot().toSelector());
const TABLE_LOADING = inTable(TABLE.findLoadingText().toSelector());
const TABLE_EMPTY_STATUS = inTable(TABLE.findEmptySlot().findStatusIndicator().toSelector());
const H1_HEADING_TEXT = createWrapper().findHeader().findHeadingText().toSelector();

/**
 * What tells one list from another: columns it has, in this order among its columns, and the words of its empty
 * state when the emulator holds none of the kind. These checks are of no service and import no service's support,
 * so the words each list is known by are held here.
 */
export interface ListIdentity {
  columns: string[];
  empty: string;
}

/** The lists the lines of issue 650 lead to. */
export const LISTS = {
  instances: { columns: ['Instance ID', 'State', 'Availability Zone'], empty: 'No instances' },
  volumes: { columns: ['Volume ID', 'State', 'Size'], empty: 'No volumes' },
  securityGroups: { columns: ['Group ID', 'VPC ID', 'Description'], empty: 'No security groups' },
  buckets: { columns: ['Name', 'AWS Region', 'Creation date'], empty: 'No buckets' },
  clusters: { columns: ['Name', 'Status', 'Running tasks', 'Pending tasks'], empty: 'No clusters' },
  tables: { columns: ['Name', 'Partition key', 'Sort key', 'Capacity mode'], empty: 'No tables' },
  keys: { columns: ['Status', 'Key ID', 'Aliases', 'Description'], empty: 'No customer managed keys' },
  parameters: { columns: ['Name', 'Type', 'Version', 'Last modified'], empty: 'No parameters' },
} satisfies Record<string, ListIdentity>;

/** A list screen as shown now: the one table of `main` that has the list's columns, read inside that table. */
export interface ListShown {
  /** The `h1`'s heading text, its counter apart (Cloudscape's header); the `h1`'s text when it is no such header. */
  heading: string | null;
  /** The table's column headers, in order. */
  columns: string[];
  /** The table's drawn rows. */
  rows: number;
  /** The drawn text of the table's empty slot; `null` when it shows none. */
  emptyText: string | null;
  /** The empty slot draws the list's own words of an empty list, whole. */
  emptyAsKnown: boolean;
  /** The table shows its loading text. */
  loading: boolean;
  /** The empty slot holds a status (the area's failure state). */
  failed: boolean;
}

/** `wanted` are among `columns`, in that order. */
function holdsInOrder(columns: string[], wanted: string[]): boolean {
  let at = -1;
  for (const column of wanted) {
    at = columns.indexOf(column, at + 1);
    if (at < 0) return false;
  }
  return true;
}

/**
 * Reads the list `identity` now: the drawn tables of `main` whose columns hold the list's. `null` when no table or
 * more than one has them. Rows, the empty slot, the loading text and the status are read inside that table. Never
 * waits.
 */
export async function listShown(page: Page, identity: ListIdentity): Promise<ListShown | null> {
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
  const tables = page
    .getByRole('main')
    .locator(TABLE_SELECTOR.replace(/^body /, ''))
    .filter({ visible: true });
  const found: { table: Locator; columns: string[] }[] = [];
  for (const table of await tables.all()) {
    const columns = (await table.locator(TABLE_COLUMNS).filter({ visible: true }).allInnerTexts()).map(clean);
    if (holdsInOrder(columns, identity.columns)) found.push({ table, columns });
  }
  if (found.length !== 1) return null;
  const { table, columns } = found[0];
  const drawn = (selector: string) => table.locator(selector).filter({ visible: true });
  const ofHeader = page.locator(H1_HEADING_TEXT).and(page.locator('h1, h1 *'));
  const h1 = (await ofHeader.count()) > 0 ? ofHeader.first() : page.getByRole('heading', { level: 1 }).first();
  const empty = drawn(TABLE_EMPTY);
  const shownEmpty = (await empty.count()) > 0;
  return {
    heading: (await h1.count()) > 0 ? clean(await h1.innerText(ACTION)) : null,
    columns,
    rows: await drawn(TABLE_ROWS).count(),
    emptyText: shownEmpty ? clean(await empty.first().innerText(ACTION)) : null,
    emptyAsKnown:
      shownEmpty &&
      (await empty.first().getByText(identity.empty, { exact: true }).filter({ visible: true }).count()) > 0,
    loading: (await drawn(TABLE_LOADING).count()) > 0,
    failed: (await drawn(TABLE_EMPTY_STATUS).count()) > 0,
  };
}

/**
 * Waits until the list `identity` has settled as a list that was read: its own table shown, the loading text gone,
 * and inside it either drawn rows or the list's own empty state with no failure status (other checks hold resources
 * on the run's emulator, so a list is populated or empty). An empty slot with other words (a failure, a placeholder)
 * is not settled. Returns the list as settled.
 */
export async function expectSettledList(page: Page, what: string, identity: ListIdentity): Promise<ListShown> {
  const state = async () => {
    const list = await listShown(page, identity);
    if (list === null) return `not one table with the columns ${identity.columns.join(', ')}`;
    if (list.loading) return 'loading';
    if (list.failed) return `a failure in the empty slot: ${String(list.emptyText)}`;
    if (list.rows > 0) return 'settled';
    if (list.emptyText === null) return 'neither rows nor the empty slot';
    return list.emptyAsKnown ? 'settled' : `an empty slot that is not "${identity.empty}": ${list.emptyText}`;
  };
  await expect.poll(state, { message: `${what}: the list has settled`, ...ACTION }).toBe('settled');
  const list = await listShown(page, identity);
  if (list === null) throw new Error(`${what}: the table went away`);
  return list;
}
