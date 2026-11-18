// Support of the connections checks (issue 486, test-criteria.md "Integration"): the engine's targets API called
// straight, as the CLI calls it (no `Origin`, no session: the engine's browser guard lets such a caller through), the
// connections page's parts, and buckets made and read on one emulator by direct signed calls.

import http from 'node:http';

import type { Locator, Page } from '@playwright/test';

import { bucketNames, directS3, shown } from './aws-clients';
import { expect, type Ctx } from './check';
import { ACTION } from './frame';

export const CONNECTIONS_PATH = '/connections';
export const BUCKETS_PATH = '/aws/s3/buckets';
const TARGETS_PATH = '/__emuforge/targets';

/** One answer of the engine's targets API: its status and its body as JSON (`null` when it is not JSON). */
export interface ApiAnswer {
  status: number;
  json: unknown;
}

/** A request to the engine on `127.0.0.1:<port>`, without `Origin`; a JSON body when `body` is given. */
export function engineCall(port: number, method: string, pathname: string, body?: object): Promise<ApiAnswer> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers: payload === undefined ? {} : { 'content-type': 'application/json' },
        timeout: 15_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = text === '' ? null : (JSON.parse(text) as unknown);
          } catch {
            json = null;
          }
          resolve({ status: response.statusCode ?? 0, json });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error(`${method} ${pathname}: no answer within 15 s`)));
    request.on('error', reject);
    request.end(payload);
  });
}

/** The engine's list, as the CLI reads it. */
export interface TargetList {
  active: string;
  form: string;
  targets: { name: string; endpoint: string; active: boolean }[];
}

/** `GET /__emuforge/targets` → 200; its list. */
export async function listTargets(port: number, when: string): Promise<TargetList> {
  const answer = await engineCall(port, 'GET', TARGETS_PATH);
  expect(answer.status, `the engine's list ${when}`).toBe(200);
  return answer.json as TargetList;
}

/** `POST /__emuforge/targets` → 201: the connection is added as the CLI adds it. */
export async function addTarget(port: number, name: string, endpoint: string): Promise<void> {
  const answer = await engineCall(port, 'POST', TARGETS_PATH, { name, endpoint });
  expect(answer.status, `add ${name} → ${endpoint} through the engine's API (${JSON.stringify(answer.json)})`).toBe(
    201,
  );
}

/** `POST /__emuforge/targets/<name>/use` → 200, as `emuforge target use <name>` would. */
export async function useTarget(port: number, name: string): Promise<void> {
  const answer = await engineCall(port, 'POST', `${TARGETS_PATH}/${name}/use`);
  expect(answer.status, `use ${name} through the engine's API (${JSON.stringify(answer.json)})`).toBe(200);
}

/** `DELETE /__emuforge/targets/<name>` → 204. */
export async function removeTarget(port: number, name: string): Promise<void> {
  const answer = await engineCall(port, 'DELETE', `${TARGETS_PATH}/${name}`);
  expect(answer.status, `remove ${name} through the engine's API (${JSON.stringify(answer.json)})`).toBe(204);
}

/** `https://127.0.0.1:<port>`. */
export function endpointOf(port: number): string {
  return `https://127.0.0.1:${String(port)}`;
}

/** Creates `bucket` on the emulator on `port` by a direct signed call, and registers its deletion. */
export async function createBucketOn(ctx: Ctx, port: number, bucket: string): Promise<void> {
  const answer = await directS3(ctx, port, 'PUT', `/${bucket}`);
  expect('error' in answer ? answer.error : answer.status, `CreateBucket ${bucket} on ${String(port)}`).toBe(200);
  ctx.own({
    dispose: async () => {
      const gone = await directS3(ctx, port, 'DELETE', `/${bucket}`);
      ctx.log(`cleanup: DeleteBucket ${bucket} on ${String(port)}: ${shown(gone)}`);
    },
  });
}

/** The bucket names the emulator on `port` lists, by a direct signed `ListBuckets`. */
export async function bucketsOn(ctx: Ctx, port: number): Promise<string[]> {
  const answer = await directS3(ctx, port, 'GET', '/');
  if ('error' in answer) throw new Error(`ListBuckets on ${String(port)}: ${answer.error}`);
  expect(answer.status, `ListBuckets on ${String(port)}`).toBe(200);
  return bucketNames(answer.body);
}

// ---------------------------------------------------------------------------------------------------------------
// The connections page.
// ---------------------------------------------------------------------------------------------------------------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Opens `/connections` (a document load) and waits until its list shows `names`, in that order. */
export async function openConnections(page: Page, names: string[]): Promise<void> {
  await page.goto(CONNECTIONS_PATH);
  await waitForList(page, names);
}

/** Goes to `/connections` by the frame's navigation link "Connections" (a route change, the same document). */
export async function followConnections(page: Page, names: string[]): Promise<void> {
  await studioNav(page).getByRole('link', { name: 'Connections', exact: true }).click(ACTION);
  await waitForList(page, names);
}

/** The frame's navigation "Studio". */
export function studioNav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Studio' });
}

async function waitForList(page: Page, names: string[]): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Connections', exact: true })).toBeVisible(ACTION);
  await expect.poll(() => rowNames(page), { ...ACTION, message: `the list reads ${names.join(', ')}` }).toEqual(names);
}

/** The names of the listed connections, in order. */
export async function rowNames(page: Page): Promise<string[]> {
  return page
    .getByRole('main')
    .getByRole('listitem')
    .evaluateAll((items) =>
      items
        .map((item) => item.querySelector('dt + dd code')?.textContent?.trim() ?? '')
        .filter((name) => name !== ''),
    );
}

/** The row of the connection `name`: the list item whose name field is exactly `name`. */
export function row(page: Page, name: string): Locator {
  return page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.locator('dd code', { hasText: new RegExp(`^${escape(name)}$`) }) })
    .first();
}

/** A row's text, white space collapsed. */
export async function rowText(page: Page, name: string): Promise<string> {
  return (await row(page, name).innerText(ACTION)).replace(/\s+/g, ' ').trim();
}

/** Waits until the page's result line reads `text` (white space collapsed). */
export async function expectResult(page: Page, text: string): Promise<void> {
  await expect(
    page.getByRole('main').getByText(new RegExp(`^\\s*${escape(text).replace(/ /g, '\\s+')}\\s*$`)),
    `the page says "${text}"`,
  ).toBeVisible(ACTION);
}

/** The add form's fields and button. */
export function addForm(page: Page) {
  const main = page.getByRole('main');
  return {
    name: main.getByRole('textbox', { name: /^Name/ }),
    endpoint: main.getByRole('textbox', { name: /^Endpoint/ }),
    submit: main.getByRole('button', { name: 'Add connection', exact: true }),
  };
}

/** Fills the add form and submits it. */
export async function addThroughForm(page: Page, name: string, endpoint: string): Promise<void> {
  const form = addForm(page);
  await form.name.fill(name, ACTION);
  await form.endpoint.fill(endpoint, ACTION);
  await form.submit.click(ACTION);
}

/** The bucket names the open S3 bucket list shows, as the visible text of its `main` holds them. */
export async function shownBuckets(page: Page, candidates: string[]): Promise<string[]> {
  const text = await page.getByRole('main').innerText(ACTION);
  return candidates.filter((name) => new RegExp(`(^|\\s)${escape(name)}(\\s|$)`).test(text));
}
