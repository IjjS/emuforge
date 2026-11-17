// The emulator-state checks of the product form (issue 34, test-criteria.md): a situation 3 form whose emulator
// is not there at the start, and one whose emulator is killed, stopped and started again with new keys, each
// observed through the form's engine port and Studio's home without restarting anything of the form.
//
// On Docker Engine on Linux the form has no gateway (issue 54 R5): with the emulator killed health's reason is
// `connection_refused` there, as in the developer's start; `connection_failed` stays the gateway form's.
//
// `engine.product-connects-when-the-emulator-starts-later`, `engine.product-reconnects-after-the-emulator-restarts`.

import type { Page } from '@playwright/test';
import fs from 'node:fs';

import { EnvError, expect, OwnEmulator, probe, test, type EmulatorFiles } from './support';
import { connectionView, markPage, stillSamePage } from './support/home';
import {
  CHANGE_BOUND_MS,
  Form,
  health,
  identities,
  platform,
  productTimeout,
  signedS3,
  tail,
  waitAnswer,
  waitHealth,
  xmlElements,
  type CommandResult,
} from './support/product';

function expectStarted(result: CommandResult) {
  expect(result.code, `${result.line}: exit code; output:\n${tail(result)}`).toBe(0);
}

async function rows(page: Page) {
  const view = await connectionView(page);
  return { engine: view.engine?.status ?? null, emulator: view.emulator?.status ?? null };
}

/** The emulator's current files; `EnvError` when it has none (it was just seen to answer 200 ok). */
function filesOf(emulator: OwnEmulator): EmulatorFiles {
  const files = emulator.files();
  if (!files) throw new EnvError(`emulator ${emulator.name} answers but its files are incomplete`);
  return files;
}

/** A signed `s3:ListBuckets` to the form's engine port, with `key`; its status, or the error. */
async function listBuckets(form: Form, key: EmulatorFiles) {
  const answer = await signedS3(form.enginePort, key, 'GET', '/');
  return 'error' in answer ? answer.error : answer.status;
}

test('engine.product-connects-when-the-emulator-starts-later', async ({ ctx, page }) => {
  test.setTimeout(productTimeout(1, 2));
  // P: a port whose emulator the check starts later. `OwnEmulator` chooses its port and keeps it across a stop and
  // a start, so it is started, stopped cleanly (its files are deleted and nothing listens on P), and its port's
  // directory is removed: the form starts with no emulator on P and no `~/.aws/emulator/<P>/` (R8).
  const emulator = await OwnEmulator.start(ctx);
  await emulator.stop();
  fs.rmSync(emulator.dir, { recursive: true, force: true });
  if ((await probe(emulator.port)) !== 'refused') {
    throw new EnvError(`127.0.0.1:${emulator.port} does not refuse connections after the emulator stopped`);
  }
  const form = await Form.create(ctx, { situation: 3, emulatorPort: emulator.port });

  // The start command → exits 0, and `GET /` on the Studio port answers 200 within the bound.
  expectStarted(await form.start());
  const afterStart = identities(await form.containers());
  const studio = await waitAnswer(form.studioPort, '/');
  expect('error' in studio ? studio.error : studio.status, `GET ${form.studioUrl}`).toBe(200);

  // Health with no emulator on P → 503, not reachable, reason `not_started`.
  expect(await waitHealth(form.enginePort, 503), 'GET /__emuforge/health').toMatchObject({
    status: 503,
    body: { emulator: { reachable: false, reason: 'not_started' } },
  });

  // Studio's home → "Connected" for the engine, and not "Connected" for the emulator.
  await page.goto(form.studioUrl);
  await expect
    .poll(
      async () => {
        const shown = await rows(page);
        return { engine: shown.engine, emulatorSettled: shown.emulator !== null && shown.emulator !== 'Checking' };
      },
      { timeout: CHANGE_BOUND_MS, message: 'the Engine row "Connected" and the Emulator row settled' },
    )
    .toEqual({ engine: 'Connected', emulatorSettled: true });
  expect((await rows(page)).emulator, 'the Emulator row with no emulator').not.toBe('Connected');
  await markPage(page);

  // An emulator then started on P → health 200 within the bound, and nothing was restarted.
  await emulator.startAgain();
  const up = await waitHealth(form.enginePort, 200);
  expect(up, 'GET /__emuforge/health after the emulator started').toMatchObject({ status: 200 });
  expect(identities(await form.containers()), `the containers of ${form.project}`).toEqual(afterStart);

  // The same page, left open → "Connected" for the emulator within the bound.
  await expect
    .poll(async () => (await rows(page)).emulator, { timeout: CHANGE_BOUND_MS, message: 'the Emulator row' })
    .toBe('Connected');
  expect(await stillSamePage(page), 'the page was not reloaded').toBe(true);
});

test('engine.product-reconnects-after-the-emulator-restarts', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const emulator = await OwnEmulator.start(ctx);
  const P = emulator.port;
  const form = await Form.create(ctx, { situation: 3, emulatorPort: P });
  expectStarted(await form.start());
  const afterStart = identities(await form.containers());
  expect(await waitHealth(form.enginePort, 200), 'the Given: health 200').toMatchObject({ status: 200 });

  // A signed s3:ListBuckets with the emulator up → 200.
  expect(await listBuckets(form, filesOf(emulator)), 's3:ListBuckets with the emulator up').toBe(200);

  // The emulator killed, its files left → health 503, not reachable, reason `connection_failed` (design D7); on
  // Docker Engine on Linux `connection_refused` (issue 54 R5).
  const killedKey = filesOf(emulator);
  await emulator.kill();
  const killedReason = (await platform()) === 'linux' ? 'connection_refused' : 'connection_failed';
  expect(await health(form.enginePort), 'GET /__emuforge/health with the emulator killed').toMatchObject({
    status: 503,
    body: { emulator: { reachable: false, reason: killedReason } },
  });

  // A signed s3:ListBuckets with the emulator killed → 503, `EmulatorUnavailable` in S3's error shape, the engine's
  // message naming the emulator's endpoint.
  const refused = await signedS3(form.enginePort, killedKey, 'GET', '/');
  expect('error' in refused ? refused.error : refused.status, 's3:ListBuckets with the emulator killed').toBe(503);
  if (!('error' in refused)) {
    const text = refused.body.toString('utf8');
    expect(String(refused.headers['content-type'] ?? ''), 'Content-Type').toMatch(/^application\/xml/);
    expect(text, 'an S3 <Error> body').toContain('<Error>');
    expect(xmlElements(refused.body, 'Code'), `Code in ${text}`).toEqual(['EmulatorUnavailable']);
    expect(xmlElements(refused.body, 'Message').join(' '), 'Message').toContain(`https://127.0.0.1:${P}`);
  }

  // The emulator stopped cleanly → health 503, reason `not_started`.
  await emulator.startAgain();
  const beforeRestart = filesOf(emulator);
  await emulator.stop();
  expect(await health(form.enginePort), 'GET /__emuforge/health with the emulator stopped').toMatchObject({
    status: 503,
    body: { emulator: { reason: 'not_started' } },
  });

  // Started again with a new ca.pem → health 200 within the bound, and nothing was restarted.
  await emulator.startAgain();
  const after = filesOf(emulator);
  if (after.caLines.join('') === beforeRestart.caLines.join('')) {
    throw new EnvError(`emulator ${emulator.name} did not write a new ca.pem when it started again`);
  }
  expect(await waitHealth(form.enginePort, 200), 'GET /__emuforge/health after the restart').toMatchObject({
    status: 200,
  });
  expect(identities(await form.containers()), `the containers of ${form.project}`).toEqual(afterStart);

  // A signed s3:ListBuckets with the new key → 200.
  expect(await listBuckets(form, after), 's3:ListBuckets with the new key').toBe(200);
});
