/// <reference types="node" />
import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { readServiceFolders, SERVICES_DIR } from '../../../test/service-files';
import {
  collectScreens,
  registryFaults,
  SCREEN_FOLDERS,
  SCREENS,
  screenFolders,
  type ScreenCrumbs,
  type ServiceScreen,
} from './screens';

// The registry collected from every `services/*/screens.ts`, and its rules (issue 386, requirement R3.1 to R3.4,
// R3.6). The folders on disk are read with `node:fs`, apart from the product's collection.

/** The folders under `services/` that hold a `service.json`, as found on disk. */
const WITH_SERVICE_FILE = new Set(
  readServiceFolders()
    .filter(({ file }) => file !== undefined)
    .map(({ folder }) => folder),
);

function hasServiceFile(folder: string): boolean {
  return WITH_SERVICE_FILE.has(folder);
}

function NoPage() {
  return null;
}

/** A screen at `paths` with one crumb, its other parts the least the type asks. */
function screenAt(paths: readonly string[], crumbs: ServiceScreen['crumbs'] = [{ text: 'Things' }]): ServiceScreen {
  return {
    paths,
    title: 'Things',
    crumbs,
    navigation: { header: { text: 'Things', href: '/aws/x' }, items: [], activeHref: '/aws/x' },
    Page: NoPage,
  };
}

/** The registry's faults for one folder `folder` holding `screens`, the folder holding a `service.json`. */
function faultsOf(folder: string, ...screens: ServiceScreen[]): string[] {
  return registryFaults([{ folder, screens }], () => true);
}

describe('the registry of the AWS area', () => {
  it('the real registry: every folder with a screens.ts holds a service.json; every path is under its folder and well formed; every screen gives a crumb; no two paths match the same addresses', () => {
    expect(SCREEN_FOLDERS.length).toBeGreaterThan(0);
    expect(registryFaults(SCREEN_FOLDERS, hasServiceFile)).toEqual([]);
  });

  it('the real registry: the S3 bucket list for the folder s3, at /aws/s3 and /aws/s3/buckets, titled "Buckets" with the one crumb "Buckets"', () => {
    const buckets = SCREENS.filter(({ service }) => service === '/s3');
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      service: '/s3',
      paths: ['/aws/s3', '/aws/s3/buckets'],
      title: 'Buckets',
      crumbs: [{ text: 'Buckets' }],
    });
  });

  it('the real registry: a service folder that holds only service.json gives no screen', () => {
    const withoutScreens = [...WITH_SERVICE_FILE].filter(
      (folder) => !existsSync(path.join(SERVICES_DIR, folder, 'screens.ts')),
    );
    expect(withoutScreens.length).toBeGreaterThan(0);
    for (const folder of withoutScreens) {
      expect(SCREENS.filter(({ service }) => service === `/${folder}`)).toEqual([]);
    }
    for (const { service } of SCREENS) {
      expect(existsSync(path.join(SERVICES_DIR, service.slice(1), 'screens.ts'))).toBe(true);
    }
  });

  it('the rules: a screen of the folder sqs with a path under /aws/s3 → refused, naming the path', () => {
    const faults = faultsOf('sqs', screenAt(['/aws/s3/queues']));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('/aws/s3/queues');
  });

  it.each([
    ['an upper-case letter', '/aws/x/Things'],
    ['a brace inside a segment', '/aws/x/a{name}'],
    ['an empty segment', '/aws/x//things'],
    ['a trailing slash', '/aws/x/things/'],
    ['a ?', '/aws/x/things?all'],
    ['a #', '/aws/x/things#top'],
    ['one parameter name twice', '/aws/x/{name}/{name}'],
    ['a parameter name that starts with a digit', '/aws/x/{1name}'],
  ])('the rules: a path with %s → refused, naming the path', (_what, pattern) => {
    const faults = faultsOf('x', screenAt([pattern]));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain(pattern);
  });

  it('the rules: /aws/x/things/{name} and /aws/x/things/{id} → refused, naming both', () => {
    for (const faults of [
      faultsOf('x', screenAt(['/aws/x/things/{name}', '/aws/x/things/{id}'])),
      faultsOf('x', screenAt(['/aws/x/things/{name}']), screenAt(['/aws/x/things/{id}'])),
    ]) {
      expect(faults).toHaveLength(1);
      expect(faults[0]).toContain('/aws/x/things/{name}');
      expect(faults[0]).toContain('/aws/x/things/{id}');
    }
  });

  it('the rules: /aws/x/things/create and /aws/x/things/{name} → accepted', () => {
    expect(faultsOf('x', screenAt(['/aws/x/things/create']), screenAt(['/aws/x/things/{name}']))).toEqual([]);
    expect(faultsOf('x', screenAt(['/aws/x/things/create', '/aws/x/things/{name}']))).toEqual([]);
  });

  it.each([
    ['written', [] as unknown as ScreenCrumbs],
    ['returned by its function', (() => []) as unknown as () => ScreenCrumbs],
  ])('the rules: a screen whose crumbs, %s, are none → refused, naming the screen', (_how, crumbs) => {
    const faults = faultsOf('x', screenAt(['/aws/x/things/{name}'], crumbs));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('the screen of x at /aws/x/things/{name}');
  });

  it('the rules: crumbs given by a function, which gives at least one for sample values → accepted', () => {
    const crumbs = vi.fn((params: Readonly<Record<string, string>>) => [{ text: params.name ?? '' }] as const);
    expect(faultsOf('x', screenAt(['/aws/x/things/{name}'], crumbs))).toEqual([]);
    expect(crumbs).toHaveBeenCalledWith({ name: expect.any(String) as unknown });
  });

  it('the rules: a screens.ts in a folder without service.json → refused, naming the folder', () => {
    const faults = registryFaults([{ folder: 'nofile', screens: [screenAt(['/aws/nofile'])] }], () => false);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('nofile');
  });

  it('a service folder whose screens.ts gives an empty list → no screen; its route shows the "no screen yet" page', async () => {
    const screens = collectScreens(screenFolders({ './services/sqs/screens.ts': { SCREENS: [] } }));
    expect(screens).toEqual([]);

    vi.resetModules();
    vi.doMock('./screens', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./screens')>()),
      SCREENS: screens,
    }));
    try {
      const { areaPage } = await import('./area-page');
      for (const address of ['/aws/sqs', '/aws/sqs/queues']) {
        expect(areaPage(address)).toMatchObject({ kind: 'service', service: { route: '/sqs' } });
      }
    } finally {
      vi.doUnmock('./screens');
      vi.resetModules();
    }
  });

  it("the collection: a folder's screens carry the folder's route as their service", () => {
    const screen = screenAt(['/aws/sqs/queues']);
    expect(collectScreens(screenFolders({ './services/sqs/screens.ts': { SCREENS: [screen] } }))).toEqual([
      { ...screen, service: '/sqs' },
    ]);
  });
});
