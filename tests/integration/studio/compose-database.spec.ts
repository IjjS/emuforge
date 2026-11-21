import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import {
  CreateDBClusterCommand,
  CreateDBInstanceCommand,
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  RDSClient,
} from '@aws-sdk/client-rds';
import { expect, test, type Ctx } from './support/check';
import { leaseDatabaseRange, portNumbers } from './support/database-range';
import { answersOk, emulatorDir, readEmulatorFiles } from './support/emulator';
import { ensurePortFree, freePortExcept } from './support/net';
import {
  expectExit,
  Form,
  freshHome,
  inspectContainers,
  type ContainerState,
  madeUpKey,
  productTimeout,
  publishedBy,
  STOP_BOUND_MS,
  waitReachable,
} from './support/product';
import { hostIPv4, probeAt, runAt } from './support/product-inspect';
import { waitFor } from './support/wait';

type Range = Awaited<ReturnType<typeof leaseDatabaseRange>>;
const standaloneFile = 'infra/aws-emulator/docker-compose.yml';
const imageOverlay = 'tests/integration/studio/support/standalone-check-image.yml';

async function standaloneForm(ctx: Ctx, range: Range) {
  const home = freshHome(ctx);
  fs.mkdirSync(path.join(home, '.aws/emulator'), { recursive: true });
  const port = await freePortExcept(home, [ctx.enginePort, ctx.studioPort, ctx.emulatorPort]);
  const project = `emuforge-it-standalone-${randomBytes(12).toString('hex')}`;
  const env: Record<string, string> = {
    HOME: home,
    PATH: process.env.PATH!,
    COMPOSE_PROJECT_NAME: project,
    EMULATOR_PORT: String(port),
    EMUFORGE_EMULATOR_IMAGE: ctx.emulatorImage,
    DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? path.join(ctx.home, '.docker'),
    ...range.env,
  };
  for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT']) if (process.env[name]) env[name] = process.env[name]!;
  const compose = (...args: string[]) =>
    runAt(ctx, ctx.checkout, ['docker', 'compose', '-f', standaloneFile, '-f', imageOverlay, ...args], env, 120_000);
  fs.appendFileSync(path.join(ctx.tmp, 'product-projects'), project + '\n');
  ctx.own({
    dispose: async () => {
      expectExit(await compose('down', '-v'), 'zero');
    },
  });
  expectExit(await compose('up', '-d', '--no-build', '--pull', 'never'), 'zero');
  expect(await waitFor(30_000, async () => (await answersOk(home, port)) || undefined)).toBe(true);
  async function containers() {
    const ids = await compose('ps', '-aq');
    expectExit(ids, 'zero');
    return inspectContainers(ids.stdout.trim().split(/\s+/).filter(Boolean));
  }
  return { home, port, containers, env };
}

async function expectMappings(containers: ContainerState[], owner: string, ports: number[]) {
  const published = [];
  for (const container of containers) {
    const bindings = await publishedBy(container.id);
    for (const binding of bindings.running) published.push({ service: container.service, ...binding });
  }
  expect(published.sort((a, b) => Number(a.hostPort) - Number(b.hostPort))).toEqual(
    [...ports].sort((a, b) => a - b).map((port) => ({
      service: owner, hostIp: '127.0.0.1', hostPort: String(port), containerPort: port + '/tcp',
    })),
  );
}

function hostQuery(
  ctx: Ctx,
  adapter: string,
  port: number,
  database: string,
  password: string,
  ca: string,
): Promise<{ db?: string; marker?: number | string; code?: string; reason?: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'bun',
      [path.join(ctx.checkout, 'tests/integration/studio/support/host-sql.mjs')],
      { env: { PATH: process.env.PATH }, timeout: 15_000 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
    child.stdin!.end(JSON.stringify({ adapter, port, database, password, ca }));
  });
}

test('engine.compose-databases-answer-on-described-host-ports', async ({ ctx }) => {
  test.setTimeout(productTimeout(3, 3));
  const standRange = await leaseDatabaseRange(ctx);
  const productRange = await leaseDatabaseRange(ctx);
  const stand = await standaloneForm(ctx, standRange);
  const product = await Form.create(ctx, { developerPorts: true, env: productRange.env });
  expectExit(await product.start(), 'zero');
  expect(await waitReachable(product.enginePort, true)).toMatchObject({ body: { emulator: { reachable: true } } });
  const dir = emulatorDir(stand.home, stand.port);
  const credentials = readEmulatorFiles(dir);
  if (!credentials) throw new Error('Missing standalone emulator credentials');
  const standaloneCA = fs.readFileSync(path.join(dir, 'ca.pem'), 'utf8');
  const productFiles = await product.emulatorFiles();
  if ('error' in productFiles) throw new Error(productFiles.error);
  const productCA = productFiles.ca.toString('utf8');
  const direct = new RDSClient({
    endpoint: `https://127.0.0.1:${stand.port}`,
    region: 'us-east-1',
    credentials,
    requestHandler: {
      httpsAgent: new https.Agent({ ca: standaloneCA }),
      requestTimeout: 10_000,
    },
    maxAttempts: 1,
  });
  const engine = new RDSClient({
    endpoint: `http://127.0.0.1:${product.enginePort}`,
    region: 'us-east-1',
    credentials: madeUpKey(),
    requestHandler: { requestTimeout: 10_000 },
    maxAttempts: 1,
  });
  ctx.own({
    dispose: async () => {
      direct.destroy();
      engine.destroy();
    },
  });
  const prefix = 'db' + randomBytes(4).toString('hex');
  async function checkResource(
    client: RDSClient,
    range: Range,
    family: string,
    kind: 'instance' | 'cluster' | 'member',
    cluster?: string,
  ) {
    const id = `${prefix}-${family}-${kind}`;
    const db = family.replaceAll('-', '') + 'db';
    const password = prefix + 'DatabasePass';
    const login = { MasterUsername: 'dbadmin', MasterUserPassword: password };
    let port: number | undefined;
    if (kind === 'cluster') {
      await client.send(
        new CreateDBClusterCommand({ DBClusterIdentifier: id, Engine: family, DatabaseName: db, ...login }),
      );
      const resource = await waitFor(60_000, async () => {
        const answer = await client.send(new DescribeDBClustersCommand({ DBClusterIdentifier: id }));
        const row = answer.DBClusters?.[0];
        return row?.Status === 'available' ? row : undefined;
      });
      expect(resource?.DBClusterIdentifier).toBe(id);
      port = resource?.Port;
    } else {
      await client.send(
        new CreateDBInstanceCommand({
          DBInstanceIdentifier: id,
          Engine: family,
          DBInstanceClass: 'db.t3.micro',
          ...(cluster ? { DBClusterIdentifier: cluster } : { DBName: db, AllocatedStorage: 20, ...login }),
        }),
      );
      const resource = await waitFor(60_000, async () => {
        const answer = await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }));
        const row = answer.DBInstances?.[0];
        return row?.DBInstanceStatus === 'available' ? row : undefined;
      });
      expect(resource?.DBInstanceIdentifier).toBe(id);
      if (!cluster) {
        expect(resource?.MasterUsername).toBe(login.MasterUsername);
        expect(resource?.DBName).toBe(db);
      }
      port = resource?.Endpoint?.Port;
    }
    expect(port).toBeGreaterThanOrEqual(range.low);
    expect(port).toBeLessThanOrEqual(range.high);
    const adapter = family.includes('postgres') ? 'postgres' : 'mysql';
    // Availability and provisioning of the SQL login are observed through different protocols.
    const ca = client === engine ? productCA : standaloneCA;
    let lastCode: string | undefined;
    const answer = await waitFor(30_000, async () => {
      const result = await hostQuery(ctx, adapter, port!, db, password, ca);
      lastCode = [result.code, result.reason].filter(Boolean).join(' ');
      return result.code === undefined ? result : undefined;
    });
    expect(answer?.db, id + ' SQL query, last code ' + lastCode).toBe(db);
    expect([578, '578']).toContain(answer?.marker);
    if (client === engine) {
      const addresses = hostIPv4();
      expect(addresses.length).toBeGreaterThan(0);
      for (const host of addresses) expect(await probeAt(host, port!)).toBe('refused');
      const refused = await hostQuery(ctx, adapter, port!, db, password + 'wrong', ca);
      expect(refused.code).toBe('28P01');
    }
    return id;
  }
  for (const family of ['postgres', 'mysql', 'mariadb']) await checkResource(direct, standRange, family, 'instance');
  for (const family of ['aurora-postgresql', 'aurora-mysql']) {
    const cluster = await checkResource(direct, standRange, family, 'cluster');
    await checkResource(direct, standRange, family, 'member', cluster);
  }
  await checkResource(engine, productRange, 'postgres', 'instance');
});

test('engine.product-database-range-refuses-private-api', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const range = await leaseDatabaseRange(ctx);
  const form = await Form.create(ctx, { developerPorts: true, env: range.env, emulatorPort: range.low + 1 });
  expectExit(await form.start(), 'non-zero');
  const log = await form.run(form.compose('logs', '--no-color', 'emuforge'), STOP_BOUND_MS);
  expect(log.stdout + log.stderr).toContain(String(form.emulatorPort));
  expect(log.stdout + log.stderr).toContain(`${range.low}-${range.high}`);
  const api = await form.byService(['aws-emulator']);
  for (const service of Object.values(api)) expect(service.running).toBe(false);
  expect(await probeAt('127.0.0.1', form.emulatorPort)).toBe('refused');
});

test('engine.compose-database-range-refuses-occupied-ports', async ({ ctx }) => {
  test.setTimeout(productTimeout(2, 4));
  const range = await leaseDatabaseRange(ctx);
  const a = await Form.create(ctx, { developerPorts: true, env: range.env });
  const b = await Form.create(ctx, { developerPorts: true, env: range.env });
  expectExit(await a.start(), 'zero');
  const ports = [a.enginePort, a.studioPort, ...portNumbers(range.low, range.high)];
  await expectMappings(await a.containers(), 'emuforge', ports);
  const failed = await b.start();
  expectExit(failed, 'non-zero');
  expect(failed.stderr + failed.stdout).toMatch(
    /port is already allocated|address already in use|port is already in use/i,
  );
  expectExit(await b.removeVolume(), 'zero');
  expect(await waitReachable(a.enginePort, true)).toMatchObject({ body: { emulator: { reachable: true } } });
  await expectMappings(await a.containers(), 'emuforge', ports);
  expectExit(await a.removeVolume(), 'zero');
  for (const port of portNumbers(range.low, range.high)) await ensurePortFree(port, 10_000);
});

test('engine.compose-check-forms-omit-database-publications', async ({ ctx }) => {
  test.setTimeout(productTimeout(3, 5));
  const standRange = await leaseDatabaseRange(ctx);
  const standalone = await standaloneForm(ctx, standRange);
  const range = await leaseDatabaseRange(ctx);
  const developer = await Form.create(ctx, { developerPorts: true, env: range.env });
  expectExit(await developer.start(), 'zero');
  async function expectDeveloperMappings() {
    await expectMappings(await standalone.containers(), 'aws-emulator', [
      standalone.port, ...portNumbers(standRange.low, standRange.high),
    ]);
    await expectMappings(await developer.containers(), 'emuforge', [
      developer.enginePort, developer.studioPort, ...portNumbers(range.low, range.high),
    ]);
  }
  await expectDeveloperMappings();
  const ordinary = await Form.create(ctx);
  expectExit(await ordinary.start(), 'zero');
  const owner = (await ordinary.byService(['emuforge'])).emuforge;
  await expectMappings(await ordinary.containers(), 'emuforge', [ordinary.enginePort, ordinary.studioPort]);
  const inspect = await ordinary.run(
    ['docker', 'inspect', '--format', '{{json .HostConfig.Sysctls}}', owner.id],
    STOP_BOUND_MS,
  );
  expectExit(inspect, 'zero');
  expect(JSON.parse(inspect.stdout) ?? {}).not.toHaveProperty('net.ipv4.ip_local_port_range');
  const rangeFile = '/proc/sys/net/ipv4/ip_local_port_range';
  const baseline = await ordinary.run(
    ['docker', 'run', '--rm', '--pull', 'never', '--entrypoint', 'cat', ctx.emulatorImage, rangeFile],
    STOP_BOUND_MS,
  );
  expectExit(baseline, 'zero');
  const live = await ordinary.run(['docker', 'exec', owner.id, 'cat', rangeFile], STOP_BOUND_MS);
  expectExit(live, 'zero');
  expect(baseline.stdout.trim()).toMatch(/^\d+\s+\d+$/);
  expect(live.stdout.trim().split(/\s+/)).toEqual(baseline.stdout.trim().split(/\s+/));
  const controls = await runAt(
    ctx,
    ctx.checkout,
    [
      'docker',
      'compose',
      '-f',
      standaloneFile,
      '-f',
      imageOverlay,
      '-f',
      'tests/integration/studio/support/standalone-controls.yml',
      'config',
      '--format',
      'json',
    ],
    standalone.env,
    STOP_BOUND_MS,
  );
  expectExit(controls, 'zero');
  const service = JSON.parse(controls.stdout).services['aws-emulator'];
  expect(service.ports).toHaveLength(1);
  expect(service.ports[0]).toMatchObject({
    host_ip: '127.0.0.1',
    published: String(standalone.port),
    target: standalone.port,
  });
  expect(service.sysctls ?? {}).not.toHaveProperty('net.ipv4.ip_local_port_range');
  expectExit(await ordinary.removeVolume(), 'zero');
  await expectDeveloperMappings();
  expect(await waitReachable(developer.enginePort, true)).toMatchObject({ body: { emulator: { reachable: true } } });
  expect(await answersOk(standalone.home, standalone.port)).toBe(true);
});
