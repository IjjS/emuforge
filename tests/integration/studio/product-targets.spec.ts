// The target check of the one product form (issue 485, test-criteria.md): the Compose form holds one target, its own
// emulator, named `compose`; adding another is refused; its settings file is in the project's volume `settings` and
// nowhere on the host. The form is started with the start line alone, with an empty folder of the check's own as
// HOME, so anything the form wrote to the host's HOME would be found there.
//
// `engine.product-targets-compose-holds-one-target`.

import { expect, test } from './support';
import { volumeFiles } from './support/product-inspect';
import {
  entries,
  expectExit,
  Form,
  freshHome,
  productTimeout,
  request,
  SETTINGS_FILE,
  shownHealth,
  UP_BOUND_MS,
  waitReachable,
  type HttpAnswer,
} from './support/product';

const TARGETS_PATH = '/__emuforge/targets';

/** An answer's body as JSON; `null` when it is not JSON. */
function jsonOf(answer: HttpAnswer): unknown {
  try {
    return JSON.parse(answer.body.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

/** `GET /__emuforge/targets` on the form's engine port → 200; its JSON body. */
async function listTargets(form: Form, when: string): Promise<{ active?: unknown; targets?: unknown }> {
  const answer = await request(form.enginePort, 'GET', TARGETS_PATH);
  expect('error' in answer ? answer.error : answer.status, `GET ${TARGETS_PATH} ${when}`).toBe(200);
  return (jsonOf(answer as HttpAnswer) ?? {}) as { active?: unknown; targets?: unknown };
}

/** The targets of a list answer or of the settings file, as the check compares them: name, endpoint, active. */
function heldTargets(body: {
  active?: unknown;
  targets?: unknown;
}): { name: unknown; endpoint: unknown; active: boolean }[] {
  const targets = Array.isArray(body.targets) ? (body.targets as Record<string, unknown>[]) : [];
  return targets.map((t) => ({ name: t.name, endpoint: t.endpoint, active: t.name === body.active }));
}

test('engine.product-targets-compose-holds-one-target', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const home = freshHome(ctx);
  const form = await Form.create(ctx, { home });
  const endpoint = `https://127.0.0.1:${String(form.emulatorPort)}`;
  const one = [{ name: 'compose', endpoint, active: true }];

  // The Compose form started on free ports → health within the bound `200`, reachable, naming the target `compose`
  // at the form's own emulator.
  expectExit(await form.start(), 'zero');
  const reached = await waitReachable(form.enginePort, true, UP_BOUND_MS);
  expect(
    reached,
    `GET /__emuforge/health within the bound after the start line: ${shownHealth(reached)}`,
  ).toMatchObject({
    status: 200,
    body: { target: 'compose', emulator: { reachable: true, endpoint } },
  });

  // `GET /__emuforge/targets` → one target, `compose`, at https://127.0.0.1:<EMULATOR_PORT>, active.
  const listed = await listTargets(form, 'after the start line');
  expect(listed.active, `the active target in ${JSON.stringify(listed)}`).toBe('compose');
  expect(heldTargets(listed), `the targets in ${JSON.stringify(listed)}`).toEqual(one);

  // `POST /__emuforge/targets` → 403 ComposeHoldsOneTarget, whatever the body: a valid target on another loopback
  // port, a broken body, no body; the list after them is unchanged.
  const other = JSON.stringify({ name: 'other', endpoint: `https://127.0.0.1:${String(form.studioPort)}` });
  const bodies: [string, Record<string, string>, Buffer][] = [
    ['a valid target', { 'content-type': 'application/json' }, Buffer.from(other)],
    ['a broken body', { 'content-type': 'application/json' }, Buffer.from('{"name":')],
    ['no body', {}, Buffer.alloc(0)],
  ];
  for (const [what, headers, body] of bodies) {
    const answer = await request(form.enginePort, 'POST', TARGETS_PATH, headers, body);
    expect('error' in answer ? answer.error : answer.status, `POST ${TARGETS_PATH} with ${what}`).toBe(403);
    expect(
      (jsonOf(answer as HttpAnswer) as { error?: { code?: unknown } } | null)?.error?.code,
      `the error code of POST ${TARGETS_PATH} with ${what}`,
    ).toBe('ComposeHoldsOneTarget');
  }
  expect(heldTargets(await listTargets(form, 'after the refused adds')), 'the targets after the refused adds').toEqual(
    one,
  );

  // targets.json → in the project's volume `settings`, the only file there, holding the one target; nowhere on the
  // host: the form's HOME holds no file of that name and no `.config` folder.
  const volume = await form.volume('settings');
  expect(volume, `the volume settings of ${form.project}`).not.toBe('');
  const files = await volumeFiles(ctx, volume);
  expect([...files.keys()], `the files in ${volume}`).toEqual([SETTINGS_FILE]);
  const held = JSON.parse((files.get(SETTINGS_FILE) ?? Buffer.from('{}')).toString('utf8')) as {
    active?: unknown;
    targets?: unknown;
  };
  expect(held.active, `the active target in ${volume}/${SETTINGS_FILE}`).toBe('compose');
  expect(heldTargets(held), `the targets in ${volume}/${SETTINGS_FILE}`).toEqual(one);
  const onHost = entries(home).filter(
    (entry) => entry.split('/').includes('.config') || entry.split('/').pop() === SETTINGS_FILE,
  );
  expect(onHost, `the settings under the form's HOME ${home}`).toEqual([]);
});
