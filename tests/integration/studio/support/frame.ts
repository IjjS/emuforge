// The two layers as a user meets them (requirement R4, R5; test-criteria.md, issue 16): Studio's frame, found by
// role and name (the banner with "EmuForge Studio" and the navigation "Studio"), Home's "Providers" section, and the
// AWS area, the region of the page whose elements carry Cloudscape classes (a class starting with `awsui`). Used by
// `shell.spec.ts`, `frame.spec.ts` and `home.spec.ts`.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { expect } from './check';

/**
 * The bound of every action on an element (choose, read, measure): an element that is not on the page fails the
 * action after it, never the whole check by its timeout.
 */
export const ACTION = { timeout: 10_000 };

/** The AWS area's Cloudscape `SideNavigation` (requirement R5.2), wherever its layout puts it. */
export const SIDE_NAVIGATION = createWrapper().findSideNavigation().toSelector();
/** The side navigation's active item. */
export const SIDE_NAVIGATION_ACTIVE = createWrapper().findSideNavigation().findActiveLink().toSelector();
/** The AWS area's `BreadcrumbGroup`. */
export const BREADCRUMB_GROUP = createWrapper().findBreadcrumbGroup().toSelector();
/** The items of the AWS area's `BreadcrumbGroup`. */
export const BREADCRUMB_ITEMS = createWrapper().findBreadcrumbGroup().findBreadcrumbLinks().toSelector();
/** The toggle that opens the AWS area's side navigation when it is collapsed. */
export const NAVIGATION_TOGGLE = createWrapper().findAppLayout().findNavigationToggle().toSelector();

/** Studio's frame (requirement R5.1). */
export interface Frame {
  /** The top bar: the `banner` that holds the link "EmuForge Studio". */
  banner: Locator;
  /** "EmuForge Studio", the link to `/`. */
  wordmark: Locator;
  /** The navigation landmark named "Studio" inside the banner. */
  nav: Locator;
  /** "Home" in that navigation. */
  home: Locator;
  /** "AWS" in that navigation. */
  aws: Locator;
}

export function frame(page: Page): Frame {
  // `has` resolves its locator inside each banner, so the link is found from the page, not from a banner.
  const banner = page
    .getByRole('banner')
    .filter({ has: page.getByRole('link', { name: 'EmuForge Studio', exact: true }) });
  const nav = banner.getByRole('navigation', { name: 'Studio', exact: true });
  return {
    banner,
    wordmark: banner.getByRole('link', { name: 'EmuForge Studio', exact: true }),
    nav,
    home: nav.getByRole('link', { name: 'Home', exact: true }),
    aws: nav.getByRole('link', { name: 'AWS', exact: true }),
  };
}

/** Home's "Providers" section (requirement R9.2): the region whose name starts with "Providers" (its counter follows). */
export function providersSection(page: Page): Locator {
  return page.getByRole('region', { name: /^Providers(\s|$)/ });
}

/** A pattern for the page address `http://127.0.0.1:<port><path>`, nothing after it. */
export function addressOf(path: string): RegExp {
  return new RegExp(`^http://127\\.0\\.0\\.1:\\d+${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/** The document title of requirement R4.4 for a page whose `h1` is `heading`; `null` is Home. */
export function titleOf(heading: string | null): string {
  return heading === null ? 'EmuForge Studio' : `${heading} | EmuForge Studio`;
}

/** True when the element, or an element around it, carries a Cloudscape class: it is inside the AWS area. */
export async function inCloudscape(locator: Locator): Promise<boolean> {
  return locator.evaluate(
    (el) => {
      for (let at: Element | null = el; at; at = at.parentElement) {
        if ([...at.classList].some((c) => c.startsWith('awsui'))) return true;
      }
      return false;
    },
    undefined,
    ACTION,
  );
}

/** Every element of the document that carries a Cloudscape class, as `tag.class` (at most 10 listed). */
export async function cloudscapeElements(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => [...el.classList].some((c) => c.startsWith('awsui')))
      .slice(0, 10)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].find((c) => c.startsWith('awsui')) ?? ''}`),
  );
}

/** The page's `h1` with exactly `name`. */
export function heading(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 1, name, exact: true });
}

/** Home: the address is `/` and its header is "Home". */
export async function expectHome(page: Page): Promise<void> {
  await expect(page).toHaveURL(addressOf('/'));
  await expect(heading(page, 'Home')).toBeVisible();
}

/** The `h1` named `name` is shown inside the AWS area, and the area's side navigation is on the page. */
export async function expectInAwsArea(page: Page, name: string): Promise<void> {
  await expect(heading(page, name)).toBeVisible();
  expect(await inCloudscape(heading(page, name)), `"${name}" is inside the AWS area`).toBe(true);
  await expect(page.locator(SIDE_NAVIGATION), 'the AWS area’s side navigation').toHaveCount(1);
}

/**
 * The AWS area's "no screen yet" page for a service (requirement R5.4): the address is `path`, inside the AWS area
 * the header is the service label, the statement that Studio has no screen for it yet, and a "Go to Home" link.
 */
export async function expectNoScreenYet(page: Page, label: string, path: string): Promise<void> {
  await expect(page).toHaveURL(addressOf(path));
  await expectInAwsArea(page, label);
  await expect(page.getByRole('main')).toContainText(`Studio has no screen for ${label} yet.`);
  await expect(page.getByRole('link', { name: 'Go to Home', exact: true })).toBeVisible();
}

/**
 * Studio's own "Page not found" (requirement R4.3) for a page opened directly: the address is `path`, the header
 * "Page not found" and the path as text, a "Go to Home" link, and no provider area on the page: no element carries
 * a Cloudscape class.
 */
export async function expectStudioNotFound(page: Page, path: string): Promise<void> {
  await expect(page).toHaveURL(addressOf(path));
  await expect(heading(page, 'Page not found')).toBeVisible();
  await expect(page.getByRole('main')).toContainText(path);
  await expect(page.getByRole('link', { name: 'Go to Home', exact: true })).toBeVisible();
  expect(await cloudscapeElements(page), 'elements with a Cloudscape class: no provider area on the page').toEqual([]);
}

/** The texts of the AWS area's breadcrumbs, in order. */
export async function breadcrumbs(page: Page): Promise<string[]> {
  return (await page.locator(BREADCRUMB_ITEMS).filter({ visible: true }).allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );
}
