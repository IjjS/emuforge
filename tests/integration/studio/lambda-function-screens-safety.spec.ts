// What the Lambda function screens send and keep, in the built app served by `bun run serve` in front of a real engine
// and the run's emulator (test-criteria.md, issue 84, Flow — `studio.lambda-function-screens-talk-only-to-the-engine`;
// requirement R11, `studio/AGENTS.md` "Talking to AWS"): every request goes to Studio's origin or the engine, none
// carries an emulator key, nothing of a function is stored in the browser, and what the emulator returns is shown as
// text, never as HTML, without a function's environment variables or the signed URL of its code.
//
// Other checks make functions on the run's emulator at the same time, so every name here is under the check's prefix
// `<p>`. Requests are recorded from Playwright's events (`Traffic`), which only listen. Only which secret and where is
// reported, never its value. Words and readers: `support/lambda-page.ts` and `support/lambda-list.ts`; direct calls:
// `support/lambda.ts`.

import type { Page } from '@playwright/test';

import { emulatorDir, EnvError, expect, readEmulatorFiles, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { getFunctionDirect, LambdaSeeded } from './support/lambda';
import {
  applyFilter,
  CONFIRM_WORD,
  DELETE_DIALOG,
  deleteDialog,
  deletedText,
  expectNames,
  flashTexts,
  functionPath,
  openDeleteDialog,
  openList,
  screen,
  shownRows,
} from './support/lambda-list';
import { createForm, DESCRIPTION, openFunction, OVERVIEW, pairFirstLine } from './support/lambda-page';
import { Lines } from './support/lines';
import { checkPrefix } from './support/s3';
import { Traffic } from './support/traffic';

/** Every stored value of Studio's origin: `localStorage`, `sessionStorage`, IndexedDB rows, and cookies. */
async function storedValues(page: Page): Promise<string[]> {
  const stored = await page.evaluate(async () => {
    const rows: string[] = [];
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of db.objectStoreNames) {
        const all = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store, 'readonly').objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        for (const row of all) rows.push(`IndexedDB ${info.name}/${store}: ${JSON.stringify(row)}`);
      }
      db.close();
    }
    return [
      ...Object.entries(localStorage).map(([k, v]) => `localStorage ${k}=${v}`),
      ...Object.entries(sessionStorage).map(([k, v]) => `sessionStorage ${k}=${v}`),
      ...rows,
    ];
  });
  const cookies = (await page.context().cookies()).map((c) => `cookie ${c.name}=${c.value}`);
  return [...stored, ...cookies];
}

/** The whole document as HTML and as text. */
async function documentText(page: Page): Promise<string> {
  return page.evaluate(() => `${document.documentElement.outerHTML}\n${document.body.innerText}`);
}

test('studio.lambda-function-screens-talk-only-to-the-engine', async ({ ctx, page, context }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const files = readEmulatorFiles(emulatorDir(ctx.home, port));
  if (!files) throw new EnvError(`the emulator files under ${emulatorDir(ctx.home, port)} are incomplete`);
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfs-safety');
  const seeded = new LambdaSeeded(ctx, port, p);
  const traffic = Traffic.attach(ctx, context, page);
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });

  await lines.line(
    "Open the function list, a function's page and the create form, create a function with \"Create default role\" and delete it → every request of the page went to Studio's origin or the engine on `127.0.0.1`; none carried an emulator key; no stored value of Studio's origin holds a function name, a role name or an ARN",
    async () => {
      const name = `${p}-made`;
      await openList(page);
      await screen(page).create.click(ACTION);
      const f = createForm(page);
      await expect(f.h1, 'the create form').toBeVisible();
      await f.name.fill(name, ACTION);
      await f.create.click(ACTION);
      await expect(page).toHaveURL(addressOf(functionPath(name)), { timeout: 20_000 });
      await expect(heading(page, name), `the page of ${name}`).toBeVisible();
      const read = await getFunctionDirect(ctx, port, name);
      expect(read.found, `a direct GetFunction ${name}`).toBe(true);
      const functionArn = read.found ? read.configuration.FunctionArn : '';
      const roleArn = read.found ? read.configuration.Role : '';
      const roleName = roleArn.split('/').pop() ?? '';
      await openList(page);
      await applyFilter(page, name);
      await expectNames(page, [name], `the row of ${name}`);
      await openDeleteDialog(page, [name]);
      const d = deleteDialog(page);
      await d.field.fill(CONFIRM_WORD, ACTION);
      await d.delete.click(ACTION);
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}" closes`).toHaveCount(0);
      await expect
        .poll(async () => (await flashTexts(page)).some((t) => t.includes(deletedText(1))), {
          message: `the success item "${deletedText(1)}"`,
        })
        .toBe(true);
      await traffic.settle();
      ctx.log(`the page made ${String(traffic.requests.length)} requests`);

      const allowed = [stack.studio.origin, stack.engine.url];
      const elsewhere = traffic.requests
        .map((r) => new URL(r.url))
        .filter((url) => url.protocol !== 'data:' && url.protocol !== 'blob:' && !allowed.includes(url.origin))
        .map((url) => url.origin + url.pathname);
      expect(elsewhere, `requests to anything but ${allowed.join(' and ')}`).toEqual([]);
      expect(new URL(stack.engine.url).hostname, "the engine's host").toBe('127.0.0.1');
      const toEngine = traffic.requests.filter((r) => new URL(r.url).origin === stack.engine.url);
      expect(
        toEngine.some((r) => new URL(r.url).pathname.startsWith('/2015-03-31/functions')),
        'Lambda requests went to the engine',
      ).toBe(true);

      const secrets: [string, string][] = [
        ['access key id', files.accessKeyId],
        ['secret access key', files.secretAccessKey],
      ];
      const carried: string[] = [];
      for (const r of traffic.requests) {
        const where = `${r.method} ${new URL(r.url).origin}${new URL(r.url).pathname}`;
        for (const [what, value] of secrets) {
          if (r.url.includes(value)) carried.push(`${what} in the URL of ${where}`);
          for (const [header, text] of Object.entries(r.headers)) {
            if (text.includes(value)) carried.push(`${what} in the header ${header} of ${where}`);
          }
          if (r.postData !== null && r.postData.includes(value)) carried.push(`${what} in the body of ${where}`);
        }
      }
      expect(carried, 'requests carrying an emulator key').toEqual([]);

      const stored = await storedValues(page);
      ctx.log(`stored values: ${String(stored.length)}`);
      const things: [string, string][] = [
        ['the function name', name],
        ['the role name', roleName],
        ['the function ARN', functionArn],
        ['the role ARN', roleArn],
      ];
      const kept = stored.flatMap((v) =>
        things
          .filter(([, value]) => value !== '' && v.includes(value))
          .map(([what]) => `${what} in ${v.split(/[ =]/, 2).join(' ')}`),
      );
      expect(kept, 'stored values holding a function name, a role name or an ARN').toEqual([]);
    },
  );

  await lines.line(
    "A function made directly with the description `<img src=x onerror=alert(1)>` and an environment variable `SECRET` = `<p>-secret-value`, shown in the list and on its page → the description is shown as text, the page holds no image made from it and no dialog opened; neither screen holds `<p>-secret-value` or the signed URL of the function's code",
    async () => {
      const name = `${p}-markup`;
      const description = '<img src=x onerror=alert(1)>';
      const secret = `${p}-secret-value`;
      await seeded.function(name, { description, environment: { SECRET: secret } });
      const read = await getFunctionDirect(ctx, port, name);
      expect(read.found, `a direct GetFunction ${name}`).toBe(true);
      const codeLocation = read.found ? read.codeLocation : null;
      expect(codeLocation, `a direct GetFunction ${name} returns the signed URL of its code`).toBeTruthy();
      const found: string[] = [];
      const look = async (screenName: string) => {
        const imgs = await page.evaluate(() =>
          [...document.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? ''),
        );
        if (imgs.includes('x')) found.push(`${screenName}: an image made from the description`);
        const text = await documentText(page);
        if (text.includes(secret)) found.push(`${screenName}: the environment variable's value`);
        if (codeLocation) {
          const forms = [codeLocation, codeLocation.replace(/&/g, '&amp;')];
          if (forms.some((form) => text.includes(form))) found.push(`${screenName}: the signed URL of the code`);
        }
      };

      await openList(page);
      await applyFilter(page, name);
      await expectNames(page, [name], `the row of ${name}`);
      await expect
        .poll(async () => (await shownRows(page))?.[0]?.description, { message: 'the description in the list' })
        .toBe(description);
      await look('the list');

      await openFunction(page, name);
      await expect
        .poll(() => pairFirstLine(page, OVERVIEW, DESCRIPTION), { message: 'the description on the page' })
        .toBe(description);
      await look('the page');

      expect(found, 'what the screens hold').toEqual([]);
      expect(dialogs, 'dialogs the page opened').toEqual([]);
    },
  );

  lines.end();
});
