// A bucket's tab "Objects" (issue 480, task 1) for the checks: its words, the table's rows as shown, the crumbs of
// the folder shown, and a direct `ListObjectsV2` with the values the rows show. The tab itself is opened with
// `openObjectsTab` (`s3-bucket-page.ts`); buckets and keys are made with `Seeded` (`s3.ts`).

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { expect } from '../../support/check';
import { ACTION } from '../../support/frame';
import { crumbTrail } from '../../support/no-screen-part';
import { creationDateText } from '../../support/service-screens';
import { bucketPath } from './s3-bucket-page';
import { type DirectEnv, s3Direct, shownDirect } from './s3';

/** The tab's words (requirement, "EmuForge's own text"; design.md, task 1). */
export const OBJECTS_TITLE = 'Objects';
export const FIND = 'Find objects by prefix';
export const REFRESH = 'Refresh';
export const NO_MATCHES = 'No matches';
export const GO_TO_BUCKETS = 'Go to Buckets';
export const NEXT_PAGE = 'Next page';
export const PREVIOUS_PAGE = 'Previous page';

/** "No bucket `{name}`": the tab of a bucket the emulator does not hold. */
export function noBucket(name: string): string {
  return `No bucket ${name}`;
}

/** The tab's address at `prefix`: the bare route, with `?prefix=` below the root. */
export function objectsAddress(name: string, prefix = ''): string {
  return prefix === '' ? bucketPath(name) : `${bucketPath(name)}?${new URLSearchParams({ prefix }).toString()}`;
}

const TABLE = createWrapper().findTable().toSelector();

/** The tab's parts a check acts on or reads. */
export function objectsTab(page: Page) {
  const main = page.getByRole('main');
  // The selector starts at `body`, so it is not scoped inside `main`; the tab has one table.
  const table = page.locator(TABLE);
  return {
    table,
    /** The table's heading (level 2), its counter included in its name: "Objects (100+)". */
    title: main.getByRole('heading', { level: 2, name: new RegExp(`^${OBJECTS_TITLE}(\\s|$)`) }),
    find: main.getByRole('searchbox', { name: FIND, exact: true }),
    refresh: table.getByRole('button', { name: REFRESH, exact: true }),
    nextPage: main.getByRole('button', { name: NEXT_PAGE, exact: true }),
    previousPage: main.getByRole('button', { name: PREVIOUS_PAGE, exact: true }),
    /** The link of a row's key, as the row shows it (`logs/`, `x.json`). */
    keyLink: (shown: string) => table.getByRole('link', { name: shown, exact: true }),
    goToBuckets: main.getByRole('link', { name: GO_TO_BUCKETS, exact: true }),
  };
}

/** One row as shown: its cells under "Key", "Type", "Last modified", "Size", "Storage class". */
export interface ShownObjectRow {
  key: string;
  type: string;
  lastModified: string;
  size: string;
  storageClass: string;
}

/**
 * The table's data rows as shown, each read by its column headings; a row whose only cell spans the table (loading,
 * empty, no match, failure) is not a data row. `null` when there is no table, or it lacks one of the headings.
 */
export async function shownObjectRows(page: Page): Promise<ShownObjectRow[] | null> {
  const table = objectsTab(page).table;
  if ((await table.count()) === 0) return null;
  return table.first().evaluate((root) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    // The table that holds a body; a sticky copy of the header is hidden from assistive technology.
    const el = [...root.querySelectorAll('table')].find(
      (t) => t.tBodies.length > 0 && !t.closest('[aria-hidden="true"]'),
    );
    if (!el) return null;
    const head = el.tHead?.rows[0];
    if (!head) return null;
    const headings = [...head.cells].map((c) => norm((c as HTMLElement).innerText));
    const at = ['Key', 'Type', 'Last modified', 'Size', 'Storage class'].map((h) => headings.indexOf(h));
    if (at.some((i) => i < 0)) return null;
    const rows: { key: string; type: string; lastModified: string; size: string; storageClass: string }[] = [];
    for (const row of el.tBodies[0].rows) {
      if (row.cells.length <= 1) continue;
      const cell = (i: number) => norm((row.cells[i] as HTMLElement | undefined)?.innerText ?? '');
      rows.push({
        key: cell(at[0]),
        type: cell(at[1]),
        lastModified: cell(at[2]),
        size: cell(at[3]),
        storageClass: cell(at[4]),
      });
    }
    return rows;
  });
}

/** The keys of the rows shown, in order; `[]` without a table. */
export async function shownKeys(page: Page): Promise<string[]> {
  return ((await shownObjectRows(page)) ?? []).map((r) => r.key);
}

/** Waits until the rows' keys are exactly `keys`, in that order. */
export async function expectKeys(page: Page, keys: string[], message: string): Promise<void> {
  await expect.poll(() => shownKeys(page), { message, ...ACTION }).toEqual(keys);
}

/** The table's heading as shown, white space collapsed ("Objects (100+)"); `null` when it is not there. */
export async function objectsTitleText(page: Page): Promise<string | null> {
  const title = objectsTab(page).title;
  if ((await title.count()) === 0) return null;
  return (await title.first().innerText(ACTION)).replace(/\s+/g, ' ').trim();
}

/** The crumbs as shown: each one's text and whether it is a link. */
export async function crumbsShown(page: Page): Promise<{ text: string; link: boolean }[]> {
  return (await crumbTrail(page)).map((c) => ({ text: c.text, link: c.href !== null }));
}

/** A crumb's link by its text. */
export function crumb(page: Page, text: string): Locator {
  return page.getByRole('navigation').getByRole('link', { name: text, exact: true });
}

// ---------------------------------------------------------------------------------------------------------------
// The emulator's answer, directly.
// ---------------------------------------------------------------------------------------------------------------

/** One object of a direct `ListObjectsV2`, as the emulator wrote it. */
export interface DirectObject {
  key: string;
  size: number;
  lastModified: string;
  storageClass: string | null;
}

/** A direct `ListObjectsV2` page of `bucket` under `prefix` with `/` as delimiter: its folders and objects. */
export interface DirectListing {
  folders: string[];
  objects: DirectObject[];
}

function xmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function inner(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return m ? xmlText(m[1]) : null;
}

/** A direct `ListObjectsV2` of `bucket` under `prefix`, delimiter `/`, one page of up to 1000 keys. */
export async function listObjectsDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  prefix = '',
): Promise<DirectListing> {
  const answer = await s3Direct(env, port, {
    method: 'GET',
    pathname: `/${bucket}`,
    query: [
      ['delimiter', '/'],
      ['list-type', '2'],
      ['prefix', prefix],
    ],
  });
  const body = 'error' in answer ? '' : answer.body;
  expect(
    'error' in answer ? answer.error : answer.status,
    `direct ListObjectsV2 ${bucket}: ${shownDirect(answer)}`,
  ).toBe(200);
  const folders = [...body.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)].map(
    (m) => inner(m[1], 'Prefix') ?? '',
  );
  const objects = [...body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
    key: inner(m[1], 'Key') ?? '',
    size: Number(inner(m[1], 'Size') ?? 'NaN'),
    lastModified: inner(m[1], 'LastModified') ?? '',
    storageClass: inner(m[1], 'StorageClass'),
  }));
  return { folders, objects };
}

/** A size as the tab shows it: bytes below 1024 ("12 B"), else base 1024 with one decimal ("1.5 KiB"). */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (Number(value.toFixed(1)) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** The row an object of a direct answer is shown as under `prefix`, its date in `zone`. */
export function expectedObjectRow(
  object: DirectObject,
  prefix: string,
  zone: { offsetMinutes: number; label: string },
): ShownObjectRow {
  const name = object.key.slice(prefix.length);
  const dot = name.lastIndexOf('.');
  return {
    key: name,
    type: dot <= 0 || dot === name.length - 1 ? '-' : name.slice(dot + 1),
    lastModified: creationDateText(object.lastModified, zone),
    size: sizeText(object.size),
    storageClass: object.storageClass ?? '-',
  };
}

/** The row a folder of a direct answer is shown as under `prefix`. */
export function expectedFolderRow(folder: string, prefix: string): ShownObjectRow {
  return { key: folder.slice(prefix.length), type: 'Folder', lastModified: '-', size: '-', storageClass: '-' };
}
