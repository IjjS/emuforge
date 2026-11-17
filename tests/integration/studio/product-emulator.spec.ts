// The emulator-state checks of the one product form (issue 437, test-criteria.md): the form's own emulator stopped
// and started again, and killed, restarted in place and replaced, each observed through the form's engine port and
// Studio's home without restarting anything else of the form. Requests through the form are signed with a made-up
// key; the engine signs them again with the emulator's key of the moment.
//
// `engine.product-connects-when-the-emulator-starts-later`, `engine.product-reconnects-after-the-emulator-restarts`.

import type { Page } from '@playwright/test';

import { expect, test } from './support';
import { connectionView, markPage, stillSamePage } from './support/home';
import { docker } from './support/product-inspect';
import {
  CHANGE_BOUND_MS,
  expectExit,
  Form,
  identities,
  madeUpKey,
  productTimeout,
  signedS3,
  STOP_BOUND_MS,
  UP_BOUND_MS,
  waitReachable,
  xmlElements,
  type HttpAnswer,
} from './support/product';
import { waitFor } from './support/wait';

async function rows(page: Page) {
  const view = await connectionView(page);
  return { engine: view.engine?.status ?? null, emulator: view.emulator?.status ?? null };
}

/** The Given of both checks: a started form whose health is reachable. */
async function started(form: Form) {
  expectExit(await form.start(), 'zero');
  expect(await waitReachable(form.enginePort, true), 'the Given: GET /__emuforge/health').toMatchObject({
    status: 200,
    body: { emulator: { reachable: true } },
  });
}

/** The gateway's, the engine's and Studio's containers, by id and start time. */
async function others(form: Form) {
  return identities((await form.containers()).filter((c) => c.service !== 'aws-emulator'));
}

/** The emulator's access key id, read inside its container; `''` when it cannot be read. */
async function emulatorKeyId(form: Form): Promise<string> {
  const files = await form.emulatorFiles();
  return 'error' in files ? '' : files.accessKeyId;
}

/** A signed s3:ListBuckets through the form with a made-up key: the answer, or the error. */
function listBuckets(form: Form): Promise<HttpAnswer | { error: string }> {
  return signedS3(form.enginePort, madeUpKey(), 'GET', '/');
}

/** Waits, at most the bound, until a ListBuckets through the form answers `status`; the last answer or error. */
async function waitList(form: Form, status: number): Promise<number | string> {
  let last: number | string = 'not sent';
  await waitFor(UP_BOUND_MS, async () => {
    const answer = await listBuckets(form);
    last = 'error' in answer ? answer.error : answer.status;
    return last === status ? true : undefined;
  });
  return last;
}

test('engine.product-connects-when-the-emulator-starts-later', async ({ ctx, page }) => {
  test.setTimeout(productTimeout(1, 2));
  const form = await Form.create(ctx);
  await started(form);
  await page.goto(form.studioUrl);
  await expect
    .poll(async () => (await rows(page)).emulator, { timeout: CHANGE_BOUND_MS, message: 'the Given: the Emulator row' })
    .toBe('Connected');
  const before = await others(form);

  // `docker compose stop aws-emulator` → health `reachable: false`, and Studio shows the emulator not connected,
  // the engine connected.
  expectExit(await form.run(form.compose('stop', 'aws-emulator'), STOP_BOUND_MS), 'zero');
  expect(await waitReachable(form.enginePort, false), 'GET /__emuforge/health with the emulator stopped').toMatchObject({
    body: { emulator: { reachable: false } },
  });
  await expect
    .poll(
      async () => {
        const shown = await rows(page);
        return { engine: shown.engine, emulatorConnected: shown.emulator === 'Connected' };
      },
      { timeout: CHANGE_BOUND_MS, message: 'the Engine row "Connected", the Emulator row not' },
    )
    .toEqual({ engine: 'Connected', emulatorConnected: false });
  await markPage(page);

  // `docker compose start aws-emulator` → within the bound health `reachable: true`, and Studio shows the emulator
  // connected without a reload by the check.
  expectExit(await form.run(form.compose('start', 'aws-emulator'), STOP_BOUND_MS), 'zero');
  expect(await waitReachable(form.enginePort, true), 'GET /__emuforge/health after the start').toMatchObject({
    status: 200,
    body: { emulator: { reachable: true } },
  });
  await expect
    .poll(async () => (await rows(page)).emulator, { timeout: CHANGE_BOUND_MS, message: 'the Emulator row' })
    .toBe('Connected');
  expect(await stillSamePage(page), 'the page was not reloaded').toBe(true);

  // The gateway's, the engine's and Studio's containers → the same ids and start times.
  expect(await others(form), `the other containers of ${form.project}`).toEqual(before);
});

test('engine.product-reconnects-after-the-emulator-restarts', async ({ ctx }) => {
  test.setTimeout(productTimeout(2, 2));
  const form = await Form.create(ctx);
  await started(form);
  const engineBefore = identities([await form.container('engine')]);
  const keyBefore = await emulatorKeyId(form);
  expect(keyBefore, "the Given: the emulator's access key id read inside its container").not.toBe('');

  // The emulator's container killed → a ListBuckets through the form is 503 with code `EmulatorUnavailable`.
  const emulator = await form.container('aws-emulator');
  const killed = await docker(['kill', emulator.id]);
  expect(killed.ok ? '' : killed.stderr, `docker kill ${emulator.name}`).toBe('');
  expect(await waitList(form, 503), 's3:ListBuckets through the form with the emulator killed').toBe(503);
  const refused = await listBuckets(form);
  expect('error' in refused ? refused.error : refused.status, 's3:ListBuckets with the emulator killed').toBe(503);
  if (!('error' in refused)) {
    expect(xmlElements(refused.body, 'Code'), `Code in ${refused.body.toString('utf8')}`).toEqual([
      'EmulatorUnavailable',
    ]);
  }

  // Started again in place → 200 within the bound, and the emulator's access key id differs from the one before
  // the kill.
  expectExit(await form.run(form.compose('start', 'aws-emulator'), STOP_BOUND_MS), 'zero');
  expect(await waitList(form, 200), 's3:ListBuckets through the form after the restart in place').toBe(200);
  const keyAfter = await emulatorKeyId(form);
  expect(keyAfter, "the emulator's access key id after the restart").not.toBe('');
  expect(keyAfter === keyBefore, "the emulator's access key id is the one before the kill").toBe(false);

  // Removed and created again → 200 within the bound.
  expectExit(await form.run(form.compose('rm', '-sf', 'aws-emulator'), STOP_BOUND_MS), 'zero');
  expectExit(await form.run(form.compose('up', '-d', '--no-build', 'aws-emulator'), STOP_BOUND_MS * 2), 'zero');
  expect(await waitList(form, 200), 's3:ListBuckets through the form after the emulator was replaced').toBe(200);

  // The engine's container → the same id and start time.
  expect(identities([await form.container('engine')]), "the engine's container").toEqual(engineBefore);
});
