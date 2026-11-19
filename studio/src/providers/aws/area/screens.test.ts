/// <reference types="node" />
import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { readServiceFolders, SERVICES_DIR } from '../../../test/service-files';
import { SERVICES } from '../services';
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
    // Found by its paths among the folder's screens, which issue 256 makes more than one.
    const list = SCREENS.find(
      ({ service, paths }) => service === '/s3' && paths.includes('/aws/s3') && paths.includes('/aws/s3/buckets'),
    );
    expect(list).toMatchObject({
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
    // Issue 480: a function is given the address's query too, none for the rules' sample values.
    expect(crumbs).toHaveBeenCalledWith({ name: expect.any(String) as unknown }, new URLSearchParams());
  });

  it('the rules: a screens.ts in a folder without service.json → refused, naming the folder', () => {
    const faults = registryFaults([{ folder: 'nofile', screens: [screenAt(['/aws/nofile'])] }], () => false);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('nofile');
  });

  it('the rules: a folder whose screens.ts registers no screen → refused, naming the folder (issue 494)', () => {
    const faults = registryFaults([{ folder: 'empty', screens: [] }], () => true);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatch(/^empty: /);
  });

  it('the real build: the services marked as having a screen are exactly the services the registry holds a screen of (issue 494)', () => {
    const marked = SERVICES.filter(({ hasScreen }) => hasScreen).map(({ route }) => route);
    const registered = SERVICES.filter(({ route }) => SCREENS.some(({ service }) => service === route)).map(
      ({ route }) => route,
    );
    expect(marked.length).toBeGreaterThan(0);
    expect(marked).toEqual(registered);
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

  // Issue 57 (requirement R4.11): the patterns of paths a screen leads to.
  it('the rules: a screen that leads to /aws/x/thing/{name}/property, its first path /aws/x/things/{name} → accepted', () => {
    expect(faultsOf('x', { ...screenAt(['/aws/x/things/{name}']), leadsTo: ['/aws/x/thing/{name}/property'] })).toEqual(
      [],
    );
  });

  it.each([
    ['not well formed', '/aws/x/thing/{name}/Property'],
    ["under another service's route", '/aws/y/thing/{name}/property'],
    ["naming a parameter the screen's first path does not have", '/aws/x/thing/{name}/{tab}'],
    ['lacking a parameter the first path has', '/aws/x/thing/property'],
  ])('the rules: a leadsTo pattern %s → refused, naming the pattern', (_what, pattern) => {
    const faults = faultsOf('x', { ...screenAt(['/aws/x/things/{name}']), leadsTo: [pattern] });
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain(pattern);
  });

  // Issue 480: the bucket page's paths are the Objects tab (its bare route and /objects) and /properties; it still leads
  // to /aws/s3/bucket/{name}/property alone.
  it("the real registry: S3's bucket page leads to /aws/s3/bucket/{name}/property; no other screen of S3, Lambda or IAM leads anywhere; the registry has no fault", () => {
    const leading = SCREENS.filter((screen) => screen.leadsTo !== undefined && screen.leadsTo.length > 0);
    expect(leading.map(({ service, paths, leadsTo }) => ({ service, first: paths[0], leadsTo }))).toEqual([
      { service: '/s3', first: '/aws/s3/buckets/{name}', leadsTo: ['/aws/s3/bucket/{name}/property'] },
    ]);
    expect(SCREENS.find((screen) => screen.paths[0] === '/aws/s3/buckets/{name}')?.paths).toEqual([
      '/aws/s3/buckets/{name}',
      '/aws/s3/buckets/{name}/objects',
      '/aws/s3/buckets/{name}/properties',
    ]);
    for (const service of ['/s3', '/lambda', '/iam']) {
      expect(SCREENS.some((screen) => screen.service === service)).toBe(true);
    }
    expect(registryFaults(SCREEN_FOLDERS, hasServiceFile)).toEqual([]);
  });

  it("the collection: a folder's screens carry the folder's route as their service", () => {
    const screen = screenAt(['/aws/sqs/queues']);
    expect(collectScreens(screenFolders({ './services/sqs/screens.ts': { SCREENS: [screen] } }))).toEqual([
      { ...screen, service: '/sqs' },
    ]);
  });
});
