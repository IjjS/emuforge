// `studio.app-talks-only-to-engine-and-own-origin` (test-criteria.md, issue 3, Flow; rewritten for issue 16's routes,
// R9.3, and for issue 56, which gives S3's route the bucket list: the run waits for its `h1` "Buckets" and the
// table's first answer, so the `ListBuckets` request is covered too; its own `max-buckets` parameter is an AWS
// request's, not a query string Studio added, PM decision on decisions-needed 7): in one run through Home, "Refresh", the AWS
// area's index, a service route in it and Studio's not-found route, the page talks only to its own origin and the engine, never
// holds an emulator key or a line of its certificate, and keeps the session token out of URLs, the console and
// everything but the `X-EmuForge-Session` request header (requirement 3.1, 4).

import fs from 'node:fs';
import path from 'node:path';

import { emulatorDir, EnvError, expect, readEmulatorFiles, startStack, test } from './support';
import { connectionView } from './support/home';
import { isListBuckets } from './support/s3';
import { HEALTH_PATH, Traffic } from './support/traffic';

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

test('studio.app-talks-only-to-engine-and-own-origin', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const files = readEmulatorFiles(emulatorDir(ctx.home, stack.emulatorPort));
  if (!files)
    throw new EnvError(`the emulator files under ${emulatorDir(ctx.home, stack.emulatorPort)} are incomplete`);
  const traffic = Traffic.attach(ctx, context, page, { bodies: true });

  // Open `/`, wait for "Connected", choose "Refresh", open `/aws`, `/aws/s3` (until the bucket list's `h1` and the
  // table's first answer) and `/does-not-exist`.
  await page.goto('/');
  await expect
    .poll(() => connectionView(page), { timeout: 10_000 })
    .toMatchObject({ engine: { status: 'Connected' }, emulator: { status: 'Connected' } });
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === HEALTH_PATH, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await answered;
  await page.goto('/aws');
  await expect(page.getByRole('heading', { level: 1, name: 'Amazon Web Services', exact: true })).toBeVisible();
  const listed = page.waitForResponse((r) => isListBuckets(r.url(), r.request().method(), stack.engine.url), {
    timeout: 10_000,
  });
  await page.goto('/aws/s3');
  await expect(page.getByRole('heading', { level: 1, name: 'Buckets', exact: true })).toBeVisible();
  await listed;
  await page.goto('/does-not-exist');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found', exact: true })).toBeVisible();
  await traffic.settle();
  ctx.log(
    `the page made ${String(traffic.requests.length)} requests; ${String(traffic.tokens.length)} session token(s)`,
  );

  // → every request the page made went to the Studio origin or to `http://127.0.0.1:<engine port>`; none to another
  // host or port. (`data:` and `blob:` URLs name no host; the browser serves them itself.)
  const allowed = [stack.studio.origin, stack.engine.url];
  const elsewhere = traffic.requests
    .map((r) => new URL(r.url))
    .filter((url) => url.protocol !== 'data:' && url.protocol !== 'blob:' && !allowed.includes(url.origin))
    .map((url) => url.origin + url.pathname);
  expect(elsewhere, `requests to anything but ${allowed.join(' and ')}`).toEqual([]);
  expect(traffic.to(stack.engine.url, HEALTH_PATH).length, 'health requests to the engine').toBeGreaterThan(0);

  // → no response body the browser received, no file of the built app and no browser storage contains the
  // emulator's access key id, its secret access key, or any line of its `ca.pem`. Only which secret and where is
  // reported, never the value.
  const secrets: [string, string][] = [
    ['access key id', files.accessKeyId],
    ['secret access key', files.secretAccessKey],
    ...files.caLines.map((line, i): [string, string] => [`ca.pem base64 line ${String(i + 1)}`, line]),
  ];
  const leaks: string[] = [];
  const search = (where: string, text: string) => {
    for (const [name, value] of secrets) if (text.includes(value)) leaks.push(`${name} in ${where}`);
  };
  for (const { url, body } of traffic.bodies) search(`the response body of ${url}`, body.toString('latin1'));
  const dist = path.join(ctx.studioDir, 'dist');
  const built = filesUnder(dist);
  expect(built.length, `files of the built app under ${dist}`).toBeGreaterThan(0);
  for (const file of built) search(path.relative(ctx.checkout, file), fs.readFileSync(file).toString('latin1'));
  const storage = await page.evaluate(async () => {
    const dump = (s: Storage) => JSON.stringify(Object.entries(s));
    const databases: string[] = [];
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of db.objectStoreNames) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store, 'readonly').objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        databases.push(`${info.name}/${store}: ${JSON.stringify(rows)}`);
      }
      db.close();
    }
    return { local: dump(localStorage), session: dump(sessionStorage), indexedDB: databases.join('\n') };
  });
  search('localStorage', storage.local);
  search('sessionStorage', storage.session);
  search('IndexedDB', storage.indexedDB);
  search('cookies', JSON.stringify(await context.cookies()));
  expect(leaks, 'emulator secrets found').toEqual([]);

  // → no browser console message contains the session token.
  expect(traffic.tokens.length, 'session tokens the engine handed the page').toBeGreaterThan(0);
  const tokenIn = (text: string) => traffic.tokens.some((token) => text.includes(token));
  expect(
    traffic.console.filter(tokenIn).length,
    `console messages carrying the session token (of ${String(traffic.console.length)})`,
  ).toBe(0);

  // → no request URL and no page URL carries the session token; no page URL, no request to Studio's origin and no
  // request to the engine's `/__emuforge/` routes carries a query string Studio added. An AWS request to the engine
  // keeps its own parameters (`ListBuckets` is `GET /?max-buckets=…`, R4.1; PM decision on decisions-needed 7). The
  // token appears only in the `X-EmuForge-Session` request header. The check itself opens no address with a query
  // string.
  const awsRequest = (url: URL) => url.origin === stack.engine.url && !url.pathname.startsWith('/__emuforge/');
  const urlFindings: string[] = [];
  const checkUrl = (url: string, mayCarryQuery: (parsed: URL) => boolean) => {
    const parsed = new URL(url);
    if (tokenIn(url)) urlFindings.push(`session token in the URL ${parsed.origin}${parsed.pathname}`);
    else if (parsed.search !== '' && !mayCarryQuery(parsed)) urlFindings.push(`query string in ${url}`);
  };
  for (const request of traffic.requests) checkUrl(request.url, awsRequest);
  for (const url of traffic.pageUrls) checkUrl(url, () => false);
  expect(urlFindings).toEqual([]);
  const elsewhereInRequest: string[] = [];
  let carried = 0;
  for (const request of traffic.requests) {
    const where = `${request.method} ${new URL(request.url).pathname}`;
    for (const [name, value] of Object.entries(request.headers)) {
      if (!tokenIn(value)) continue;
      if (name.toLowerCase() === 'x-emuforge-session') carried++;
      else elsewhereInRequest.push(`header ${name} of ${where}`);
    }
    if (request.postData !== null && tokenIn(request.postData)) elsewhereInRequest.push(`body of ${where}`);
  }
  expect(elsewhereInRequest, 'the session token outside X-EmuForge-Session').toEqual([]);
  expect(carried, 'requests carrying the token in X-EmuForge-Session').toBeGreaterThan(0);
});
