// The product checks that inspect a running one form (issue 437, test-criteria.md): what it publishes and where, and
// what its images, its containers' output, environment, command lines, mounts, users and capabilities hold. One
// case each, the same on every platform. Each form is started with the start line alone, without the checks' own
// files.
//
// `engine.product-ports-are-published-on-loopback-only`, `engine.product-holds-no-key-and-one-read-only-mount`.

import { EnvError, expect, probe, test } from './support';
import {
  docker,
  findSecrets,
  hostIPv4,
  probeAt,
  SAVE_BOUND_MS,
  searchImage,
  signedVia,
  statusOf,
} from './support/product-inspect';
import {
  dockerRead,
  ENGINE_FILES_DIR,
  EMULATOR_FILES_DIR,
  expectExit,
  firstHealth,
  Form,
  inspectJson,
  madeUpKey,
  productTimeout,
  publishedBy,
  STOP_BOUND_MS,
  waitReachable,
  type FormEmulatorFiles,
} from './support/product';

type Mount = { Type?: string; Name?: string; Source?: string; Destination?: string; RW?: boolean };

test('engine.product-ports-are-published-on-loopback-only', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  // The Given: a form whose EMULATOR_PORT the check found closed on the host's 127.0.0.1 before the start.
  const form = await Form.create(ctx);
  if ((await probe(form.emulatorPort)) !== 'refused') {
    throw new EnvError(`127.0.0.1:${String(form.emulatorPort)} does not refuse connections before the start`);
  }
  expectExit(await form.start(), 'zero');
  const first = await firstHealth(form.enginePort);
  expect('error' in first ? first.error : '', 'the Given: the engine answers on its published port').toBe('');

  // The project's containers' published ports → exactly two, Studio's and the engine's, both on host address
  // 127.0.0.1, both on emuforge's container, each to the same port inside (#484).
  const published: { service: string; hostIp: string; hostPort: string; containerPort: string }[] = [];
  for (const container of await form.containers()) {
    const { running } = await publishedBy(container.id);
    for (const b of running) {
      published.push({ service: container.service, hostIp: b.hostIp, hostPort: b.hostPort, containerPort: b.containerPort });
    }
  }
  ctx.log(`published: ${JSON.stringify(published)}`);
  expect(
    published.sort((a, b) => a.hostPort.localeCompare(b.hostPort)),
    `the published ports of ${form.project}`,
  ).toEqual(
    [form.studioPort, form.enginePort]
      .map(String)
      .sort()
      .map((hostPort) => ({ service: 'emuforge', hostIp: '127.0.0.1', hostPort, containerPort: `${hostPort}/tcp` })),
  );

  // The emulator's container → no published port and no host networking; emuforge's has no host networking.
  const services = await form.byService(['aws-emulator']);
  for (const [service, container] of Object.entries(services)) {
    expect(await publishedBy(container.id), `the ports ${service} publishes`).toEqual({ running: [], configured: [] });
    const mode = await dockerRead(['inspect', '-f', '{{.HostConfig.NetworkMode}}', container.id]);
    expect(mode, `the network mode of ${service}`).not.toBe('host');
  }

  // 127.0.0.1:<EMULATOR_PORT> on the host while the form runs → still refused.
  expect(await probe(form.emulatorPort), `a connection to 127.0.0.1:${String(form.emulatorPort)}`).toBe('refused');

  // The two published ports at a non-loopback address of the host → refused.
  const addresses = hostIPv4();
  if (addresses.length === 0) throw new EnvError('the host has no non-loopback IPv4 address to connect from');
  const accepted: string[] = [];
  for (const address of addresses) {
    for (const port of [form.studioPort, form.enginePort]) {
      const result = await probeAt(address, port);
      ctx.log(`a TCP connection to ${address}:${String(port)}: ${result}`);
      if (result === 'open') accepted.push(`${address}:${String(port)}`);
    }
  }
  expect(accepted, 'connections accepted at a non-loopback address').toEqual([]);

  // `docker compose logs emuforge` → the warning of --listen-address, naming 0.0.0.0 (#484 R5).
  const logs = await form.run(form.compose('logs', '--no-color', 'emuforge'), STOP_BOUND_MS);
  expect(
    `${logs.stdout}\n${logs.stderr}`
      .split('\n')
      .filter((line) => line.includes('0.0.0.0') && /not on loopback/.test(line) && line.includes('--listen-address')),
    `lines of ${logs.line} with the warning of --listen-address`,
  ).not.toEqual([]);
});

test('engine.product-holds-no-key-and-one-read-only-mount', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2) + 2 * SAVE_BOUND_MS);
  // The Given: a started form that has served a ListBuckets signed with a made-up key.
  const form = await Form.create(ctx);
  expectExit(await form.start(), 'zero');
  expect(await waitReachable(form.enginePort, true), 'the Given: GET /__emuforge/health').toMatchObject({
    status: 200,
    body: { emulator: { reachable: true } },
  });
  expect(statusOf(await signedVia(form.enginePort, madeUpKey(), 'GET', '/')), 'the Given: s3:ListBuckets').toBe(200);
  const services = await form.byService();
  const volume = (await form.volumes())[0] ?? '';
  expect(volume, `the Given: the volume of ${form.project}`).not.toBe('');

  // emuforge's mounts → one: the project's volume at /home/emuforge/.aws/emulator, read-only; a write there from
  // inside the container is refused.
  const mounts: Record<string, Mount[]> = {};
  for (const [service, container] of Object.entries(services)) {
    mounts[service] = await inspectJson<Mount[]>(container.id, '.Mounts');
  }
  ctx.log(`mounts: ${JSON.stringify(mounts)}`);
  const shown = (list: Mount[]) =>
    list.map((m) => ({ type: m.Type, name: m.Name, destination: m.Destination, rw: m.RW }));
  expect(shown(mounts.emuforge), "emuforge's mounts").toEqual([
    { type: 'volume', name: volume, destination: ENGINE_FILES_DIR, rw: false },
  ]);
  const name = `emuforge-it-write-${ctx.runId}`;
  const write = await docker(['exec', services.emuforge.id, 'touch', `${ENGINE_FILES_DIR}/${name}`]);
  ctx.log(`touch ${ENGINE_FILES_DIR}/${name} in emuforge's container: ok ${String(write.ok)} ${write.stderr}`);
  expect(write.ok, `touch ${ENGINE_FILES_DIR}/${name} in emuforge's container succeeded`).toBe(false);
  expect(write.stderr, `touch ${ENGINE_FILES_DIR}/${name}: the error`).toMatch(/read-only file system/i);

  // The emulator's mounts → one: the same volume at /home/emulator/.aws/emulator.
  expect(
    shown(mounts['aws-emulator']).map(({ type, name: n, destination }) => ({ type, name: n, destination })),
    "the emulator's mounts",
  ).toEqual([{ type: 'volume', name: volume, destination: EMULATOR_FILES_DIR }]);

  // No container of the project has a mount of type bind.
  const binds: string[] = [];
  for (const container of await form.containers()) {
    for (const m of await inspectJson<Mount[]>(container.id, '.Mounts')) {
      if (m.Type === 'bind') binds.push(`${container.name}: ${String(m.Destination)}`);
    }
  }
  expect(binds, `bind mounts in ${form.project}`).toEqual([]);

  // Every process of every container → none is uid 0; the emulator's are 1000:0 and hold no capability.
  for (const [service, container] of Object.entries(services)) {
    const top = await dockerRead(['top', container.id, '-eo', 'pid,uid,gid,args']);
    const rows = top
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        const [pid, uid, gid] = line.split(/\s+/);
        return { pid, uid, gid, row: line };
      });
    ctx.log(`processes of ${service}: ${rows.map((r) => r.row).join(' | ')}`);
    expect(rows.length, `processes of ${service}`).toBeGreaterThan(0);
    expect(
      rows.filter((r) => ['0', 'root'].includes(r.uid)).map((r) => r.row),
      `processes of ${service} with user id 0`,
    ).toEqual([]);
    if (service === 'aws-emulator') {
      expect(
        rows.filter((r) => r.uid !== '1000' || r.gid !== '0').map((r) => r.row),
        'processes of the emulator whose ids are not 1000:0',
      ).toEqual([]);
      const status = await docker(['exec', container.id, 'cat', '/proc/1/status']);
      expect(status.ok ? '' : status.stderr, "cat /proc/1/status in the emulator's container").toBe('');
      const caps = Object.fromEntries(
        [...status.stdout.matchAll(/^(Cap(?:Inh|Prm|Eff|Bnd|Amb)):\s*([0-9a-f]+)$/gm)].map((m) => [
          m[1],
          BigInt(`0x${m[2]}`),
        ]),
      );
      expect(
        Object.entries(caps)
          .filter(([, value]) => value !== 0n)
          .map(([set]) => set),
        "the emulator's capability sets that are not empty",
      ).toEqual([]);
      expect(Object.keys(caps).length, "the emulator's capability sets read").toBe(5);
    }
  }

  // The emulator's access key id and secret, read inside its container → in neither image's layers or
  // configuration, no container's environment or command line, and not in `docker compose logs`.
  const read = await form.emulatorFiles();
  expect('error' in read ? read.error : '', "the emulator's files read inside its container").toBe('');
  const files = read as FormEmulatorFiles;
  const secrets: [string, string][] = [
    ['the access key id', files.accessKeyId],
    ['the secret access key', files.secretAccessKey],
  ];
  const images = [
    ...new Set(
      await Promise.all(Object.values(services).map((c) => dockerRead(['inspect', '-f', '{{.Config.Image}}', c.id]))),
    ),
  ];
  expect(images.sort(), 'the images of the form').toEqual([ctx.productImage, ctx.emulatorImage].sort());
  for (const image of images) {
    const searched = await searchImage(ctx, image, form.env(), secrets);
    expect(searched.files, `files in the saved ${image}`).toBeGreaterThan(0);
    expect(searched.findings, `the emulator's key in the saved ${image}`).toEqual([]);
  }
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
  expect(inConfig, "the emulator's key in the containers' environment and command lines").toEqual([]);
  const logs = await form.run(form.compose('logs', '--no-color'), STOP_BOUND_MS);
  expectExit(logs, 'zero');
  expect(
    findSecrets('docker compose logs', `${logs.stdout}\n${logs.stderr}`, secrets),
    "the emulator's key in the output of the form",
  ).toEqual([]);

  // The emulator's configuration → every capability dropped and no-new-privileges.
  const capDrop = await inspectJson<string[] | null>(services['aws-emulator'].id, '.HostConfig.CapDrop');
  const securityOpt = await inspectJson<string[] | null>(services['aws-emulator'].id, '.HostConfig.SecurityOpt');
  expect(capDrop ?? [], "the emulator's dropped capabilities").toContain('ALL');
  expect(
    (securityOpt ?? []).some((o) => o === 'no-new-privileges' || o === 'no-new-privileges:true'),
    `no-new-privileges in the emulator's security options ${JSON.stringify(securityOpt)}`,
  ).toBe(true);
});
