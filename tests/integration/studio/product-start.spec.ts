// The start and stop checks of the one product form (issue 437, test-criteria.md): each starts its own form with
// the start line, `docker compose up -d --build`, run at the checkout's root with a PATH on which cargo, rustc, bun
// and node are not found (`support/product.ts`), observes it from the host and the check's browser, and stops it
// with the stop line. Every form has an emulator of its own; a user's emulator is one the check started outside the
// form (`OwnEmulator`), on the host.
//
// `engine.product-start-connects-to-its-own-emulator`, `engine.product-start-without-home-leaves-nothing-on-the-host`,
// `engine.product-start-has-one-unpublished-emulator`,
// `engine.product-stop-leaves-only-the-volume-and-a-users-emulator-untouched`, `engine.product-two-forms-side-by-side`,
// `engine.product-start-says-when-the-emulator-did-not-come-up`,
// `engine.product-repeated-start-with-the-variable-keeps-the-containers`.

import type { Page } from '@playwright/test';
import fs from 'node:fs';

import { directHealth, emulatorDir, expect, OwnEmulator, test } from './support';
import { bucketNames } from './support/aws-clients';
import { connectionView } from './support/home';
import { directS3, docker, runPrefix, signedVia, statusOf } from './support/product-inspect';
import {
  CHANGE_BOUND_MS,
  containerIdentity,
  dockerRead,
  entries,
  expectExit,
  firstHealth,
  Form,
  freshHome,
  identities,
  inspectContainers,
  inspectJson,
  KEEP_VARIABLE,
  madeUpKey,
  NEVER_STARTED,
  productTimeout,
  publishedBy,
  SERVICES,
  START_BOUND_MS,
  waitReachable,
  type HealthResult,
} from './support/product';

/** Health within the bound → `reachable: true`. */
async function expectReachable(form: Form, what = 'GET /__emuforge/health') {
  const result = await waitReachable(form.enginePort, true);
  expect(result, `${what} on 127.0.0.1:${String(form.enginePort)}`).toMatchObject({
    status: 200,
    body: { emulator: { reachable: true } },
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

/** The project's containers created from the run's emulator image. */
async function emulatorsOf(form: Form, image: string) {
  return (await form.containers()).filter((c) => c.image === image);
}

/** The names of the files in a host emulator's folder. */
function fileNames(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

/** `docker compose ps --format json` of the form: one object per container, whichever of the two shapes Compose prints. */
async function composePs(form: Form): Promise<{ Service?: string; State?: string; Health?: string }[]> {
  const result = await form.run(form.compose('ps', '--format', 'json'), 60_000);
  expectExit(result, 'zero');
  const text = result.stdout.trim();
  if (text.startsWith('[')) return JSON.parse(text) as { Service?: string; State?: string; Health?: string }[];
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { Service?: string; State?: string; Health?: string });
}

/** The bucket names a signed s3:ListBuckets through the form lists, with a made-up key; `null` when it is not 200. */
async function bucketsThrough(form: Form): Promise<string[] | null> {
  const answer = await signedVia(form.enginePort, madeUpKey(), 'GET', '/');
  if ('error' in answer || answer.status !== 200) return null;
  return bucketNames(answer.body.toString('utf8'));
}

/** A signed s3:CreateBucket through the form with a made-up key → 200. */
async function putBucket(form: Form, bucket: string) {
  const answer = await signedVia(form.enginePort, madeUpKey(), 'PUT', `/${bucket}`);
  expect(statusOf(answer), `PUT /${bucket} through ${form.project}`).toBe(200);
}

function shownFirst(result: HealthResult) {
  return 'error' in result ? { error: result.error } : result;
}

test('engine.product-start-connects-to-its-own-emulator', async ({ ctx, page }) => {
  test.setTimeout(productTimeout(1, 2));
  const form = await Form.create(ctx);

  // The start line → exit 0, and the first answer health gives after it returns (repeated only while the
  // connection is refused or reset) is 200, reachable, with the form's EMULATOR_PORT; no `reachable: false` is seen.
  expectExit(await form.start(), 'zero');
  const first = await firstHealth(form.enginePort);
  expect(shownFirst(first), 'the first answer of GET /__emuforge/health after the start line').toMatchObject({
    status: 200,
    body: { emulator: { reachable: true, port: form.emulatorPort } },
  });

  // Studio opened right after → the engine and the emulator connected.
  await page.goto(form.studioUrl);
  await expectBothConnected(page);

  // `docker compose ps` → four running containers, of gateway, aws-emulator, engine and studio, the emulator's
  // healthy.
  const ps = await composePs(form);
  expect(
    ps.map((c) => ({ service: c.Service, state: c.State })).sort((a, b) => String(a.service).localeCompare(String(b.service))),
    `docker compose ps of ${form.project}`,
  ).toEqual([...SERVICES].sort().map((service) => ({ service, state: 'running' })));
  expect(ps.find((c) => c.Service === 'aws-emulator')?.Health, "the emulator's health in docker compose ps").toBe(
    'healthy',
  );
});

test('engine.product-start-without-home-leaves-nothing-on-the-host', async ({ ctx }) => {
  test.setTimeout(productTimeout(2, 4));
  // Docker's own settings stay where the run has them (DOCKER_CONFIG), outside every HOME the check sets.

  // HOME an empty folder → the start line exits 0, health reachable, and after the stop line the folder holds
  // nothing at all.
  const home = freshHome(ctx);
  const withHome = await Form.create(ctx, { home });
  expect(withHome.env().DOCKER_CONFIG ?? '', 'DOCKER_CONFIG of the form').not.toContain(home);
  expectExit(await withHome.start(), 'zero');
  await expectReachable(withHome);
  expectExit(await withHome.stop(), 'zero');
  expect(entries(home), `the entries under ${home} after the stop line`).toEqual([]);

  // Neither HOME nor USERPROFILE → the start line exits 0 and health reachable; the stop line exits 0 and no
  // container of the project is left.
  const without = await Form.create(ctx, { home: null });
  const env = without.env();
  expect(['HOME', 'USERPROFILE'].filter((name) => name in env), 'HOME or USERPROFILE in the environment').toEqual([]);
  expectExit(await without.start(), 'zero');
  await expectReachable(without);
  expectExit(await without.stop(), 'zero');
  expect((await without.waitGone()).containers, `the containers left of ${without.project}`).toEqual([]);
});

test('engine.product-start-has-one-unpublished-emulator', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const form = await Form.create(ctx);
  expectExit(await form.start(), 'zero');

  // The project's containers → exactly one created from the run's emulator image, its arguments holding `-t off`
  // and `-p <EMULATOR_PORT>`.
  const emulators = await emulatorsOf(form, ctx.emulatorImage);
  expect(
    emulators.map((c) => c.name),
    `the containers of ${form.project} created from ${ctx.emulatorImage}`,
  ).toHaveLength(1);
  const emulator = emulators[0];
  const args = await inspectJson<string[]>(emulator.id, '.Args');
  const after = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : null;
  };
  expect({ t: after('-t'), p: after('-p') }, `the arguments of ${emulator.name}: ${JSON.stringify(args)}`).toEqual({
    t: 'off',
    p: String(form.emulatorPort),
  });

  // Its version → the run's pinned emulator version.
  const version = await dockerRead(['exec', emulator.id, 'aws-emulator', '--version']);
  expect(/^Version: *(.*)$/m.exec(version)?.[1]?.trim() ?? '', `aws-emulator --version in ${emulator.name}`).toBe(
    ctx.emulatorVersion,
  );

  // Inspected → no published port, the name Compose gives it, and its network the gateway's container.
  const published = await publishedBy(emulator.id);
  expect(published, `the ports ${emulator.name} publishes`).toEqual({ running: [], configured: [] });
  expect(emulator.name, "the emulator's container name").toBe(form.emulatorContainerName);
  const gateway = await form.container('gateway');
  const mode = await dockerRead(['inspect', '-f', '{{.HostConfig.NetworkMode}}', emulator.id]);
  expect([`container:${gateway.id}`, `container:${gateway.name}`], `the network mode of ${emulator.name}`).toContain(
    mode,
  );

  // The stop line → exit 0, and that container is gone.
  expectExit(await form.stop(), 'zero');
  expect(await inspectContainers([emulator.id]), `${emulator.name} after the stop line`).toEqual([]);
});

test('engine.product-stop-leaves-only-the-volume-and-a-users-emulator-untouched', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 3));
  // The user's emulator on the host, published on 127.0.0.1:<P>, its files in the run's HOME; the form's
  // EMULATOR_PORT is the same P.
  const user = await OwnEmulator.start(ctx);
  const userDir = emulatorDir(ctx.home, user.port);
  const before = { container: await containerIdentity(user.name), files: fileNames(userDir) };
  const untouched = async (when: string) => {
    expect(await containerIdentity(user.name), `${when}: the user's emulator ${user.name}`).toEqual(before.container);
    expect(await directHealth(ctx.home, user.port), `${when}: the user's emulator on ${String(user.port)}`).toEqual({
      status: 200,
      body: 'ok',
    });
    expect(fileNames(userDir), `${when}: the names of the files in ${userDir}`).toEqual(before.files);
  };
  const form = await Form.create(ctx, { emulatorPort: user.port });

  // The start line while that emulator runs → exit 0 and health reachable (nothing collides).
  expectExit(await form.start(), 'zero');
  await expectReachable(form);
  await untouched('after the start line');

  // A bucket put through the form → not listed directly on the user's emulator, with that emulator's key.
  const bucket = `${runPrefix(ctx)}-pst`;
  await putBucket(form, bucket);
  const listed = await directS3(ctx, user.port, 'GET', '/');
  expect(statusOf(listed), "s3:ListBuckets straight to the user's emulator").toBe(200);
  if (!('error' in listed)) {
    expect(bucketNames(listed.body.toString('utf8')), "the buckets the user's emulator lists").not.toContain(bucket);
  }

  // The stop line → exit 0, no container and no network of the project, one volume of the project left.
  expectExit(await form.stop(), 'zero');
  expect(await form.waitGone(), `what is left of ${form.project}`).toEqual({ containers: [], networks: [] });
  const volumes = await form.volumes();
  expect(volumes, `the volumes of ${form.project}`).toHaveLength(1);

  // The volume left, listed from a container that mounts it read-only → no regular file.
  const found = await docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--user',
    '1000:0',
    '--entrypoint',
    'find',
    '-v',
    `${volumes[0]}:/v:ro`,
    ctx.emulatorImage,
    '/v',
    '-type',
    'f',
  ]);
  expect(found.ok ? '' : found.stderr, `find /v -type f in a container that mounts ${volumes[0]} read-only`).toBe('');
  expect(found.stdout.split('\n').filter((l) => l !== ''), `the regular files in ${volumes[0]}`).toEqual([]);

  // The user's emulator after the stop → the same container, running, answering on P, the same file names.
  await untouched('after the stop line');

  // The line that removes the volume too → exit 0, and the project has no volume.
  expectExit(await form.removeVolume(), 'zero');
  expect(await form.volumes(), `the volumes of ${form.project} after docker compose down -v`).toEqual([]);
});

test('engine.product-two-forms-side-by-side', async ({ ctx }) => {
  test.setTimeout(productTimeout(2, 4));
  // Two forms on different Studio and engine ports, with the same EMULATOR_PORT.
  const first = await Form.create(ctx);
  const second = await Form.create(ctx, { emulatorPort: first.emulatorPort });
  expectExit(await first.start(), 'zero');
  await expectReachable(first, `health of ${first.project}`);
  const firstIds = identities(await first.containers());

  // The second started while the first runs → exit 0, both reachable, the first's containers unchanged.
  expectExit(await second.start(), 'zero');
  await expectReachable(second, `health of ${second.project}`);
  await expectReachable(first, `health of ${first.project}`);
  expect(identities(await first.containers()), `the containers of ${first.project}`).toEqual(firstIds);

  // Two emulator containers and two volumes, one per project.
  for (const form of [first, second]) {
    expect(
      (await emulatorsOf(form, ctx.emulatorImage)).map((c) => c.name),
      `the emulator containers of ${form.project}`,
    ).toHaveLength(1);
    expect(await form.volumes(), `the volumes of ${form.project}`).toHaveLength(1);
  }

  // A bucket put through the first → listed through the first, not through the second.
  const bucket = `${runPrefix(ctx)}-p2f`;
  await putBucket(first, bucket);
  expect(await bucketsThrough(first), `the buckets listed through ${first.project}`).toContain(bucket);
  const throughSecond = await bucketsThrough(second);
  expect(throughSecond, `the buckets listed through ${second.project}`).not.toBeNull();
  expect(throughSecond, `the buckets listed through ${second.project}`).not.toContain(bucket);

  // The second's stop line → the first reachable, its containers unchanged.
  expectExit(await second.stop(), 'zero');
  await expectReachable(first, `health of ${first.project} after the second's stop line`);
  expect(identities(await first.containers()), `the containers of ${first.project}`).toEqual(firstIds);
});

test('engine.product-start-says-when-the-emulator-did-not-come-up', async ({ ctx }) => {
  test.setTimeout(productTimeout(2, 4));

  // EMULATOR_PORT 18297, so the emulator exits at its start → exit non-zero, the output names the project's
  // aws-emulator container.
  const exits = await Form.create(ctx, { emulatorPort: 18297 });
  const failed = await exits.start();
  expectExit(failed, 'non-zero');
  expect(`${failed.stdout}\n${failed.stderr}`, 'the output of the start line').toContain(exits.emulatorContainerName);

  // `docker compose logs aws-emulator` → exit 0 and a line of the emulator that says the address is in use.
  const logs = await exits.emulatorLogs();
  expectExit(logs, 'zero');
  expect(`${logs.stdout}\n${logs.stderr}`, `the output of ${logs.line}`).toMatch(/address (already )?in use/i);

  // The engine's container → never started.
  const engines = (await exits.containers()).filter((c) => c.service === 'engine');
  expect(
    engines.filter((c) => c.startedAt !== NEVER_STARTED || c.running).map((c) => c.name),
    `the engine containers of ${exits.project} that were started`,
  ).toEqual([]);
  expectExit(await exits.removeVolume(), 'zero');

  // The emulator runs and accepts no connection on EMULATOR_PORT (product-deaf.yml) → exit non-zero within the
  // form's bound of one minute plus the start's own time, and the output names the project's aws-emulator
  // container. The start's own time is that of the start above, which the emulator ended at once; Compose polls a
  // container's health on its own interval, so ten seconds more are allowed for it to see the last result.
  const deaf = await Form.create(ctx, { files: ['deaf'] });
  const unhealthy = await deaf.start();
  expectExit(unhealthy, 'non-zero');
  expect(`${unhealthy.stdout}\n${unhealthy.stderr}`, 'the output of the start line').toContain(
    deaf.emulatorContainerName,
  );
  const bound = 60_000 + failed.ms + 10_000;
  expect(unhealthy.ms, `how long the start line took, in ms (bound ${String(bound)})`).toBeLessThanOrEqual(
    Math.min(bound, START_BOUND_MS),
  );
});

test('engine.product-repeated-start-with-the-variable-keeps-the-containers', async ({ ctx }) => {
  test.setTimeout(productTimeout(2, 2));
  // A form started with `BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose up -d --build`, and a bucket put through it.
  const form = await Form.create(ctx, { env: { [KEEP_VARIABLE]: '1' } });
  expectExit(await form.start(), 'zero');
  await expectReachable(form);
  const bucket = `${runPrefix(ctx)}-prs`;
  await putBucket(form, bucket);
  const before = identities(await form.containers());

  // The same line a second time on the unchanged checkout → exit 0, every container's id and start time as they
  // were, and the bucket still listed through the form.
  expectExit(await form.start(), 'zero');
  expect(identities(await form.containers()), `the containers of ${form.project}`).toEqual(before);
  await expectReachable(form);
  expect(await bucketsThrough(form), `the buckets listed through ${form.project}`).toContain(bucket);
});
