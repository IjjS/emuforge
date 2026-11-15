// The start and stop checks of the product form (issue 34, test-criteria.md): each starts its own form with the
// start command of its situation, run at the checkout's root with a PATH on which cargo, rustc, bun and node are
// not found (`support/product.ts`), observes it from the host and the check's browser, and stops it with the stop
// command. A user's emulator is one the check started outside the form (`OwnEmulator`).
//
// `engine.product-start-with-running-emulator-connects`, `engine.product-first-start-without-aws-directory`,
// `engine.product-emulator-profile-starts-and-stops-an-emulator`,
// `engine.product-stop-leaves-nothing-and-a-users-emulator-untouched`,
// `engine.product-profile-start-refuses-the-port-of-a-running-emulator`, `engine.product-two-forms-side-by-side`.

import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import {
  directHealth,
  emulatorDir,
  EnvError,
  expect,
  OwnEmulator,
  readEmulatorFiles,
  requireRunEmulator,
  test,
  type Ctx,
} from './support';
import { connectionView } from './support/home';
import {
  bindings,
  CHANGE_BOUND_MS,
  containerIdentity,
  containersPublishing,
  dockerRead,
  EMULATOR_FILES,
  Form,
  identities,
  productTimeout,
  refusedBrowserRequests,
  request,
  tail,
  waitAnswer,
  waitHealth,
  waitRefused,
  type CommandResult,
} from './support/product';

function expectExit(result: CommandResult, code: 'zero' | 'non-zero') {
  const message = `${result.line}: exit code; output:\n${tail(result)}`;
  if (code === 'zero') expect(result.code, message).toBe(0);
  else expect(result.code, message).not.toBe(0);
}

/** `GET http://127.0.0.1:<studio port>/`, within the bound → `200` with Studio's page (`text/html`). */
async function expectStudioPage(form: Form) {
  const answer = await waitAnswer(form.studioPort, '/');
  expect('error' in answer ? answer.error : answer.status, `GET ${form.studioUrl}: status`).toBe(200);
  if ('error' in answer) return;
  expect(String(answer.headers['content-type'] ?? ''), `GET ${form.studioUrl}: Content-Type`).toMatch(/^text\/html/);
}

/** `GET /config.json` on the Studio port → `200` with exactly `{"enginePort": <engine port>}`. */
async function expectConfig(form: Form) {
  const answer = await request(form.studioPort, 'GET', '/config.json');
  expect('error' in answer ? answer.error : answer.status, 'GET /config.json: status').toBe(200);
  if ('error' in answer) return;
  let body: unknown;
  try {
    body = JSON.parse(answer.body.toString('utf8'));
  } catch {
    body = answer.body.toString('utf8');
  }
  expect(body, 'GET /config.json: body').toEqual({ enginePort: form.enginePort });
}

/** Health within the bound → `200`, reachable, the emulator's port and endpoint. */
async function expectHealthReachable(form: Form) {
  const result = await waitHealth(form.enginePort, 200);
  expect(result, `GET /__emuforge/health on 127.0.0.1:${form.enginePort}`).toMatchObject({
    status: 200,
    body: {
      emulator: {
        reachable: true,
        port: form.emulatorPort,
        endpoint: `https://127.0.0.1:${form.emulatorPort}`,
      },
    },
  });
}

/** Studio's home shows "Connected" for the engine and for the emulator, within the bound. */
async function expectBothConnected(page: Page) {
  await expect
    .poll(
      async () => {
        const view = await connectionView(page);
        return { engine: view.engine?.status ?? null, emulator: view.emulator?.status ?? null };
      },
      { timeout: CHANGE_BOUND_MS, message: 'both rows "Connected"' },
    )
    .toEqual({ engine: 'Connected', emulator: 'Connected' });
}

/** No container and no network of the form is left. */
async function expectGone(form: Form) {
  expect(await form.waitGone(), `what is left of ${form.project}`).toEqual({ containers: [], networks: [] });
}

/** A new, empty directory under the run's output, removed when the check ends (after its form). */
function freshHome(ctx: Ctx): string {
  const home = path.join(ctx.tmp, `home-${ctx.id}-${String(Date.now())}`);
  fs.mkdirSync(home, { recursive: true });
  ctx.own({ dispose: async () => fs.rmSync(home, { recursive: true, force: true }) });
  return home;
}

/** Every path under `root`, relative and sorted. */
function entries(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      out.push(path.relative(root, full));
      if (fs.lstatSync(full).isDirectory()) walk(full);
    }
  };
  walk(root);
  return out.sort();
}

test('engine.product-start-with-running-emulator-connects', async ({ ctx, page }) => {
  test.setTimeout(productTimeout(1, 2));
  await requireRunEmulator(ctx);
  const form = await Form.create(ctx, { situation: 3, emulatorPort: ctx.emulatorPort });

  // The start command → exits 0.
  expectExit(await form.start(), 'zero');
  // `GET /` within the bound → 200 with Studio's page; `GET /config.json` → exactly {"enginePort": <engine port>}.
  await expectStudioPage(form);
  await expectConfig(form);
  // Health within the bound → 200, reachable, the emulator's port and endpoint.
  await expectHealthReachable(form);
  // Studio's home in the check's browser → "Connected" twice, and the refusing proxy logged no refused request.
  await page.goto(form.studioUrl);
  await expectBothConnected(page);
  expect(refusedBrowserRequests(ctx), 'browser requests the refusing proxy refused').toEqual([]);
});

test('engine.product-first-start-without-aws-directory', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const home = freshHome(ctx);
  const form = await Form.create(ctx, { situation: 4, home });

  // The start command → exits 0; within the bound health 200 and reachable; nothing was restarted.
  expectExit(await form.start(), 'zero');
  const afterStart = identities(await form.containers());
  const result = await waitHealth(form.enginePort, 200);
  expect(result, 'GET /__emuforge/health').toMatchObject({ status: 200, body: { emulator: { reachable: true } } });
  readEmulatorFiles(emulatorDir(home, form.emulatorPort));
  expect(identities(await form.containers()), 'the containers right after the start command').toEqual(afterStart);

  // That HOME → only `.aws`, `.aws/emulator`, `.aws/emulator/<port>` and the emulator's files in it.
  const port = `.aws/emulator/${String(form.emulatorPort)}`;
  expect(entries(home), `the entries under ${home}`).toEqual(
    ['.aws', '.aws/emulator', port, ...EMULATOR_FILES.map((f) => `${port}/${f}`)].sort(),
  );

  // The stop command → exits 0; no container and no network of the form is left.
  expectExit(await form.stop(), 'zero');
  await expectGone(form);
});

test('engine.product-emulator-profile-starts-and-stops-an-emulator', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 3));
  const form = await Form.create(ctx, { situation: 4 });
  const P = form.emulatorPort;

  // The start command → exits 0; within the bound health 200 with `emulator.port` that port.
  expectExit(await form.start(), 'zero');
  const result = await waitHealth(form.enginePort, 200);
  expect(result, 'GET /__emuforge/health').toMatchObject({ status: 200, body: { emulator: { port: P } } });

  // `GET /` and `GET /config.json` → Studio's page, and exactly {"enginePort": <engine port>}.
  await expectStudioPage(form);
  await expectConfig(form);

  // The emulator the form started: one published port, <P> on 127.0.0.1; its command holds `-t off`.
  const emulator = await form.container('aws-emulator');
  const published = bindings(await dockerRead(['inspect', '-f', '{{json .NetworkSettings.Ports}}', emulator.id]));
  expect(
    published.map((b) => ({ hostIp: b.hostIp, hostPort: b.hostPort })),
    `published ports of ${emulator.name}`,
  ).toEqual([{ hostIp: '127.0.0.1', hostPort: String(P) }]);
  const command = JSON.parse(await dockerRead(['inspect', '-f', '{{json .Config.Cmd}}', emulator.id])) as string[];
  const t = command.indexOf('-t');
  expect(t >= 0 ? command[t + 1] : null, `the argument after -t in ${JSON.stringify(command)}`).toBe('off');

  // Its health route from the host, verified against its ca.pem → 200 ok.
  readEmulatorFiles(emulatorDir(ctx.home, P));
  expect(await directHealth(ctx.home, P), `https://127.0.0.1:${P}/__admin/health`).toEqual({ status: 200, body: 'ok' });

  // `aws-emulator --version` in its container → the version and commit the run recorded; a difference is the
  // environment's (design D4).
  const version = await dockerRead(['exec', emulator.id, 'aws-emulator', '--version']);
  const seen = {
    version: /^Version: *(.*)$/m.exec(version)?.[1]?.trim() ?? '',
    commit: /^Commit: *(.*)$/m.exec(version)?.[1]?.trim() ?? '',
  };
  expect(seen.version, `aws-emulator --version in ${emulator.name}: ${version}`).not.toBe('');
  if (seen.version !== ctx.emulatorVersion || seen.commit !== ctx.emulatorCommit) {
    throw new EnvError(
      `the form's emulator is ${seen.version} (${seen.commit}), the run recorded ${ctx.emulatorVersion} (${ctx.emulatorCommit})`,
    );
  }

  // The situation 3 stop command on this form → exits 0, and the emulator's container still runs.
  expectExit(await form.stop(3), 'zero');
  expect((await containerIdentity(emulator.id)).running, `${emulator.name} runs`).toBe(true);

  // The situation 4 stop command → exits 0; nothing of the form is left, nothing listens on <P>, the emulator's
  // four files are gone from the host.
  expectExit(await form.stop(4), 'zero');
  await expectGone(form);
  expect(await waitRefused(P), `a connection to 127.0.0.1:${P}`).toBe('refused');
  const dir = emulatorDir(ctx.home, P);
  expect(
    EMULATOR_FILES.filter((f) => fs.existsSync(path.join(dir, f))),
    `files left in ${dir}`,
  ).toEqual([]);
});

test('engine.product-stop-leaves-nothing-and-a-users-emulator-untouched', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const user = await OwnEmulator.start(ctx);
  const before = await containerIdentity(user.name);
  const form = await Form.create(ctx, { situation: 3, emulatorPort: user.port });
  expectExit(await form.start(), 'zero');
  expect(await waitHealth(form.enginePort, 200), 'GET /__emuforge/health before the stop').toMatchObject({
    status: 200,
  });

  // The stop command → exits 0; no container and no network is left; neither port accepts a connection.
  expectExit(await form.stop(), 'zero');
  await expectGone(form);
  expect(await waitRefused(form.studioPort), `a connection to the Studio port ${form.studioPort}`).toBe('refused');
  expect(await waitRefused(form.enginePort), `a connection to the engine port ${form.enginePort}`).toBe('refused');

  // The user's emulator → same id, same start time, health 200 ok.
  expect(await containerIdentity(user.name), `the user's emulator ${user.name}`).toEqual(before);
  expect(await directHealth(ctx.home, user.port), "the user's emulator's health").toEqual({ status: 200, body: 'ok' });
});

test('engine.product-profile-start-refuses-the-port-of-a-running-emulator', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  // A start that exits non-zero proves the refusal only with an image that builds: without one, every start fails.
  // Recorded softly, so the rest of the check still runs.
  expect.soft(ctx.productMissing, 'the run built the product image').toBeNull();
  const user = await OwnEmulator.start(ctx);
  const before = await containerIdentity(user.name);
  const form = await Form.create(ctx, { situation: 4, emulatorPort: user.port });
  const untouched = async (when: string) => {
    expect(
      identities(await containersPublishing(user.port)),
      `${when}: the containers that publish port ${user.port}`,
    ).toEqual([{ id: before.id, startedAt: before.startedAt }]);
    expect(await containerIdentity(user.name), `${when}: the user's emulator ${user.name}`).toEqual(before);
    expect(await directHealth(ctx.home, user.port), `${when}: the user's emulator's health`).toEqual({
      status: 200,
      body: 'ok',
    });
  };

  // The situation 4 start command with EMULATOR_PORT=P → exits non-zero.
  expectExit(await form.start(), 'non-zero');
  // The containers that publish P → exactly one, the user's, as before, answering 200 ok.
  await untouched('after the failed start');

  // The situation 4 stop command → exits 0; nothing of the form is left; the user's emulator as above.
  expectExit(await form.stop(4), 'zero');
  await expectGone(form);
  await untouched('after the stop');
});

test('engine.product-two-forms-side-by-side', async ({ ctx }) => {
  test.setTimeout(productTimeout(2, 3));
  await requireRunEmulator(ctx);
  const first = await Form.create(ctx, { situation: 3, emulatorPort: ctx.emulatorPort });
  const second = await Form.create(ctx, { situation: 3, emulatorPort: ctx.emulatorPort });
  expectExit(await first.start(), 'zero');
  expectExit(await second.start(), 'zero');

  // Health on each engine port → 200 on both.
  for (const form of [first, second]) {
    expect(await waitHealth(form.enginePort, 200), `health of ${form.project}`).toMatchObject({ status: 200 });
  }
  const secondBefore = identities(await second.containers());

  // The first form's stop command → exits 0; none of its containers is left; the second answers 200 and was not
  // restarted.
  expectExit(await first.stop(), 'zero');
  expect((await first.waitGone()).containers, `containers left of ${first.project}`).toEqual([]);
  expect(await waitHealth(second.enginePort, 200), `health of ${second.project}`).toMatchObject({ status: 200 });
  expect(identities(await second.containers()), `the containers of ${second.project}`).toEqual(secondBefore);
});
