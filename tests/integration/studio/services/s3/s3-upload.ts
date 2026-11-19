// The Upload page and "Create folder" (issue 480, task 3) for the checks: their words and parts, the rows of the
// files as shown, and the direct `ListMultipartUploads`. Files are given to the page's picker from memory.

import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { expect } from '../../support/check';
import { ACTION } from '../../support/frame';
import { type DirectEnv, objectPath, refusalMessage, s3Direct, shownDirect } from './s3';

/** The page's address for bucket `name` at `prefix`: `/aws/s3/bucket/<name>/upload?prefix=<prefix>`. */
export function uploadAddress(name: string, prefix = ''): string {
  const base = `/aws/s3/bucket/${encodeURIComponent(name)}/upload`;
  return prefix === '' ? base : `${base}?${new URLSearchParams({ prefix }).toString()}`;
}

/** What the bucket keeps at most in the emulator (requirement, "Sizes"). */
export const BUCKET_LIMIT = 67108864;

export const MIB = 1024 * 1024;

/** "Uploaded `{n}` of `{m}` files." */
export function uploadedText(n: number, m: number): string {
  return `Uploaded ${String(n)} of ${String(m)} files.`;
}

/** "Folder `{name}` created." and "A folder `{name}` already exists here." */
export function folderCreated(name: string): string {
  return `Folder ${name} created.`;
}
export function folderExists(name: string): string {
  return `A folder ${name} already exists here.`;
}

/** A file to give the picker. */
export interface PickedFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** `bytes` random bytes. */
export function randomFile(name: string, bytes: number, mimeType = 'application/octet-stream'): PickedFile {
  return { name, mimeType, buffer: randomBytes(bytes) };
}

/** The Upload page's parts. */
export function uploadPage(page: Page) {
  const main = page.getByRole('main');
  return {
    files: main.locator('input[type="file"]'),
    upload: main.getByRole('button', { name: 'Upload', exact: true }),
    goTo: (name: string) => main.getByRole('link', { name: `Go to ${name}`, exact: true }),
  };
}

/** "Add files" with `files`, then waits until the table lists each by name. */
export async function addFiles(page: Page, files: PickedFile[]): Promise<void> {
  await uploadPage(page).files.setInputFiles(files);
  await expect
    .poll(async () => (await fileRows(page)).map((r) => r.name), { message: 'the files listed', ...ACTION })
    .toEqual(files.map((f) => f.name));
}

/** The rows of "Files" as shown: name and status. */
export async function fileRows(page: Page): Promise<{ name: string; status: string }[]> {
  return page.getByRole('main').evaluate((main) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const table = [...main.querySelectorAll('table')].find(
      (t) => t.tBodies.length > 0 && !t.closest('[aria-hidden="true"]'),
    );
    if (table === undefined) return [];
    const headings = [...(table.tHead?.rows[0]?.cells ?? [])].map((c) => norm((c as HTMLElement).innerText));
    const [n, s] = [headings.indexOf('Name'), headings.indexOf('Status')];
    if (n < 0 || s < 0) return [];
    return [...table.tBodies[0].rows]
      .filter((row) => row.cells.length > 1)
      .map((row) => ({
        name: norm((row.cells[n] as HTMLElement).innerText),
        status: norm((row.cells[s] as HTMLElement).innerText),
      }));
  });
}

/** "Create folder" on the Objects tab and the dialog's parts. */
export function createFolder(page: Page) {
  const dialog = page.getByRole('dialog');
  return {
    open: page.getByRole('main').getByRole('button', { name: 'Create folder', exact: true }).first(),
    dialog,
    name: dialog.getByRole('textbox', { name: 'Folder name' }),
    create: dialog.getByRole('button', { name: 'Create folder', exact: true }),
  };
}

/** The Objects tab's "Upload" (a link to the page). */
export function uploadLink(page: Page) {
  return page
    .getByRole('main')
    .getByRole('link', { name: 'Upload', exact: true })
    .or(page.getByRole('main').getByRole('button', { name: 'Upload', exact: true }))
    .first();
}

/** The keys of the multipart uploads a direct `ListMultipartUploads` of `bucket` lists. */
export async function multipartUploadsDirect(env: DirectEnv, port: number, bucket: string): Promise<string[]> {
  const answer = await s3Direct(env, port, { method: 'GET', pathname: `/${bucket}`, query: [['uploads', '']] });
  expect(
    'error' in answer ? answer.error : answer.status,
    `direct ListMultipartUploads ${bucket}: ${shownDirect(answer)}`,
  ).toBe(200);
  const body = 'error' in answer ? '' : answer.body;
  return [...body.matchAll(/<Upload>[\s\S]*?<Key>([^<]*)<\/Key>[\s\S]*?<\/Upload>/g)].map((m) => m[1]);
}

/**
 * The emulator's message when `body` is put as `key` in one direct `PutObject` of `bucket`, which it refuses. A refusal
 * leaves the bucket as it was.
 */
export async function putRefusalDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const answer = await s3Direct(env, port, {
    method: 'PUT',
    pathname: objectPath(bucket, key),
    body,
    headers: { 'content-type': contentType },
  });
  return refusalMessage(answer, `direct PutObject ${bucket}/${key}`);
}

/**
 * The emulator's message when a direct multipart upload of `key` in `bucket` sends `part` as its part 1, which it
 * refuses; the upload is aborted again, and `ListMultipartUploads` must list none of `key` afterwards.
 */
export async function partRefusalDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  key: string,
  part: Buffer,
  contentType: string,
): Promise<string> {
  const path = objectPath(bucket, key);
  const created = await s3Direct(env, port, {
    method: 'POST',
    pathname: path,
    query: [['uploads', '']],
    headers: { 'content-type': contentType },
  });
  expect('error' in created ? created.error : created.status, `direct CreateMultipartUpload ${bucket}/${key}`).toBe(
    200,
  );
  const uploadId = /<UploadId>([^<]*)<\/UploadId>/.exec('error' in created ? '' : created.body)?.[1] ?? '';
  expect(uploadId, `direct CreateMultipartUpload ${bucket}/${key}: its upload id`).not.toBe('');
  try {
    const answer = await s3Direct(env, port, {
      method: 'PUT',
      pathname: path,
      query: [
        ['partNumber', '1'],
        ['uploadId', uploadId],
      ],
      body: part,
    });
    return refusalMessage(answer, `direct UploadPart 1 of ${bucket}/${key}`);
  } finally {
    const aborted = await s3Direct(env, port, { method: 'DELETE', pathname: path, query: [['uploadId', uploadId]] });
    expect('error' in aborted ? aborted.error : aborted.status, `direct AbortMultipartUpload ${bucket}/${key}`).toBe(
      204,
    );
  }
}

/**
 * `message` as a pattern that a row's status must match: the emulator's words exactly, with only the count of bytes
 * the bucket would hold left open, since it counts each request's own overhead.
 */
export function refusalPattern(message: string): RegExp {
  const escaped = message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^Failed: ${escaped.replace(/holding \d+ bytes/, 'holding \\d+ bytes')}$`);
}
