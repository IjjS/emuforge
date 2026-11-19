/// <reference types="node" />
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeEngine } from '../test/home-test-kit';
import { NO_SCREEN_SERVICE } from '../test/no-screen';
import { serviceLinks, SERVICES_DIR } from '../test/service-files';
import { Providers } from './providers';
import { routes } from './routes';

const AWS = 'Amazon Web Services';
const NO_SCREEN = NO_SCREEN_SERVICE.label;
/** A path two segments below the route of the service without a screen. */
const BELOW = `${NO_SCREEN_SERVICE.below}/my-stream`;

// The services as their folders give them (providers/aws/area/services/*/service.json), in the order of issue 386's
// requirement R13.2, each under /aws.
const SERVICES = serviceLinks();

/** Whether the folder of the service at `servicePath` (`/aws/<folder>`) holds a `screens.ts`. */
function hasScreensFile(servicePath: string): boolean {
  return existsSync(join(SERVICES_DIR, servicePath.replace(/^\/aws\//, ''), 'screens.ts'));
}

/**
 * The services whose route has a screen of its own: Amazon S3 (issue 56), AWS Identity and Access Management
 * (issue 82), AWS Lambda, whose route is the function list (issue 84), and Amazon SQS, whose route is the queue list
 * (issue 481), and Amazon DynamoDB, whose route is the table list (issue 496).
 */
const WITH_SCREEN: readonly string[] = [
  'Amazon Simple Storage Service',
  'AWS Identity and Access Management',
  'AWS Lambda',
  'Amazon Simple Queue Service',
  'Amazon DynamoDB',
];

/** Every other service. */
const WITHOUT_SCREEN = SERVICES.filter(([label]) => !WITH_SCREEN.includes(label));

/** The AWS area's first import is real work (Cloudscape's modules), not a timer; a cold run takes a while. */
const AREA_LOAD_MS = 10_000;

/**
 * The test timeout of a case that waits for the "no screen yet" page for a part of a service: above `AREA_LOAD_MS`, so
 * that the page's find reports what is missing before the test is ended.
 */
const NO_SCREEN_PART_TEST_MS = AREA_LOAD_MS + 5_000;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new TypeError('no network in this test')));
  vi.stubGlobal('fetch', fetchSpy);
  // The AWS area follows the operating system's scheme, which jsdom does not report: light here.
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
}

/** True when the element, or an element around it, carries a Cloudscape class: it is inside the AWS area. */
function inCloudscape(element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if ([...at.classList].some((name) => name.startsWith('awsui'))) {
      return true;
    }
  }
  return false;
}

function cloudscapeElements(): Element[] {
  return [...document.querySelectorAll('*')].filter((element) =>
    [...element.classList].some((name) => name.startsWith('awsui')),
  );
}

/** The page's `h1`, once the page (the AWS area loads on first opening) is there. */
async function heading(name: string): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name }, { timeout: AREA_LOAD_MS });
}

function main(): HTMLElement {
  return screen.getByRole('main');
}

/**
 * The "no screen yet" page for a part of a service that has screens (issue 57, requirement R4): the `h1` "No screen
 * yet" inside the AWS area, the statement for that part of `label` and not the sentence that the service has no
 * screen, the path as it was opened, and the document title "No screen yet | EmuForge Studio".
 */
async function expectNoScreenPart(label: string, path: string) {
  const h1 = await heading('No screen yet');
  expect(inCloudscape(h1)).toBe(true);
  expect(main()).toHaveTextContent(`Studio has no screen for this part of ${label} yet.`);
  expect(main()).not.toHaveTextContent(`Studio has no screen for ${label} yet.`);
  expect(main()).toHaveTextContent(path);
  await waitFor(() => {
    expect(document.title).toBe('No screen yet | EmuForge Studio');
  });
}

async function expectNoScreenYet(label: string) {
  const h1 = await heading(label);
  expect(inCloudscape(h1)).toBe(true);
  expect(main()).toHaveTextContent(`Studio has no screen for ${label} yet.`);
  expect(within(main()).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
}

/**
 * An engine for the role page's cases: the area's own requests answered by the home kit's fake engine, and IAM's
 * Query requests answered as an emulator that holds the roles `roles`. Returns the IAM requests, `<Action> <RoleName>`,
 * and the kit's engine.
 */
function stubRoleEngine(roles: readonly string[]): { sent: string[]; engine: FakeEngine } {
  const engine = new FakeEngine();
  const sent: string[] = [];
  const xml = (action: string, result: string) =>
    new Response(
      `<${action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><${action}Result>${result}</${action}Result></${action}Response>`,
      { status: 200, headers: { 'content-type': 'text/xml' } },
    );
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url, window.location.href);
    if (!url.origin.startsWith('http://127.0.0.1:') || url.pathname !== '/' || request.method !== 'POST') {
      return engine.fetch(request.url, { headers: request.headers, signal: request.signal, method: request.method });
    }
    const params = new URLSearchParams(await request.text());
    const action = params.get('Action') ?? '';
    const name = params.get('RoleName') ?? '';
    sent.push(`${action} ${name}`);
    if (!roles.includes(name)) {
      return new Response(
        `<ErrorResponse><Error><Type>Sender</Type><Code>NoSuchEntity</Code><Message>no role</Message></Error></ErrorResponse>`,
        { status: 404, headers: { 'content-type': 'text/xml' } },
      );
    }
    switch (action) {
      case 'GetRole':
        return xml(
          action,
          `<Role><Path>/</Path><RoleName>${name.replace(/&/g, '&amp;')}</RoleName><RoleId>AROA1</RoleId><Arn>arn:aws:iam::000000000000:role/${name.replace(/&/g, '&amp;')}</Arn><CreateDate>2026-11-17T09:05:03Z</CreateDate><MaxSessionDuration>3600</MaxSessionDuration><RoleLastUsed/></Role>`,
        );
      case 'ListAttachedRolePolicies':
        return xml(action, '<AttachedPolicies/><IsTruncated>false</IsTruncated>');
      default:
        return xml(action, '<PolicyNames/><IsTruncated>false</IsTruncated>');
    }
  });
  return { sent, engine };
}

/** The crumbs' texts, in order. */
function crumbTexts(): string[] {
  const group = createWrapper(document.body).findBreadcrumbGroup();
  return (group?.findBreadcrumbLinks() ?? []).map((crumb) => (crumb.getElement().textContent ?? '').trim());
}

describe('routes', () => {
  it('opens Home at /', () => {
    open('/');

    expect(within(main()).getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });

  it('opens /connections as Studio’s own page "Connections" in the frame: its h1 names the main, the document title is made from it (issue 486, R1)', async () => {
    document.title = 'not set by Studio';
    open('/connections');

    const h1 = within(main()).getByRole('heading', { level: 1, name: 'Connections' });
    expect(main()).toHaveAttribute('aria-labelledby', h1.id);
    expect(main()).toHaveClass('st-main');
    expect(inCloudscape(h1)).toBe(false);
    expect(cloudscapeElements()).toEqual([]);
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Connections' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await waitFor(() => {
      expect(document.title).toBe('Connections | EmuForge Studio');
    });
  });

  it('opens /aws as the AWS area index: "Services" (the number of services), the sentence for the registry as it is, and the services grouped by whether their folder holds a screens.ts, each group in label order (regression, issue 61)', async () => {
    open('/aws');

    expect(inCloudscape(await heading(AWS))).toBe(true);
    const container = createWrapper(main()).findContainer();
    expect(container).not.toBeNull();
    const header = container?.findHeader()?.getElement();
    expect(header).toHaveTextContent('Services');
    expect(header).toHaveTextContent(`(${String(SERVICES.length)})`);
    // The folders that hold a screens.ts are the registry's (screens.test.ts holds the two readings equal).
    const withScreen = SERVICES.filter(([, href]) => hasScreensFile(href));
    const without = SERVICES.filter(([, href]) => !hasScreensFile(href));
    expect(withScreen.length).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(0);
    const count = String(SERVICES.length);
    expect(header).toHaveTextContent(
      withScreen.length === 1
        ? `1 of ${count} services has a Studio screen.`
        : `${String(withScreen.length)} of ${count} services have a Studio screen.`,
    );
    expect(header).not.toHaveTextContent('No service has a Studio screen yet.');
    const content = container?.findContent().getElement() as HTMLElement;
    const linksIn = (name: string) =>
      within(within(content).getByRole('region', { name }))
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(linksIn(`With a Studio screen (${String(withScreen.length)})`)).toEqual(withScreen);
    expect(linksIn(`No Studio screen yet (${String(without.length)})`)).toEqual(without);
    expect(within(content).getAllByRole('link')).toHaveLength(SERVICES.length);
  });

  it(`opens ${NO_SCREEN_SERVICE.path} as the "no screen yet" page of ${NO_SCREEN}, asking the engine only for its connection status`, async () => {
    const engine = new FakeEngine();
    vi.stubGlobal('fetch', engine.fetch);
    open(NO_SCREEN_SERVICE.path);

    await expectNoScreenYet(NO_SCREEN);
    // The area asks when it opens (requirement R4.4); the page is shown by now.
    await waitFor(
      () => {
        expect(engine.healths.length).toBeGreaterThan(0);
      },
      { timeout: 2_000 },
    );
    const otherEngineCalls = engine.requests
      .filter((request) => request.origin.startsWith('http://127.0.0.1:'))
      .filter((request) => request.path !== '/__emuforge/session' && request.path !== '/__emuforge/health')
      .map((request) => request.url);
    expect(otherEngineCalls).toEqual([]);
  });

  it(`opens a path below a service, ${BELOW}, as the same "no screen yet" page`, async () => {
    open(BELOW);

    await expectNoScreenYet(NO_SCREEN);
  });

  it.each(WITHOUT_SCREEN)('opens the route of %s, %s, as its "no screen yet" page', async (label, path) => {
    open(path);

    await expectNoScreenYet(label);
  });

  it.each([
    ['/aws/iam', 'Roles'],
    ['/aws/iam/roles', 'Roles'],
    ['/aws/iam/roles/create', 'Select trusted entity'],
    ['/aws/iam/roles/details/abc', 'abc'],
  ])('opens %s as its IAM screen (its h1 "%s"), not the "no screen yet" page', async (path, title) => {
    stubRoleEngine(['abc']);
    open(path);

    expect(inCloudscape(await heading(title))).toBe(true);
    expect(main()).not.toHaveTextContent('Studio has no screen for AWS Identity and Access Management yet.');
  });

  it('leaves AWS Identity and Access Management out of the services opened as a "no screen yet" page, and keeps every other', () => {
    expect(WITHOUT_SCREEN.map(([label]) => label)).not.toContain('AWS Identity and Access Management');
    expect(WITHOUT_SCREEN).toHaveLength(SERVICES.length - WITH_SCREEN.length);
  });

  // Issue 57 (test-criteria.md, "Unit — app/routes.test.tsx", rewritten): a path below a service that has screens,
  // which no screen matches, shows the "no screen yet" page for that part of the service.
  // Bound: waits up to AREA_LOAD_MS (10 s) for the h1, so the find reports what is missing before the case ends (issue 57 t1, 9249783).
  it.each(['/aws/iam/policies', '/aws/iam/roles/details/abc/tags'])(
    'opens %s as the "no screen yet" page for that part of AWS Identity and Access Management',
    async (path) => {
      open(path);

      await expectNoScreenPart('AWS Identity and Access Management', path);
    },
    NO_SCREEN_PART_TEST_MS,
  );

  it('opens /aws/iam/roles/details/create as the page of a role named create, not the wizard', async () => {
    const { sent } = stubRoleEngine(['create']);
    open('/aws/iam/roles/details/create');

    expect(inCloudscape(await heading('create'))).toBe(true);
    await waitFor(() => {
      expect(within(main()).getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
    });
    expect(sent).toContain('GetRole create');
  });

  it('opens /aws/iam/roles/details/a%2Bb%3Dc as the page of the role a+b=c: its h1 and last crumb, and the role read', async () => {
    const { sent } = stubRoleEngine(['a+b=c']);
    open('/aws/iam/roles/details/a%2Bb%3Dc');

    expect(inCloudscape(await heading('a+b=c'))).toBe(true);
    await waitFor(() => {
      expect(within(main()).getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
    });
    expect(crumbTexts().at(-1)).toBe('a+b=c');
    expect(sent.filter((request) => request.startsWith('GetRole '))).toEqual(['GetRole a+b=c']);
  });

  it('opens /aws/iam/roles/details/%E0%A4%A, a segment that is not valid percent-encoding, as the area’s "Page not found", with no request for a role', async () => {
    const { sent, engine } = stubRoleEngine([]);
    open('/aws/iam/roles/details/%E0%A4%A');

    expect(inCloudscape(await heading('Page not found'))).toBe(true);
    expect(main()).toHaveTextContent('/aws/iam/roles/details/%E0%A4%A');
    // The area has asked for its connection, and still nothing for a role.
    await waitFor(
      () => {
        expect(engine.healths.length).toBeGreaterThan(0);
      },
      { timeout: 2_000 },
    );
    expect(sent).toEqual([]);
  });

  it.each(['/aws/s3', '/aws/s3/buckets'])(
    'opens %s as the S3 bucket list: the h1 "Buckets", the address unchanged, the title "Buckets | EmuForge Studio"',
    async (path) => {
      const router = createMemoryRouter(routes, { initialEntries: [path] });
      render(
        <Providers>
          <RouterProvider router={router} />
        </Providers>,
      );

      expect(inCloudscape(await heading('Buckets'))).toBe(true);
      expect(router.state.location.pathname).toBe(path);
      await waitFor(() => {
        expect(document.title).toBe('Buckets | EmuForge Studio');
      });
    },
  );

  // Issue 256, test-criteria.md, "Unit — app/routes.test.tsx", case 1: a bucket's page at its two routes.
  it.each(['/aws/s3/buckets/my-bucket', '/aws/s3/buckets/my-bucket/objects', '/aws/s3/buckets/my-bucket/properties'])(
    'opens %s as the page of the bucket my-bucket: its h1, the crumbs to it, S3’s navigation, the address unchanged',
    async (path) => {
      const router = createMemoryRouter(routes, { initialEntries: [path] });
      render(
        <Providers>
          <RouterProvider router={router} />
        </Providers>,
      );

      expect(inCloudscape(await heading('my-bucket'))).toBe(true);
      const wrapper = createWrapper(document.body);
      const crumbs = (wrapper.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map(
        (item) => item.getElement().textContent,
      );
      expect(crumbs).toEqual(['EmuForge', 'AWS', 'S3', 'Buckets', 'my-bucket']);
      const navigation = wrapper.findSideNavigation();
      expect(navigation?.findHeaderLink()?.getElement()).toHaveTextContent('Amazon S3');
      expect(navigation?.findActiveLink()?.getElement()).toHaveTextContent('General purpose buckets');
      expect(router.state.location.pathname).toBe(path);
    },
  );

  // Issue 480: the tab "Objects" at a folder: the crumbs go on with each part of `?prefix=`, each but the last a link to
  // the tab at its own prefix; the h1 and the title stay the bucket's name.
  it('opens /aws/s3/buckets/my-bucket?prefix=logs%2F2026%2F with the crumbs …, Buckets, my-bucket, logs, then 2026', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/aws/s3/buckets/my-bucket?prefix=logs%2F2026%2F'] });
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );

    expect(inCloudscape(await heading('my-bucket'))).toBe(true);
    const crumbs = (createWrapper(document.body).findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((item) => {
      const element = item.getElement();
      const link = element.closest('a[href]') ?? element.querySelector('a[href]');
      return [(element.textContent ?? '').trim(), link?.getAttribute('href') ?? null];
    });
    expect(crumbs.slice(3)).toEqual([
      ['Buckets', '/aws/s3/buckets'],
      ['my-bucket', '/aws/s3/buckets/my-bucket'],
      ['logs', '/aws/s3/buckets/my-bucket?prefix=logs%2F'],
      ['2026', null],
    ]);
    await waitFor(() => {
      expect(document.title).toBe('my-bucket | EmuForge Studio');
    });
  });

  // Issue 256, test-criteria.md, "Unit — app/routes.test.tsx", case 2: the create form at its route.
  it('opens /aws/s3/bucket/create as the create form: its h1 and the crumbs to it', async () => {
    const path = '/aws/s3/bucket/create';
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );

    expect(inCloudscape(await heading('Create bucket'))).toBe(true);
    const crumbs = (createWrapper(document.body).findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map(
      (item) => item.getElement().textContent,
    );
    expect(crumbs).toEqual(['EmuForge', 'AWS', 'S3', 'Buckets', 'Create bucket']);
    expect(router.state.location.pathname).toBe(path);
  });

  // Issue 256, test-criteria.md, "Unit — app/routes.test.tsx", case 3: the empty page and the delete page.
  it.each([
    ['/aws/s3/bucket/my-bucket/empty', 'Empty bucket'],
    ['/aws/s3/bucket/my-bucket/delete', 'Delete bucket'],
  ])(
    'opens %s with the h1 "%s" and the crumbs …, Buckets, my-bucket (to the bucket’s page), then the page’s name',
    async (path, title) => {
      const router = createMemoryRouter(routes, { initialEntries: [path] });
      render(
        <Providers>
          <RouterProvider router={router} />
        </Providers>,
      );

      expect(inCloudscape(await heading(title))).toBe(true);
      expect(crumbTexts()).toEqual(['EmuForge', 'AWS', 'S3', 'Buckets', 'my-bucket', title]);
      const bucketCrumb = (createWrapper(document.body).findBreadcrumbGroup()?.findBreadcrumbLinks() ?? [])
        .map((item) => item.getElement())
        .find((element) => element.textContent === 'my-bucket')
        ?.closest('a');
      expect(bucketCrumb).toHaveAttribute('href', '/aws/s3/buckets/my-bucket');
      expect(router.state.location.pathname).toBe(path);
    },
  );

  // Issue 256, test-criteria.md, "Unit — app/routes.test.tsx", case 4: a bucket named `create`.
  it.each([
    ['/aws/s3/buckets/create', 'create', ['EmuForge', 'AWS', 'S3', 'Buckets', 'create']],
    ['/aws/s3/bucket/create/empty', 'Empty bucket', ['EmuForge', 'AWS', 'S3', 'Buckets', 'create', 'Empty bucket']],
  ])('opens %s as a screen of the bucket named create: the h1 "%s"', async (path, title, crumbs) => {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );

    expect(inCloudscape(await heading(title))).toBe(true);
    expect(crumbTexts()).toEqual(crumbs);
    expect(router.state.location.pathname).toBe(path);
  });

  /** The four screens of a bucket, at each of their routes, with their h1, document title and notice word. */
  const BUCKET_SCREENS: [path: string, h1: string, title: string, word: string][] = [
    ['/aws/s3/buckets/my-bucket', 'my-bucket', 'my-bucket | EmuForge Studio', 'objects'],
    ['/aws/s3/buckets/my-bucket/objects', 'my-bucket', 'my-bucket | EmuForge Studio', 'objects'],
    ['/aws/s3/buckets/my-bucket/properties', 'my-bucket', 'my-bucket | EmuForge Studio', 'buckets'],
    ['/aws/s3/bucket/create', 'Create bucket', 'Create bucket | EmuForge Studio', 'buckets'],
    ['/aws/s3/bucket/my-bucket/empty', 'Empty bucket', 'Empty bucket | EmuForge Studio', 'buckets'],
    ['/aws/s3/bucket/my-bucket/delete', 'Delete bucket', 'Delete bucket | EmuForge Studio', 'buckets'],
  ];

  // Issue 256, test-criteria.md, "Unit — app/routes.test.tsx", case 6: the notice, the (i) control, the navigation;
  // issue 480: the tab "Objects" names its resources "objects".
  it.each(BUCKET_SCREENS)(
    'opens %s with the notice, the (i) control, and S3’s navigation with "General purpose buckets" current',
    async (path, h1, _title, word) => {
      open(path);

      await heading(h1);
      expect(within(main()).getByText(`These ${word} are in your local emulator`)).toBeInTheDocument();
      expect(within(main()).getByRole('button', { name: 'About the local emulator' })).toBeInTheDocument();
      const navigation = createWrapper(document.body).findSideNavigation();
      expect(navigation?.findHeaderLink()?.getElement()).toHaveTextContent('Amazon S3');
      expect(navigation?.findActiveLink()?.getElement()).toHaveTextContent('General purpose buckets');
    },
  );

  // Issue 256, test-criteria.md, "Unit — app/routes.test.tsx", case 7: the document titles.
  it.each(BUCKET_SCREENS)('opens %s with the h1 "%s" and the document title "%s"', async (path, h1, title) => {
    open(path);

    await heading(h1);
    await waitFor(() => {
      expect(document.title).toBe(title);
    });
  });

  // Issue 256, test-criteria.md, "Unit — app/routes.test.tsx", case 8: none of the four gives help.
  it.each(BUCKET_SCREENS)('opens %s without the help toggle', async (path, h1) => {
    open(path);

    await heading(h1);
    expect(createWrapper(document.body).findAppLayout()?.findToolsToggle()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open help panel' })).toBeNull();
  });

  it.each(['/aws/lambda', '/aws/lambda/functions'])(
    'opens %s as the Lambda function list: the h1 "Event Functions", the address unchanged',
    async (path) => {
      const router = createMemoryRouter(routes, { initialEntries: [path] });
      render(
        <Providers>
          <RouterProvider router={router} />
        </Providers>,
      );

      expect(inCloudscape(await heading('Event Functions'))).toBe(true);
      expect(router.state.location.pathname).toBe(path);
    },
  );

  it('opens /aws/lambda/functions/create as "Create Event Function", and /aws/lambda/functions/function/create as the page of a function named create', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/aws/lambda/functions/create'] });
    const rendered = render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );

    expect(inCloudscape(await heading('Create Event Function'))).toBe(true);
    expect(router.state.location.pathname).toBe('/aws/lambda/functions/create');
    await waitFor(() => {
      expect(document.title).toBe('Create Event Function | EmuForge Studio');
    });
    rendered.unmount();

    open('/aws/lambda/functions/function/create');

    expect(inCloudscape(await heading('create'))).toBe(true);
    expect(screen.queryByRole('heading', { level: 1, name: 'Create Event Function' })).toBeNull();
  });

  // Issue 57 (test-criteria.md, "Unit — app/routes.test.tsx", rewritten).
  // Bound: waits up to AREA_LOAD_MS (10 s) for the h1, so the find reports what is missing before the case ends (issue 57 t1, 9249783).
  it.each(['/aws/lambda/functions/function/orders/test', '/aws/lambda/layers'])(
    'opens %s as the "no screen yet" page for that part of AWS Lambda',
    async (path) => {
      open(path);

      await expectNoScreenPart('AWS Lambda', path);
    },
    NO_SCREEN_PART_TEST_MS,
  );

  // Issue 256 gives /aws/s3/buckets/my-bucket and /aws/s3/bucket/create their screens; these three paths have none
  // before or after (issue 480: `/metrics` in place of `/objects`, which is now the tab "Objects"). Issue 57 (test-criteria.md, "Unit — app/routes.test.tsx", rewritten): the page for that part of
  // the service, and no request for an AWS operation.
  // Bound: waits up to AREA_LOAD_MS (10 s) for the h1, so the find reports what is missing before the case ends (issue 57 t1, 9249783).
  it.each([
    '/aws/s3/buckets/my-bucket/metrics',
    '/aws/s3/bucket/my-bucket/property/versioning/edit',
    '/aws/s3/directory-buckets',
  ])(
    'opens %s as the "no screen yet" page for that part of Amazon Simple Storage Service, with no request for an AWS operation',
    async (path) => {
      const engine = new FakeEngine();
      vi.stubGlobal('fetch', engine.fetch);
      open(path);

      await expectNoScreenPart('Amazon Simple Storage Service', path);
      await waitFor(
        () => {
          expect(engine.healths.length).toBeGreaterThan(0);
        },
        { timeout: 2_000 },
      );
      const lists = engine.requests.filter((request) => {
        const url = new URL(request.url, window.location.href);
        return url.origin.startsWith('http://127.0.0.1:') && url.searchParams.get('x-id') === 'ListBuckets';
      });
      expect(lists).toEqual([]);
      expect(engine.to('/')).toEqual([]);
      const awsRequests = engine.requests
        .filter((request) => request.origin.startsWith('http://127.0.0.1:'))
        .filter((request) => request.path !== '/__emuforge/session' && request.path !== '/__emuforge/health')
        .map((request) => request.url);
      expect(awsRequests).toEqual([]);
    },
    NO_SCREEN_PART_TEST_MS,
  );

  // Issue 57 (test-criteria.md, "Unit — app/routes.test.tsx", New): the crumbs of the screen above the path, and the
  // first action.
  // Bound: waits up to AREA_LOAD_MS (10 s) for the h1, so the find reports what is missing before the case ends (issue 57 s1, bda293f, as 9249783).
  it.each<[string, [string, string | null][]]>([
    [
      '/aws/s3/buckets/my-bucket/metrics',
      [
        ['Buckets', '/aws/s3/buckets'],
        ['my-bucket', '/aws/s3/buckets/my-bucket'],
      ],
    ],
    [
      '/aws/s3/bucket/my-bucket/property/versioning/edit',
      [
        ['Buckets', '/aws/s3/buckets'],
        ['my-bucket', '/aws/s3/buckets/my-bucket'],
      ],
    ],
    ['/aws/s3/directory-buckets', []],
  ])(
    'opens %s as the "no screen yet" page with the crumbs EmuForge, AWS, S3, those of the screen above, then "No screen yet"',
    async (path, above) => {
      open(path);

      await heading('No screen yet');
      const crumbs = (createWrapper(document.body).findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((item) => {
        const element = item.getElement();
        const link = element.closest('a[href]') ?? element.querySelector('a[href]');
        return [(element.textContent ?? '').trim(), link?.getAttribute('href') ?? null];
      });
      expect(crumbs).toEqual([
        ['EmuForge', '/'],
        ['AWS', '/aws'],
        ['S3', '/aws/s3'],
        ...above,
        ['No screen yet', null],
      ]);
    },
    NO_SCREEN_PART_TEST_MS,
  );

  // Bound: waits up to AREA_LOAD_MS (10 s) for the h1, so the find reports what is missing before the case ends (issue 57 s1, bda293f, as 9249783).
  it(
    'opens /aws/s3/directory-buckets, then "Go to Buckets": the address /aws/s3 and the h1 "Buckets", without a document load',
    async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/aws/s3/directory-buckets'] });
      render(
        <Providers>
          <RouterProvider router={router} />
        </Providers>,
      );
      await heading('No screen yet');

      let followed = true;
      act(() => {
        followed = fireEvent.click(within(main()).getByRole('link', { name: 'Go to Buckets' }));
      });

      expect(followed).toBe(false);
      expect(router.state.location.pathname).toBe('/aws/s3');
      expect(inCloudscape(await heading('Buckets'))).toBe(true);
    },
    NO_SCREEN_PART_TEST_MS,
  );

  it('opens /aws/kinesis: the document title "Amazon Kinesis | EmuForge Studio" and the sentence that Studio has no screen for it, as before', async () => {
    open('/aws/kinesis');

    await heading('Amazon Kinesis');
    expect(main()).toHaveTextContent('Studio has no screen for Amazon Kinesis yet.');
    await waitFor(() => {
      expect(document.title).toBe('Amazon Kinesis | EmuForge Studio');
    });
  });

  it('opens /aws/does-not-exist/today as the AWS area’s "Page not found", with the path as text', async () => {
    open('/aws/does-not-exist/today');

    expect(inCloudscape(await heading('Page not found'))).toBe(true);
    expect(main()).toHaveTextContent('/aws/does-not-exist/today');
    expect(within(main()).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });

  it.each(['/s3', '/dynamodb/tables', '/does-not-exist/today'])(
    'opens %s as Studio’s "Page not found", outside any AWS area',
    async (path) => {
      open(path);

      expect(await heading('Page not found')).toBeInTheDocument();
      expect(main()).toHaveTextContent(`Studio has no page at ${path}.`);
      expect(within(main()).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
      expect(cloudscapeElements()).toEqual([]);
    },
  );

  it.each(['/<img src=x onerror=alert(1)>', '/aws/<img src=x onerror=alert(1)>'])(
    'shows the path %s as those characters, creating no element from it',
    async (path) => {
      const { container } = open(path);

      expect(await heading('Page not found')).toBeInTheDocument();
      expect(main()).toHaveTextContent(path);
      expect(container.querySelector('img')).toBeNull();
    },
  );

  it.each([
    ['/', 'Home'],
    ['/connections', 'Connections'],
    ['/aws', AWS],
    [NO_SCREEN_SERVICE.path, NO_SCREEN],
    [BELOW, NO_SCREEN],
    ['/aws/does-not-exist/today', 'Page not found'],
    ['/s3', 'Page not found'],
    ['/dynamodb/tables', 'Page not found'],
    ['/does-not-exist/today', 'Page not found'],
    ['/<img src=x onerror=alert(1)>', 'Page not found'],
    ['/aws/<img src=x onerror=alert(1)>', 'Page not found'],
  ])('on %s: exactly one main landmark, and the frame’s banner is not inside it', async (path, h1) => {
    open(path);
    await heading(h1);

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'EmuForge Studio' })).toBeInTheDocument();
    expect(mains[0]?.contains(banner)).toBe(false);
    expect(banner.contains(mains[0] as HTMLElement)).toBe(false);
  });
});
