// An object's page and the delete dialog (issue 480, tasks 2 and 4) for the checks: their words, the page's values
// as shown, the dialog's parts, and the direct calls that put an object with its type, metadata and tags and read
// it back (`HeadObject`, `GetObject`, `GetObjectTagging`). The Objects tab's parts: `s3-objects.ts`.

import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';

import { expect } from '../../support/check';
import { ACTION } from '../../support/frame';
import { creationDateText } from '../../support/service-screens';
import { bucketPath } from './s3-bucket-page';
import { type Direct, type DirectEnv, objectPath as directObjectPath, s3Direct, shownDirect } from './s3';
import { sizeText } from './s3-objects';

/** The page's address for `key` of bucket `name`: `/aws/s3/buckets/<name>/object?key=<key>`. */
export function objectAddress(name: string, key: string): string {
  return `${bucketPath(name)}/object?${new URLSearchParams({ key }).toString()}`;
}

/** The page's and the dialog's words (requirement, "EmuForge's own text"). */
export const OVERVIEW = 'Object overview';
export const USER_METADATA = 'User-defined metadata';
export const TAGS = 'Tags';
export const PREVIEW = 'Preview';
export const NO_PREVIEW = 'No preview for this type. Download the object to open it.';
export const CONFIRM_FIELD = 'To confirm, type "delete"';
export const CONFIRM_WORD = 'delete';
export const VERSIONED_SENTENCE = 'A delete marker is added to each; the versions are kept.';

/** "Showing the first 64 KiB of `{size}`." */
export function truncatedText(bytes: number): string {
  return `Showing the first 64 KiB of ${sizeText(bytes)}.`;
}

/** "No object `{key}`" and "Go to `{name}`": the page of a key the bucket does not hold. */
export function noObject(key: string): string {
  return `No object ${key}`;
}
export function goTo(name: string): string {
  return `Go to ${name}`;
}

/** "Deleted `{n}` objects." ("Deleted 1 object."). */
export function deletedText(n: number): string {
  return `Deleted ${String(n)} object${n === 1 ? '' : 's'}.`;
}

/** The page's parts a check acts on or reads. */
export function objectPage(page: Page) {
  const main = page.getByRole('main');
  return {
    refresh: main.getByRole('button', { name: 'Refresh', exact: true }),
    delete: main.getByRole('button', { name: 'Delete', exact: true }),
    download: main.getByRole('button', { name: 'Download', exact: true }),
    preview: main.getByRole('region', { name: 'Object preview', exact: true }),
    section: (title: string) => main.getByRole('heading', { level: 2, name: new RegExp(`^${title}(\\s|$)`) }),
  };
}

/**
 * The values of the section titled `title` as shown: each label (`dt`) with the text of its value (`dd`), white space
 * collapsed. `{}` when the section is not there.
 */
export async function sectionPairs(page: Page, title: string): Promise<Record<string, string>> {
  return page.getByRole('main').evaluate((main, wanted) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const heading = [...main.querySelectorAll('h2')].find((h) => norm((h as HTMLElement).innerText) === wanted);
    // The section's container: the nearest ancestor of the heading that holds a description list.
    let box: Element | null = heading ?? null;
    while (box !== null && box !== main && box.querySelector('dl') === null) box = box.parentElement;
    if (box === null || heading === undefined) return {};
    const pairs: Record<string, string> = {};
    for (const dt of box.querySelectorAll('dt')) {
      const dd = dt.nextElementSibling;
      pairs[norm((dt as HTMLElement).innerText)] = dd === null ? '' : norm((dd as HTMLElement).innerText);
    }
    return pairs;
  }, title);
}

/** The rows of the entry table titled `title` ("User-defined metadata", "Tags") as `[key, value]`, in order. */
export async function entryRows(page: Page, title: string): Promise<[string, string][]> {
  return page.getByRole('main').evaluate((main, wanted) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const heading = [...main.querySelectorAll('h2')].find((h) =>
      new RegExp(`^${wanted}(\\s|$)`).test(norm((h as HTMLElement).innerText)),
    );
    let box: Element | null = heading ?? null;
    while (box !== null && box !== main && box.querySelector('table tbody') === null) box = box.parentElement;
    if (box === null || heading === undefined) return [];
    const table = [...box.querySelectorAll('table')].find(
      (t) => t.tBodies.length > 0 && !t.closest('[aria-hidden="true"]'),
    );
    if (table === undefined) return [];
    const rows: [string, string][] = [];
    for (const row of table.tBodies[0].rows) {
      if (row.cells.length < 2) continue;
      rows.push([norm((row.cells[0] as HTMLElement).innerText), norm((row.cells[1] as HTMLElement).innerText)]);
    }
    return rows;
  }, title);
}

/** "Download", then the file the browser saved: its suggested name and its bytes. */
export async function download(page: Page): Promise<{ name: string; bytes: Buffer }> {
  const saved = page.waitForEvent('download', ACTION);
  await objectPage(page).download.click(ACTION);
  const file = await saved;
  const where = await file.path();
  return { name: file.suggestedFilename(), bytes: fs.readFileSync(where) };
}

// ---------------------------------------------------------------------------------------------------------------
// The delete dialog.
// ---------------------------------------------------------------------------------------------------------------

/** The delete dialog's parts. */
export function deleteDialog(page: Page) {
  const dialog = page.getByRole('dialog');
  return {
    dialog,
    confirm: dialog.getByRole('textbox', { name: CONFIRM_FIELD, exact: true }),
    delete: dialog.getByRole('button', { name: 'Delete', exact: true }),
    cancel: dialog.getByRole('button', { name: 'Cancel', exact: true }),
  };
}

/** The dialog's text, white space collapsed. */
export async function dialogText(page: Page): Promise<string> {
  return (await deleteDialog(page).dialog.innerText(ACTION)).replace(/\s+/g, ' ').trim();
}

/** A row's selection box on the Objects tab, by the key the row shows (`a.txt`, `tmp/`). */
export function rowCheckbox(page: Page, shown: string): Locator {
  return page.getByRole('main').getByRole('checkbox', { name: `Select ${shown}`, exact: true });
}

// ---------------------------------------------------------------------------------------------------------------
// The emulator, directly.
// ---------------------------------------------------------------------------------------------------------------

function given(answer: Direct, what: string, status = 200): Exclude<Direct, { error: string }> {
  expect('error' in answer ? answer.error : answer.status, `${what}: ${shownDirect(answer)}`).toBe(status);
  return answer as Exclude<Direct, { error: string }>;
}

/** What `putObjectWith` puts besides the body. */
export interface PutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  tags?: Record<string, string>;
}

/** A direct `PutObject bucket/key` of `body` (text as UTF-8, or bytes), with its type, user metadata and tags. */
export async function putObjectWith(
  env: DirectEnv,
  port: number,
  bucket: string,
  key: string,
  body: string | Buffer,
  options: PutOptions = {},
): Promise<void> {
  const headers: Record<string, string> = {};
  if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  for (const [k, v] of Object.entries(options.metadata ?? {})) headers[`x-amz-meta-${k}`] = v;
  if (options.tags !== undefined) headers['x-amz-tagging'] = new URLSearchParams(options.tags).toString();
  given(
    await s3Direct(env, port, { method: 'PUT', pathname: directObjectPath(bucket, key), body, headers }),
    `direct PutObject ${bucket}/${key}`,
  );
}

/** A direct `HeadObject`: the headers the overview is read from. */
export async function headObjectDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  key: string,
): Promise<Record<string, string>> {
  return given(
    await s3Direct(env, port, { method: 'HEAD', pathname: directObjectPath(bucket, key) }),
    `direct HeadObject ${bucket}/${key}`,
  ).headers;
}

/** A direct `GetObject`: the body's bytes. */
export async function getObjectDirect(env: DirectEnv, port: number, bucket: string, key: string): Promise<Buffer> {
  return given(
    await s3Direct(env, port, { method: 'GET', pathname: directObjectPath(bucket, key) }),
    `direct GetObject ${bucket}/${key}`,
  ).bytes;
}

/** A direct `DeleteObject` without a version id. */
export async function deleteObjectDirect(env: DirectEnv, port: number, bucket: string, key: string): Promise<void> {
  given(
    await s3Direct(env, port, { method: 'DELETE', pathname: directObjectPath(bucket, key) }),
    `direct DeleteObject ${bucket}/${key}`,
    204,
  );
}

/**
 * The overview's values for the headers of a direct `HeadObject` of `key` in `bucket` (design.md, task 2): the size
 * exactly in bytes, then base 1024 from 1024 bytes on; the date in `zone`; S3 Standard when the answer names no class.
 */
export function expectedOverview(
  bucket: string,
  key: string,
  head: Record<string, string>,
  zone: { offsetMinutes: number; label: string },
): Record<string, string> {
  const size = Number(head['content-length']);
  const exact = `${size.toLocaleString('en-US')} ${size === 1 ? 'byte' : 'bytes'}`;
  return {
    Key: key,
    'S3 URI': `s3://${bucket}/${key}`,
    Size: size < 1024 ? exact : `${exact} (${sizeText(size)})`,
    'Content type': head['content-type'] ?? '-',
    'Last modified': creationDateText(new Date(head['last-modified'] ?? '').toISOString(), zone),
    ETag: head.etag ?? '-',
    'Storage class': head['x-amz-storage-class'] ?? 'STANDARD',
  };
}
