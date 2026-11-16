// The checks of issue 54's wrapper, `./compose` at the checkout's root (requirement R8 to R14): run with the
// environment of a start command (`Form.env()`, without `EMUFORGE_UID` and `EMUFORGE_GID` unless the case sets one),
// with an emulator the user already runs and with none, and, for its refusals, inside a container of the product
// image that has no network and no Docker client. The wrapper's printed lines are compared with the plain commands
// of the one place (`support/product.ts`).
//
// `engine.product-wrapper-uses-a-running-emulator`, `engine.product-wrapper-starts-an-emulator-when-none-runs`,
// `engine.product-wrapper-refuses-root-and-bad-ids`.

import fs from 'node:fs';
import path from 'node:path';

import { directHealth, emulatorDir, EnvError, expect, OwnEmulator, probe, readEmulatorFiles, test } from './support';
import { findSecrets, secretValues } from './support/product-inspect';
import {
  bindings,
  COMMANDS,
  commandLine,
  composeArgs,
  containerIdentity,
  dockerRead,
  EMULATOR_FILES,
  Form,
  platform,
  productTimeout,
  START_BOUND_MS,
  STOP_BOUND_MS,
  tail,
  waitAnswer,
  waitHealth,
  waitRefused,
  userIds,
  WRAPPER,
  type CommandResult,
} from './support/product';
import { awsEntries, freshHome, printed, processIds, wrapperInContainer } from './support/product-wrapper';

function expectExit(result: CommandResult, code: number) {
  expect(result.code, `${result.line}: exit code; output:\n${tail(result)}`).toBe(code);
}

/** It prints `<line>`: the one line of standard error that starts with `+ ` is `+ <line>`. */
function expectPrinted(result: CommandResult, args: string[]) {
  expect(printed(result), `${result.line}: the lines it printed; stderr:\n${result.stderr}`).toEqual([
    `+ ${commandLine(args)}`,
  ]);
}

/** Health within the bound → `200`, reachable, `emulator.port` the given port. */
async function expectReachable(enginePort: number, emulatorPort: number) {
  expect(await waitHealth(enginePort, 200), `GET /__emuforge/health on 127.0.0.1:${enginePort}`).toMatchObject({
    status: 200,
    body: { emulator: { reachable: true, port: emulatorPort } },
  });
}

test('engine.product-wrapper-uses-a-running-emulator', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 3));
  const on = await platform();
  const user = await userIds();
  // A user's emulator on P, its id and start time noted; free engine and Studio ports; EMULATOR_PORT=P; EMUFORGE_GID a
  // number that is neither 0 nor the user's gid.
  const emulator = await OwnEmulator.start(ctx);
  const before = await containerIdentity(emulator.name);
  const form = await Form.create(ctx, { situation: 3, emulatorPort: emulator.port, prepared: false });
  const gid = user.gid === '4242' ? '4243' : '4242';
  const env = { ...form.env(), EMUFORGE_GID: gid };
  const wrapper = (args: string[]) => form.run(args, START_BOUND_MS, env);

  // `./compose up` → exits 0 and prints the platform's situation 3 start line (R11, R12).
  const up = await wrapper(WRAPPER.up);
  expectExit(up, 0);
  expectPrinted(up, COMMANDS[on][3].start);

  // Health within the bound → 200, reachable, port P; `GET /` on the Studio port → 200 with Studio's page.
  await expectReachable(form.enginePort, emulator.port);
  const page = await waitAnswer(form.studioPort, '/');
  expect('error' in page ? page.error : page.status, `GET ${form.studioUrl}: status`).toBe(200);
  if (!('error' in page)) {
    expect(String(page.headers['content-type'] ?? ''), `GET ${form.studioUrl}: Content-Type`).toMatch(/^text\/html/);
  }

  // The form's containers → none is of the service `aws-emulator` (owner decision 1).
  const containers = await form.containers();
  expect(
    containers.filter((c) => c.service === 'aws-emulator').map((c) => c.name),
    `containers of service aws-emulator of ${form.project}`,
  ).toEqual([]);

  // The processes of `engine` and `studio` → on Docker Engine on Linux the user's uid and the gid EMUFORGE_GID was set
  // to (R10); on Docker Desktop no uid is 0.
  for (const service of ['engine', 'studio']) {
    const rows = await processIds((await form.container(service)).id);
    ctx.log(`processes of ${service}: ${JSON.stringify(rows)}`);
    expect(rows.length, `processes of ${service}`).toBeGreaterThan(0);
    if (on === 'linux') {
      expect(
        rows.filter((r) => r.uid !== user.uid || r.gid !== gid),
        `processes of ${service} whose ids are not ${user.uid}:${gid}`,
      ).toEqual([]);
    } else {
      expect(
        rows.filter((r) => ['0', 'root'].includes(r.uid)),
        `processes of ${service} with user id 0`,
      ).toEqual([]);
    }
  }

  // `./compose ps -a` → exits 0, prints the passed-on line, and its output names the form's engine and studio
  // containers (R14).
  const ps = await wrapper(WRAPPER.ps);
  expectExit(ps, 0);
  expectPrinted(ps, composeArgs(on, 4, 'ps', '-a'));
  for (const service of ['engine', 'studio']) {
    const name = (await form.container(service)).name;
    expect(ps.stdout, `${ps.line}: its standard output names ${name}`).toContain(name);
  }

  // `./compose logs` → exits 0 and prints the same line ending in `logs` (R14).
  const logs = await wrapper(WRAPPER.logs);
  expectExit(logs, 0);
  expectPrinted(logs, composeArgs(on, 4, 'logs'));

  // `./compose down` → exits 0, prints the platform's situation 4 stop line; nothing of the form is left, and
  // neither the Studio port nor the engine port accepts a connection (R13).
  const down = await form.run(WRAPPER.down, STOP_BOUND_MS, env);
  expectExit(down, 0);
  expectPrinted(down, COMMANDS[on][4].stop);
  expect(await form.waitGone(), `what is left of ${form.project}`).toEqual({ containers: [], networks: [] });
  expect(await waitRefused(form.studioPort), `a connection to the Studio port ${form.studioPort}`).toBe('refused');
  expect(await waitRefused(form.enginePort), `a connection to the engine port ${form.enginePort}`).toBe('refused');

  // The user's emulator → same id, same start time, health 200 ok.
  expect(await containerIdentity(emulator.name), `the user's emulator ${emulator.name}`).toEqual(before);
  expect(await directHealth(ctx.home, emulator.port), "the user's emulator's health").toEqual({
    status: 200,
    body: 'ok',
  });
});

test('engine.product-wrapper-starts-an-emulator-when-none-runs', async ({ ctx }) => {
  test.setTimeout(productTimeout(2, 3));
  const on = await platform();
  const user = await userIds();
  // A new, empty HOME; free ports, nothing on EMULATOR_PORT.
  const home = freshHome(ctx);
  const form = await Form.create(ctx, { situation: 4, home, prepared: false });
  const P = form.emulatorPort;
  if ((await probe(P)) !== 'refused') throw new EnvError(`127.0.0.1:${P} does not refuse connections`);
  const env = form.env();
  const outputs: CommandResult[] = [];
  const wrapper = async (args: string[], boundMs: number) => {
    const result = await form.run(args, boundMs, env);
    outputs.push(result);
    return result;
  };

  // `./compose up` → exits 0 and prints the platform's situation 4 start line (R11).
  const up = await wrapper(WRAPPER.up, START_BOUND_MS);
  expectExit(up, 0);
  expectPrinted(up, COMMANDS[on][4].start);

  // Health within the bound → 200, reachable, `emulator.port` that port.
  await expectReachable(form.enginePort, P);

  // The form's containers → exactly one of service `aws-emulator`, its one published port P on 127.0.0.1.
  const emulator = await form.container('aws-emulator');
  const published = bindings(await dockerRead(['inspect', '-f', '{{json .NetworkSettings.Ports}}', emulator.id]));
  expect(
    published.map((b) => ({ hostIp: b.hostIp, hostPort: b.hostPort })),
    `published ports of ${emulator.name}`,
  ).toEqual([{ hostIp: '127.0.0.1', hostPort: String(P) }]);

  // That HOME → the only entries under `.aws` are `.aws/emulator`, its port's directory and the emulator's four files;
  // on Docker Engine on Linux they belong to the user's uid, and the processes of engine and studio have the user's
  // ids (R10).
  const port = `.aws/emulator/${String(P)}`;
  const files = EMULATOR_FILES.map((f) => `${port}/${f}`);
  expect(awsEntries(home), `the entries under ${path.join(home, '.aws')}`).toEqual(
    ['.aws', '.aws/emulator', port, ...files].sort(),
  );
  if (on === 'linux') {
    const notOwned = ['.aws/emulator', port, ...files].filter(
      (entry) => String(fs.statSync(path.join(home, entry)).uid) !== user.uid,
    );
    expect(notOwned, `entries under ${path.join(home, '.aws')} that do not belong to uid ${user.uid}`).toEqual([]);
    for (const service of ['engine', 'studio']) {
      const rows = await processIds((await form.container(service)).id);
      ctx.log(`processes of ${service}: ${JSON.stringify(rows)}`);
      expect(rows.length, `processes of ${service}`).toBeGreaterThan(0);
      expect(
        rows.filter((r) => r.uid !== user.uid || r.gid !== user.gid),
        `processes of ${service} whose ids are not ${user.uid}:${user.gid}`,
      ).toEqual([]);
    }
  }
  const key = readEmulatorFiles(emulatorDir(home, P));
  if (!key) throw new EnvError(`the emulator files under ${emulatorDir(home, P)} are incomplete`);
  const secrets = secretValues(key);
  const emulatorBefore = await containerIdentity(emulator.id);

  // `./compose up` a second time → exits 0, prints the situation 4 start line again, the emulator's container has the
  // same id and start time, and health answers 200 within the bound (R11, first rule).
  const again = await wrapper(WRAPPER.up, START_BOUND_MS);
  expectExit(again, 0);
  expectPrinted(again, COMMANDS[on][4].start);
  expect(await containerIdentity(emulator.id), `the emulator ${emulator.name} after the second up`).toEqual(
    emulatorBefore,
  );
  expect(await waitHealth(form.enginePort, 200), 'GET /__emuforge/health after the second up').toMatchObject({
    status: 200,
  });

  // `./compose down` → exits 0, prints the situation 4 stop line; nothing of the form is left, nothing listens on P,
  // the emulator's four files are gone.
  const down = await wrapper(WRAPPER.down, STOP_BOUND_MS);
  expectExit(down, 0);
  expectPrinted(down, COMMANDS[on][4].stop);
  expect(await form.waitGone(), `what is left of ${form.project}`).toEqual({ containers: [], networks: [] });
  expect(await waitRefused(P), `a connection to 127.0.0.1:${P}`).toBe('refused');
  const dir = emulatorDir(home, P);
  expect(
    EMULATOR_FILES.filter((f) => fs.existsSync(path.join(dir, f))),
    `files left in ${dir}`,
  ).toEqual([]);

  // Everything the wrapper wrote to both streams in this check → none of the emulator's secret values (C2).
  expect(
    outputs.flatMap((r) => findSecrets(`the output of ${r.line}`, `${r.stdout}\n${r.stderr}`, secrets)),
    "the emulator's secret values in the wrapper's output",
  ).toEqual([]);
});

/** A refusal: exit 1, one line on standard error, and `command not found` in neither stream. The line. */
function expectRefused(result: CommandResult, what: string): string {
  const lines = result.stderr.split('\n').filter((line) => line.trim() !== '');
  expect(result.code, `${what}: exit code; output:\n${tail(result)}`).toBe(1);
  expect(lines, `${what}: the lines on standard error`).toHaveLength(1);
  expect(`${result.stdout}\n${result.stderr}`, `${what}: the output`).not.toContain('command not found');
  return lines[0] ?? '';
}

const ROOT = '0:0';
const NOT_ROOT = '1000:1000';

test('engine.product-wrapper-refuses-root-and-bad-ids', async ({ ctx }) => {
  test.setTimeout(productTimeout(0, 0) + 12 * 60_000);
  const run = (what: string, user: string, line: string, env: Record<string, string> = {}) => {
    ctx.log(`case: ${what}`);
    return wrapperInContainer(ctx, user, line, env);
  };

  // `compose up` as uid 0 → refused; the line says EmuForge is not started as root (R8).
  const rootLine = expectRefused(await run('up as uid 0', ROOT, './compose up'), 'compose up as uid 0');
  expect(rootLine, 'the root line').toMatch(/EmuForge/i);
  expect(rootLine, 'the root line').toMatch(/\broot\b/i);

  // `compose`, no argument, as uid 0 → refused with the same line (the root test is first).
  expect(
    expectRefused(await run('no argument as uid 0', ROOT, './compose'), 'compose as uid 0'),
    'compose as uid 0: the line',
  ).toBe(rootLine);

  // `compose up`, not root, EMUFORGE_UID=0 and again EMUFORGE_GID=0 → refused with the root line each time.
  for (const variable of ['EMUFORGE_UID', 'EMUFORGE_GID']) {
    const what = `compose up with ${variable}=0`;
    expect(expectRefused(await run(what, NOT_ROOT, './compose up', { [variable]: '0' }), what), `${what}: the line`).toBe(
      rootLine,
    );
  }

  // `compose up`, not root, a variable that is not a decimal number → refused with a line that names it and is not
  // the root line.
  const bad: [string, string][] = [
    ['EMUFORGE_UID', '00'],
    ['EMUFORGE_UID', 'abc'],
    ['EMUFORGE_UID', ''],
    ['EMUFORGE_GID', 'abc'],
  ];
  for (const [variable, value] of bad) {
    const what = `compose up with ${variable}=${JSON.stringify(value)}`;
    const line = expectRefused(await run(what, NOT_ROOT, './compose up', { [variable]: value }), what);
    expect(line, `${what}: the line names ${variable}`).toContain(variable);
    expect(line, `${what}: the line is not the root line`).not.toBe(rootLine);
  }

  // `compose`, no argument, not root → exit 2, a usage line naming `up` and `down`, no `command not found` (R14).
  const usage = await run('no argument, not root', NOT_ROOT, './compose');
  expect(usage.code, `compose, not root: exit code; output:\n${tail(usage)}`).toBe(2);
  expect(
    usage.stderr.split('\n').filter((line) => /\bup\b/.test(line) && /\bdown\b/.test(line)),
    'compose, not root: a usage line naming up and down',
  ).not.toEqual([]);
  expect(`${usage.stdout}\n${usage.stderr}`, 'compose, not root: the output').not.toContain('command not found');

  // `compose up`, not root, both ids 1000 → not refused: neither the root line nor a line naming a variable, and it
  // ends non-zero with the shell's `command not found` for `docker` (the wrapper reaches Docker only now).
  const reached = await run('up, not root, ids 1000', NOT_ROOT, './compose up', {
    EMUFORGE_UID: '1000',
    EMUFORGE_GID: '1000',
  });
  const lines = reached.stderr.split('\n');
  expect(
    lines.filter((line) => line === rootLine || /EMUFORGE_(UID|GID)/.test(line)),
    'compose up with ids 1000: the root line or a line naming a variable',
  ).toEqual([]);
  expect(reached.code, `compose up with ids 1000: exit code; output:\n${tail(reached)}`).not.toBe(0);
  expect(
    lines.filter((line) => /\bdocker\b/.test(line) && line.includes('command not found')),
    `compose up with ids 1000: the shell's command not found for docker; output:\n${tail(reached)}`,
  ).not.toEqual([]);
});
