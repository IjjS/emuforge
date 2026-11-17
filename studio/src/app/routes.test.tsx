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

/** The services whose route has a screen of its own: Amazon S3 (issue 56) and AWS Identity and Access Management (issue 82). */
const WITH_SCREEN: readonly string[] = ['Amazon Simple Storage Service', 'AWS Identity and Access Management'];

/** Every other service. */
const WITHOUT_SCREEN = SERVICES.filter(([label]) => !WITH_SCREEN.includes(label));

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

  it('leaves AWS Identity and Access Management out of the services opened as a "no screen yet" page, and keeps every other', () => {
    expect(WITHOUT_SCREEN.map(([label]) => label)).not.toContain('AWS Identity and Access Management');
    expect(WITHOUT_SCREEN).toHaveLength(SERVICES.length - WITH_SCREEN.length);
  });

  it.each(['/aws/iam/policies', '/aws/iam/roles/details/abc/tags'])(
    'opens %s as the "no screen yet" page of AWS Identity and Access Management',
    async (path) => {
      open(path);

      await expectNoScreenYet('AWS Identity and Access Management');
    },
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

  it.each(['/aws/s3/buckets/my-bucket', '/aws/s3/bucket/create', '/aws/s3/directory-buckets'])(
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
