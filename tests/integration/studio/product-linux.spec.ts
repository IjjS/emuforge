// The checks of issue 54's second Compose file, `docker-compose.linux.yml`, the host form of Docker Engine on Linux
// (requirement R2, R6; design section 3). Both run on both platforms: one reads Compose's rendered configuration of
// the file beside the root file's and starts nothing; the other runs the Linux-file commands into a `HOME` whose
// `~/.aws/emulator` is missing, without the preparatory lines, and sees the start refused.
//
// `engine.product-linux-file-renders-the-host-form`,
// `engine.product-linux-start-refuses-a-missing-emulator-folder`.

import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './support';
import { runAt } from './support/product-inspect';
import {
  composeArgs,
  Form,
  LINUX_FILE,
  productTimeout,
  START_BOUND_MS,
  STOP_BOUND_MS,
  tail,
  type Platform,
  type Situation,
} from './support/product';
import { freshHome } from './support/product-wrapper';

interface Volume {
  type?: string;
  source?: string;
  target?: string;
  read_only?: boolean;
  bind?: { create_host_path?: boolean };
}

interface Service {
  [key: string]: unknown;
  network_mode?: string;
  ports?: { host_ip?: string; published?: string | number; target?: number }[];
  depends_on?: Record<string, unknown>;
  extra_hosts?: unknown;
  user?: string;
  volumes?: Volume[];
  container_name?: string;
}

interface Rendered {
  name?: string;
  services?: Record<string, Service>;
}

/** The keys of `engine` and `studio` that equal the root file's (design section 3). */
const SAME_KEYS = ['image', 'build', 'pull_policy', 'command', 'environment', 'init', 'cap_drop', 'security_opt'];

/** Two numbers of the check's own for `EMUFORGE_UID` and `EMUFORGE_GID`: different, and neither 0 nor 1000. */
const SET_IDS = { EMUFORGE_UID: '54001', EMUFORGE_GID: '54002' };

/** The entries of a map or a list that Compose rendered, `[]` when it rendered none. */
function keysOf(value: unknown): string[] {
  return value && typeof value === 'object' ? Object.keys(value) : [];
}

test('engine.product-linux-file-renders-the-host-form', async ({ ctx }) => {
  test.setTimeout(START_BOUND_MS);
  // The ports and names of a form; nothing is started, and the preparatory lines are not done.
  const form = await Form.create(ctx, { situation: 3, commands: 'linux', prepared: false });
  const unset = form.env();
  delete unset.EMUFORGE_UID;
  delete unset.EMUFORGE_GID;
  const withIds = { ...unset, ...SET_IDS };
  // Compose's own message is in the report when it cannot read the file (the failure case of every line below).
  const render = async (on: Platform, situation: Situation, env: Record<string, string>) => {
    const result = await runAt(
      ctx,
      ctx.checkout,
      composeArgs(on, situation, 'config', '--format', 'json'),
      env,
      STOP_BOUND_MS,
    );
    let rendered: Rendered | null = null;
    try {
      rendered = result.code === 0 ? (JSON.parse(result.stdout) as Rendered) : null;
    } catch {
      rendered = null;
    }
    expect(rendered, `${result.line}: the rendered configuration; output:\n${tail(result)}`).not.toBeNull();
    return rendered ?? {};
  };
  const plain = await render('linux', 3, withIds);
  const profiled = await render('linux', 4, withIds);
  const plainUnset = await render('linux', 3, unset);
  const rootPlain = await render('desktop', 3, withIds);
  const rootProfiled = await render('desktop', 4, withIds);
  const services = plain.services ?? {};
  const profiledServices = profiled.services ?? {};

  // The services → exactly `engine` and `studio` without the profile, and `aws-emulator` too with it; no gateway.
  expect(Object.keys(services).sort(), 'the services without the profile').toEqual(['engine', 'studio']);
  expect(Object.keys(profiledServices).sort(), 'the services with the profile').toEqual([
    'aws-emulator',
    'engine',
    'studio',
  ]);

  // `engine` and `studio` → `network_mode: host`, no `ports`, no `extra_hosts`; `engine` → no `depends_on`, `studio` →
  // `depends_on` on `engine` alone (decisions.md 2026-11-17 14:40); `aws-emulator` → no `network_mode`, each of its
  // `ports` entries on host address 127.0.0.1 with the published port EMULATOR_PORT.
  for (const [which, rendered] of [
    ['without the profile', services],
    ['with the profile', profiledServices],
  ] as const) {
    for (const name of ['engine', 'studio']) {
      const service = rendered[name] ?? {};
      expect(
        {
          network_mode: service.network_mode ?? null,
          ports: service.ports ?? [],
          depends_on: keysOf(service.depends_on),
          extra_hosts: keysOf(service.extra_hosts),
        },
        `${which}: ${name}`,
      ).toEqual({
        network_mode: 'host',
        ports: [],
        depends_on: name === 'studio' ? ['engine'] : [],
        extra_hosts: [],
      });
    }
  }
  const emulator = profiledServices['aws-emulator'] ?? {};
  expect(emulator.network_mode ?? null, 'the network_mode of aws-emulator').toBeNull();
  const emulatorPorts = emulator.ports ?? [];
  expect(emulatorPorts.length, 'the ports entries of aws-emulator').toBeGreaterThan(0);
  expect(
    emulatorPorts.filter((p) => p.host_ip !== '127.0.0.1' || String(p.published) !== String(form.emulatorPort)),
    `ports entries of aws-emulator not 127.0.0.1:${String(form.emulatorPort)}`,
  ).toEqual([]);

  // `user` of `engine` and `studio` → `<uid>:<gid>` with the two variables set; `1000:1000` with both unset.
  for (const name of ['engine', 'studio']) {
    expect(services[name]?.user ?? null, `the user of ${name}, EMUFORGE_UID and EMUFORGE_GID set`).toBe(
      `${SET_IDS.EMUFORGE_UID}:${SET_IDS.EMUFORGE_GID}`,
    );
    expect(plainUnset.services?.[name]?.user ?? null, `the user of ${name}, both unset`).toBe('1000:1000');
  }

  // `engine` and `studio` against the root file's service of the same name → the keys of design section 3 are
  // equal; `aws-emulator`, with the profile, equals the root file's in every key but `volumes`.
  for (const name of ['engine', 'studio']) {
    const pick = (service: Service | undefined) =>
      Object.fromEntries(SAME_KEYS.map((key) => [key, service?.[key] ?? null]));
    expect(pick(services[name]), `${name} against the root file's ${name}`).toEqual(
      pick(rootPlain.services?.[name]),
    );
  }
  const rootEmulator = rootProfiled.services?.['aws-emulator'] ?? {};
  const withoutVolumes = (service: Service) => Object.fromEntries(Object.entries(service).filter(([k]) => k !== 'volumes'));
  expect(withoutVolumes(emulator), "aws-emulator against the root file's, but volumes").toEqual(
    withoutVolumes(rootEmulator),
  );

  // The volumes → `engine` has one, a read-only bind of $HOME/.aws/emulator to /home/emuforge/.aws/emulator with
  // `create_host_path: false`; `studio` none; `aws-emulator` one, a bind of $HOME/.aws/emulator to the root file's
  // target with `create_host_path: false`.
  const hostDir = path.join(form.home, '.aws', 'emulator');
  const shown = (v: Volume) => ({
    type: v.type,
    source: v.source,
    target: v.target,
    read_only: v.read_only === true,
    create_host_path: v.bind?.create_host_path ?? null,
  });
  expect((services.engine?.volumes ?? []).map(shown), "the engine's volumes").toEqual([
    {
      type: 'bind',
      source: hostDir,
      target: '/home/emuforge/.aws/emulator',
      read_only: true,
      create_host_path: false,
    },
  ]);
  expect(services.studio?.volumes ?? [], "Studio's volumes").toEqual([]);
  const rootTarget = (rootEmulator.volumes ?? []).find((v) => v.source === hostDir)?.target ?? null;
  expect(rootTarget, `the root file's aws-emulator bind of ${hostDir}`).not.toBeNull();
  expect(
    (emulator.volumes ?? []).map((v) => {
      const { read_only: _readOnly, ...rest } = shown(v);
      return rest;
    }),
    "aws-emulator's volumes",
  ).toEqual([{ type: 'bind', source: hostDir, target: rootTarget, create_host_path: false }]);

  // The project name and the emulator's container name → those of the root file for the same ports.
  expect(
    { project: profiled.name ?? null, emulator: emulator.container_name ?? null },
    'the project name and the emulator container name',
  ).toEqual({ project: rootProfiled.name ?? null, emulator: rootEmulator.container_name ?? null });

  // The text of the file → neither `host.docker.internal` nor `extra_hosts`.
  const file = path.join(ctx.checkout, LINUX_FILE);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  expect(
    ['host.docker.internal', 'extra_hosts'].filter((word) => text.includes(word)),
    `words of ${LINUX_FILE}`,
  ).toEqual([]);
});

test('engine.product-linux-start-refuses-a-missing-emulator-folder', async ({ ctx }) => {
  test.setTimeout(productTimeout(2, 4));
  for (const situation of [3, 4] as const) {
    // A new, empty HOME, free ports, the Linux-file commands; the preparatory lines are not done.
    const home = freshHome(ctx);
    const form = await Form.create(ctx, { situation, home, commands: 'linux', prepared: false });
    const what = `situation ${String(situation)}`;
    const folder = path.join(home, '.aws', 'emulator');

    // The Linux-file start command → exits non-zero, and its output holds <HOME>/.aws/emulator (R6).
    const started = await form.start();
    expect(started.code, `${what}: ${started.line}: exit code; output:\n${tail(started)}`).not.toBe(0);
    expect(
      `${started.stdout}\n${started.stderr}`.includes(folder),
      `${what}: the output of ${started.line} holds ${folder}; output:\n${tail(started)}`,
    ).toBe(true);

    // No container of the form exists, running or not, and HOME has no `.aws` (R6).
    expect(
      (await form.containers()).map((c) => c.name),
      `${what}: containers of ${form.project}`,
    ).toEqual([]);
    expect(fs.existsSync(path.join(home, '.aws')), `${what}: ${path.join(home, '.aws')} exists`).toBe(false);

    // The Linux-file stop command → exits 0; no container and no network of the form is left (#34 R7a).
    const stopped = await form.stop();
    expect(stopped.code, `${what}: ${stopped.line}: exit code; output:\n${tail(stopped)}`).toBe(0);
    expect(await form.waitGone(), `${what}: what is left of ${form.project}`).toEqual({
      containers: [],
      networks: [],
    });
  }
});
