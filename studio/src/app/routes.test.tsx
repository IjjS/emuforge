import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeEngine } from '../test/home-test-kit';
import { NO_SCREEN_SERVICE } from '../test/no-screen';
import { serviceLinks } from '../test/service-files';
import { Providers } from './providers';
import { routes } from './routes';

const AWS = 'Amazon Web Services';
const NO_SCREEN = NO_SCREEN_SERVICE.label;
/** A path two segments below the route of the service without a screen. */
const BELOW = `${NO_SCREEN_SERVICE.below}/my-stream`;

// The services as their folders give them (providers/aws/area/services/*/service.json), in the order of issue 386's
// requirement R13.2, each under /aws.
const SERVICES = serviceLinks();

/** Every service but Amazon Simple Storage Service, whose route has a screen of its own (issue 56). */
const WITHOUT_SCREEN = SERVICES.filter(([label]) => label !== 'Amazon Simple Storage Service');

/** The AWS area's first import is real work (Cloudscape's modules), not a timer; a cold run takes a while. */
const AREA_LOAD_MS = 10_000;

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

async function expectNoScreenYet(label: string) {
  const h1 = await heading(label);
  expect(inCloudscape(h1)).toBe(true);
  expect(main()).toHaveTextContent(`Studio has no screen for ${label} yet.`);
  expect(within(main()).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
}

describe('routes', () => {
  it('opens Home at /', () => {
    open('/');

    expect(within(main()).getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });

  it('opens /aws as the AWS area index: "Services" (the number of services), its line, and the services in label order', async () => {
    open('/aws');

    expect(inCloudscape(await heading(AWS))).toBe(true);
    const container = createWrapper(main()).findContainer();
    expect(container).not.toBeNull();
    const header = container?.findHeader()?.getElement();
    expect(header).toHaveTextContent('Services');
    expect(header).toHaveTextContent(`(${String(SERVICES.length)})`);
    expect(header).toHaveTextContent('No service has a Studio screen yet.');
    const links = within(container?.findContent().getElement() as HTMLElement)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual(SERVICES);
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
  it.each(['/aws/s3/buckets/my-bucket', '/aws/s3/buckets/my-bucket/properties'])(
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

  /** The crumbs' texts. */
  function crumbTexts(): string[] {
    return (createWrapper(document.body).findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map(
      (item) => item.getElement().textContent,
    );
  }

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

  /** The four screens of a bucket, at each of their routes, with their h1 and document title. */
  const BUCKET_SCREENS: [path: string, h1: string, title: string][] = [
    ['/aws/s3/buckets/my-bucket', 'my-bucket', 'my-bucket | EmuForge Studio'],
    ['/aws/s3/buckets/my-bucket/properties', 'my-bucket', 'my-bucket | EmuForge Studio'],
    ['/aws/s3/bucket/create', 'Create bucket', 'Create bucket | EmuForge Studio'],
    ['/aws/s3/bucket/my-bucket/empty', 'Empty bucket', 'Empty bucket | EmuForge Studio'],
    ['/aws/s3/bucket/my-bucket/delete', 'Delete bucket', 'Delete bucket | EmuForge Studio'],
  ];

  // Issue 256, test-criteria.md, "Unit — app/routes.test.tsx", case 6: the notice, the (i) control, the navigation.
  it.each(BUCKET_SCREENS)(
    'opens %s with the notice for buckets, the (i) control, and S3’s navigation with "General purpose buckets" current',
    async (path, h1) => {
      open(path);

      await heading(h1);
      expect(within(main()).getByText('These buckets are in your local emulator')).toBeInTheDocument();
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

  // Issue 256 gives /aws/s3/buckets/my-bucket and /aws/s3/bucket/create their screens; these three paths have none
  // before or after (test-criteria.md, "Existing checks and cases").
  it.each([
    '/aws/s3/buckets/my-bucket/objects',
    '/aws/s3/bucket/my-bucket/property/versioning/edit',
    '/aws/s3/directory-buckets',
  ])(
    'opens %s as the "no screen yet" page of Amazon Simple Storage Service, with no ListBuckets request',
    async (path) => {
      const engine = new FakeEngine();
      vi.stubGlobal('fetch', engine.fetch);
      open(path);

      await expectNoScreenYet('Amazon Simple Storage Service');
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
    },
  );

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
