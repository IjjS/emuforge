// The product checks that inspect a running form (issue 34, test-criteria.md): what it publishes and where, and what
// its image, its containers' output, environment, command lines, mounts and processes hold.
//
// `engine.product-ports-are-published-on-loopback-only`, `engine.product-holds-no-key-and-one-read-only-mount`.

import fs from 'node:fs';
import path from 'node:path';

import { EnvError, expect, registerSecret, requireRunEmulator, test } from './support';
import {
  composeArgs,
  docker,
  emulatorKey,
  findSecrets,
  hostIPv4,
  probeAt,
  SAVE_BOUND_MS,
  searchImage,
  secretValues,
  signedVia,
  statusOf,
} from './support/product-inspect';
import {
  bindings,
  dockerRead,
  Form,
  productTimeout,
  request,
  STOP_BOUND_MS,
  tail,
  waitHealth,
  type CommandResult,
  type ContainerState,
} from './support/product';
import { SESSION_PATH } from './support/traffic';

/** The services of the image the form builds; `aws-emulator` (situation 4) runs the emulator's image. */
const FORM_SERVICES = ['gateway', 'engine', 'studio'];

function expectStarted(result: CommandResult) {
  expect(result.code, `${result.line}: exit code; output:\n${tail(result)}`).toBe(0);
}

/** One container of the form per service of `services`, failing the check when one is missing or doubled. */
async function byService(form: Form, services: string[]): Promise<Record<string, ContainerState>> {
  const containers = await form.containers();
  const out: Record<string, ContainerState> = {};
  for (const service of services) {
    const found = containers.filter((c) => c.service === service);
    expect(
      found.map((c) => c.name),
      `the containers of service ${service} of ${form.project}`,
    ).toHaveLength(1);
    out[service] = found[0];
  }
  return out;
}

async function inspectJson<T>(id: string, field: string): Promise<T> {
  return JSON.parse(await dockerRead(['inspect', '-f', `{{json ${field}}}`, id])) as T;
}

test('engine.product-ports-are-published-on-loopback-only', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const form = await Form.create(ctx, { situation: 4 });
  expectStarted(await form.start());
  expect(await waitHealth(form.enginePort, 200), 'the Given: GET /__emuforge/health').toMatchObject({ status: 200 });

  // Every published port of every container of the form, the emulator's included → host address 127.0.0.1, and the
  // published host ports are exactly the Studio, engine and emulator ports.
  const published: {
    container: string;
    containerPort: string;
    hostIp: string;
    hostPort: string;
  }[] = [];
  for (const container of await form.containers()) {
    const ports = await dockerRead(['inspect', '-f', '{{json .NetworkSettings.Ports}}', container.id]);
    for (const b of bindings(ports)) published.push({ container: container.name, ...b });
  }
  ctx.log(`published: ${JSON.stringify(published)}`);
  expect(
    published.filter((b) => b.hostIp !== '127.0.0.1'),
    'published ports whose host address is not 127.0.0.1',
  ).toEqual([]);
  expect(published.map((b) => b.hostPort).sort(), 'the published host ports').toEqual(
    [form.studioPort, form.enginePort, form.emulatorPort].map(String).sort(),
  );

  // A TCP connection to each of the three ports at a non-loopback IPv4 address of the host → none is accepted.
  const addresses = hostIPv4();
  if (addresses.length === 0) throw new EnvError('the host has no non-loopback IPv4 address to connect from');
  const accepted: string[] = [];
  for (const address of addresses) {
    for (const port of [form.studioPort, form.enginePort, form.emulatorPort]) {
      const result = await probeAt(address, port);
      ctx.log(`a TCP connection to ${address}:${String(port)}: ${result}`);
      if (result === 'open') accepted.push(`${address}:${String(port)}`);
    }
  }
  expect(accepted, 'connections accepted at a non-loopback address').toEqual([]);
});

test('engine.product-holds-no-key-and-one-read-only-mount', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2) + SAVE_BOUND_MS);
  await requireRunEmulator(ctx);
  const files = emulatorKey(ctx, ctx.emulatorPort);
  const secrets = secretValues(files);
  const form = await Form.create(ctx, {
    situation: 3,
    emulatorPort: ctx.emulatorPort,
  });
  const studioOrigin = `http://127.0.0.1:${String(form.studioPort)}`;

  // The Given: started, health 200, a session request and a signed s3:ListBuckets through the form.
  expectStarted(await form.start());
  expect(await waitHealth(form.enginePort, 200), 'the Given: GET /__emuforge/health').toMatchObject({ status: 200 });
  const session = await request(form.enginePort, 'GET', SESSION_PATH, {
    origin: studioOrigin,
  });
  let token = '';
  if (!('error' in session)) {
    try {
      token = String((JSON.parse(session.body.toString('utf8')) as { token?: unknown }).token ?? '');
    } catch {
      token = '';
    }
  }
  registerSecret([token]);
  expect(statusOf(session), `the Given: GET ${SESSION_PATH} with Origin ${studioOrigin}`).toBe(200);
  expect(token, `the Given: the token of GET ${SESSION_PATH}`).not.toBe('');
  expect(statusOf(await signedVia(form.enginePort, files, 'GET', '/')), 'the Given: s3:ListBuckets').toBe(200);
  const services = await byService(form, FORM_SERVICES);

  // The form's image, every layer → none of the emulator's secret values.
  const images = [
    ...new Set(
      await Promise.all(FORM_SERVICES.map((s) => dockerRead(['inspect', '-f', '{{.Config.Image}}', services[s].id]))),
    ),
  ];
  for (const image of images) {
    const searched = await searchImage(ctx, image, form.env(), secrets);
    expect(searched.files, `files in the saved ${image}`).toBeGreaterThan(0);
    expect(searched.findings, `the emulator's secret values in the saved ${image}`).toEqual([]);
  }

  // `docker compose logs` → none of the emulator's secret values, and not the session token.
  const logs = await form.run(composeArgs(form.situation, 'logs', '--no-color'), STOP_BOUND_MS);
  expect(logs.code, `${logs.line}: exit code`).toBe(0);
  expect(
    findSecrets('docker compose logs', `${logs.stdout}\n${logs.stderr}`, [...secrets, ['the session token', token]]),
    'secret values in the output of the form',
  ).toEqual([]);

  // The environment and the command line of each container → none of the emulator's secret values.
  const inConfig: string[] = [];
  for (const container of await form.containers()) {
    const config = await dockerRead([
      'inspect',
      '-f',
      '{{json .Config.Env}} {{json .Config.Cmd}} {{json .Config.Entrypoint}} {{json .Path}} {{json .Args}}',
      container.id,
    ]);
    inConfig.push(...findSecrets(`the environment or command line of ${container.name}`, config, secrets));
  }
  expect(inConfig, "the emulator's secret values in the containers' environment and command lines").toEqual([]);

  // The mounts → `engine` has exactly one, a read-only bind of $HOME/.aws/emulator; `gateway` and `studio` none.
  type Mount = {
    Type?: string;
    Source?: string;
    Destination?: string;
    RW?: boolean;
  };
  const mounts: Record<string, Mount[]> = {};
  for (const service of FORM_SERVICES) mounts[service] = await inspectJson<Mount[]>(services[service].id, '.Mounts');
  ctx.log(`mounts: ${JSON.stringify(mounts)}`);
  const hostDir = path.join(form.home, '.aws', 'emulator');
  expect(
    mounts.engine.map((m) => ({ type: m.Type, source: m.Source, rw: m.RW })),
    "the engine's mounts",
  ).toEqual([{ type: 'bind', source: hostDir, rw: false }]);
  expect(mounts.gateway, "the gateway's mounts").toEqual([]);
  expect(mounts.studio, "Studio's mounts").toEqual([]);

  // A file created in the engine's container under its mount → a read-only error, nothing new on the host.
  const target = mounts.engine[0]?.Destination ?? '';
  const name = `emuforge-it-write-${ctx.runId}`;
  ctx.own({
    dispose: async () => fs.rmSync(path.join(hostDir, name), { force: true }),
  });
  const write = await docker(['exec', services.engine.id, 'touch', `${target}/${name}`]);
  ctx.log(`touch ${target}/${name} in the engine's container: ok ${String(write.ok)} ${write.stderr}`);
  expect(write.ok, `touch ${target}/${name} in the engine's container succeeded`).toBe(false);
  expect(write.stderr, `touch ${target}/${name}: the error`).toMatch(/read-only file system/i);
  expect(fs.existsSync(path.join(hostDir, name)), `${path.join(hostDir, name)} on the host`).toBe(false);

  // $HOME/.aws as the engine's container sees its own → `emulator` and nothing else.
  const env = await inspectJson<string[]>(services.engine.id, '.Config.Env');
  const home = env.find((e) => e.startsWith('HOME='))?.slice('HOME='.length) ?? '';
  expect(home, "HOME in the engine's container").not.toBe('');
  const listed = await docker(['exec', services.engine.id, 'ls', '-A', `${home}/.aws`]);
  expect(listed.ok ? '' : listed.stderr, `ls -A ${home}/.aws in the engine's container`).toBe('');
  expect(
    listed.stdout.split('\n').filter((l) => l !== ''),
    `${home}/.aws in the engine's container`,
  ).toEqual(['emulator']);

  // The user id of the processes of gateway, engine and studio → none is 0.
  for (const service of FORM_SERVICES) {
    const top = await dockerRead(['top', services[service].id, '-eo', 'uid,pid,args']);
    const rows = top
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    ctx.log(`processes of ${service}: ${rows.join(' | ')}`);
    expect(rows.length, `processes of ${service}`).toBeGreaterThan(0);
    expect(
      rows.filter((row) => ['0', 'root'].includes(row.split(/\s+/)[0])),
      `processes of ${service} with user id 0`,
    ).toEqual([]);
  }
});
