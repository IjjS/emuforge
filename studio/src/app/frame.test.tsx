import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../i18n/language-provider';
import { Frame, ProviderPage } from './frame';
import type { ProviderAreaProps } from './provider-list';
import { Providers } from './providers';
import { routes } from './routes';

/** The AWS area's first import is real work (Cloudscape's modules), not a timer; a cold run takes a while. */
const AREA_LOAD_MS = 10_000;

beforeEach(() => {
  // No network in these tests: Home's check fails at once, and nothing reaches an engine.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('no network in this test'))),
  );
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
  vi.doUnmock('./provider-list');
});

/** The frame alone at `path`, above an empty page, in the browser's language. */
function openFrame(path: string) {
  const router = createMemoryRouter([{ element: <Frame />, children: [{ path: '*', element: null }] }], {
    initialEntries: [path],
  });
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

/**
 * Studio at `path`, with its real routes (or `withRoutes`, and the providers of the same module graph, `withProviders`,
 * since routes evaluated afresh read the context of a language module evaluated afresh).
 */
function openStudio(path: string, withRoutes: RouteObject[] = routes, WithProviders: typeof Providers = Providers) {
  const router = createMemoryRouter(withRoutes, { initialEntries: [path] });
  const result = render(
    <WithProviders>
      <RouterProvider router={router} />
    </WithProviders>,
  );
  return { ...result, router };
}

/**
 * A stub provider area, as `ProviderPage` renders one under a stub segment: a `main` that holds a `nav` with a
 * link, then an `h2` and a button. With `names`, it names its `h2` as its content target through
 * `ProviderAreaProps`.
 */
function stubArea(names: boolean) {
  return function StubArea({ onPageTitle, onContentTarget }: ProviderAreaProps) {
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
      onPageTitle('Stub page');
      if (!names) {
        return;
      }
      onContentTarget(() => {
        heading.current?.focus();
      });
      return () => {
        onContentTarget(null);
      };
    }, [onPageTitle, onContentTarget]);
    return (
      <main>
        <nav aria-label="Stub">
          <a href="/stub/elsewhere">Stub link</a>
        </nav>
        <h2 ref={heading} tabIndex={-1}>
          Stub page
        </h2>
        <button type="button">Stub action</button>
      </main>
    );
  };
}

/** Studio's frame with a stub area under the segment `stub`. */
function openStub(names: boolean) {
  const Area = stubArea(names);
  return openStudio('/stub', [
    { element: <Frame />, children: [{ path: 'stub/*', element: <ProviderPage area={Area} /> }] },
  ]);
}

const NAVIGATION = 'nav, [role~="navigation"]';
const TAB_STOP = 'a[href], button, input, select, textarea, [tabindex]';

/** The Tab stops of the document, in document order (no element of Studio sets a positive `tabindex`). */
function tabStops(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(TAB_STOP)].filter(
    (element) => element.tabIndex >= 0 && !element.hasAttribute('disabled'),
  );
}

function follows(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * What keeps `target` from being the page's content target named `name` (requirement R4): the page's `h1` (a), or
 * an element of a role that takes a name, named by the `h1`, holding it and the first content stop (b); inside the
 * page's one `main`; no navigation in it or between it and the first content stop `firstStop`; not a Tab stop.
 * `[]` when nothing does.
 */
function contentTargetProblems(target: Element | null, name: string, firstStop: string): string[] {
  if (!(target instanceof HTMLElement) || target === document.body) {
    return [`focus is on ${target === null ? 'nothing' : target.tagName.toLowerCase()}`];
  }
  const problems: string[] = [];
  const mains = screen.getAllByRole('main');
  const h1 = screen.getByRole('heading', { level: 1 });
  if (mains.length !== 1) {
    problems.push(`the page has ${String(mains.length)} main landmarks`);
  } else if (!mains[0]?.contains(target)) {
    problems.push("it is outside the page's main");
  }
  if (h1.textContent !== name) {
    problems.push(`the h1 is "${String(h1.textContent)}", not "${name}"`);
  }
  if (target === h1) {
    if (screen.queryByRole('heading', { level: 1, name }) !== target) {
      problems.push(`the h1 is not named "${name}"`);
    }
  } else if (
    target.contains(h1) &&
    h1.id !== '' &&
    (target.getAttribute('aria-labelledby') ?? '').split(' ').includes(h1.id)
  ) {
    const named = [...screen.queryAllByRole('region', { name }), ...screen.queryAllByRole('main', { name })];
    if (!named.includes(target)) {
      problems.push(`it is no region or main named "${name}"`);
    }
  } else {
    problems.push('it is neither the h1 nor an element named by the h1 that holds it');
  }
  if (target.closest(NAVIGATION) !== null || target.querySelector(NAVIGATION) !== null) {
    problems.push('it is in a navigation or holds one');
  }
  if (target.tabIndex >= 0) {
    problems.push('it is a Tab stop');
  }
  const next = tabStops().find((stop) => stop !== target && follows(target, stop));
  if (next === undefined) {
    problems.push('no Tab stop follows it');
  } else {
    if (next.textContent !== firstStop) {
      problems.push(`the first Tab stop after it is "${String(next.textContent)}", not "${firstStop}"`);
    }
    if (target !== h1 && !target.contains(next)) {
      problems.push('it does not hold the first content stop');
    }
    const between = [...document.querySelectorAll(NAVIGATION)].filter(
      (nav) => follows(target, nav) && follows(nav, next) && !nav.contains(next),
    );
    if (between.length > 0) {
      problems.push(`${String(between.length)} navigation landmarks lie between it and its first content stop`);
    }
  }
  return problems;
}

/** Waits until focus is on the content target named `name`, whose first content stop is `firstStop`. */
async function expectFocusOnTarget(name: string, firstStop: string, timeout = 1_000) {
  await waitFor(
    () => {
      expect(contentTargetProblems(document.activeElement, name, firstStop)).toEqual([]);
    },
    { timeout },
  );
}

/** Focuses "Skip to content" and presses Enter on it, as a keyboard user does. */
async function activateSkip() {
  const skip = screen.getByRole('link', { name: 'Skip to content' });
  act(() => {
    skip.focus();
  });
  await userEvent.setup().keyboard('{Enter}');
  return skip;
}

function frameLinks() {
  const banner = screen.getByRole('banner');
  const nav = within(banner).getByRole('navigation', { name: 'Studio' });
  return {
    banner,
    nav,
    home: within(nav).getByRole('link', { name: 'Home' }),
    aws: within(nav).getByRole('link', { name: 'AWS' }),
  };
}

describe('Studio’s frame', () => {
  it('on /: a banner with "EmuForge Studio" to / and the navigation "Studio" with Home then AWS; Home current', () => {
    openFrame('/');
    const { banner, nav, home, aws } = frameLinks();

    expect(within(banner).getByRole('link', { name: 'EmuForge Studio' })).toHaveAttribute('href', '/');
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual([
      ['Home', '/'],
      ['AWS', '/aws'],
    ]);
    expect(home).toHaveAttribute('aria-current', 'page');
    expect(aws).not.toHaveAttribute('aria-current');
  });

  it('on /aws: AWS is the current page, Home is not marked', () => {
    openFrame('/aws');
    const { home, aws } = frameLinks();

    expect(aws).toHaveAttribute('aria-current', 'page');
    expect(home).not.toHaveAttribute('aria-current');
  });

  it.each(['/aws/s3', '/aws/does-not-exist'])('on %s: AWS is marked as current (true), Home is not', (path) => {
    openFrame(path);
    const { home, aws } = frameLinks();

    expect(aws).toHaveAttribute('aria-current', 'true');
    expect(home).not.toHaveAttribute('aria-current');
  });

  it.each(['/does-not-exist', '/s3'])('on %s: no link of the frame is marked', (path) => {
    openFrame(path);
    const { banner } = frameLinks();

    for (const link of within(banner).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it.each(['/', '/aws', '/aws/s3', '/aws/does-not-exist', '/does-not-exist', '/s3'])(
    'on %s: no element of the frame has a Cloudscape class',
    async (path) => {
      openStudio(path);
      if (path.startsWith('/aws')) {
        // The area is on the page beside the frame.
        await screen.findByRole('main', {}, { timeout: AREA_LOAD_MS });
      }
      const { banner } = frameLinks();

      for (const element of [banner, ...banner.querySelectorAll('*')]) {
        expect([...element.classList].filter((name) => name.startsWith('awsui'))).toEqual([]);
      }
    },
  );

  it.each([
    ['/', 'EmuForge Studio'],
    ['/does-not-exist', 'Page not found | EmuForge Studio'],
    ['/aws', 'Amazon Web Services | EmuForge Studio'],
    ['/aws/s3/buckets', 'Amazon Simple Storage Service | EmuForge Studio'],
  ])('on %s: the document title is "%s"', async (path, title) => {
    document.title = 'not set by Studio';
    openStudio(path);

    await act(async () => {
      await vi.waitFor(
        () => {
          expect(document.title).toBe(title);
        },
        { timeout: AREA_LOAD_MS },
      );
    });
  });
});

describe('"Skip to content" and a route change', () => {
  it('on /: Skip to content focuses the content target named Home; the address stays / with no fragment', async () => {
    const { router } = openStudio('/');

    await activateSkip();

    expect(contentTargetProblems(document.activeElement, 'Home', 'Refresh')).toEqual([]);
    expect(router.state.location).toMatchObject({ pathname: '/', hash: '' });
    expect(window.location.hash).toBe('');
  });

  it('on /does-not-exist: Skip to content focuses the content target named Page not found', async () => {
    const { router } = openStudio('/does-not-exist');

    await activateSkip();

    expect(contentTargetProblems(document.activeElement, 'Page not found', 'Go to Home')).toEqual([]);
    expect(router.state.location).toMatchObject({ pathname: '/does-not-exist', hash: '' });
    expect(window.location.hash).toBe('');
  });

  it("on /aws: Skip to content focuses the area's content target named Amazon Web Services, not its main", async () => {
    const { router } = openStudio('/aws');
    await screen.findByRole('heading', { level: 1, name: 'Amazon Web Services' }, { timeout: AREA_LOAD_MS });

    await activateSkip();

    expect(contentTargetProblems(document.activeElement, 'Amazon Web Services', 'Amazon API Gateway')).toEqual([]);
    expect(document.activeElement).not.toBe(screen.getByRole('main'));
    expect(router.state.location).toMatchObject({ pathname: '/aws', hash: '' });
    expect(window.location.hash).toBe('');
  });

  it('in a stub area that names its h2: Skip to content focuses that h2, not its main or its nav’s link', async () => {
    openStub(true);
    await screen.findByRole('heading', { level: 2, name: 'Stub page' });

    await activateSkip();

    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Stub page' }));
    expect(document.activeElement).not.toBe(screen.getByRole('main'));
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: 'Stub link' }));
  });

  it('in a stub area that names no target: Skip to content keeps focus and the address', async () => {
    const { router } = openStub(false);
    await screen.findByRole('heading', { level: 2, name: 'Stub page' });

    const skip = await activateSkip();

    expect(document.activeElement).toBe(skip);
    expect(screen.getByRole('main').contains(document.activeElement)).toBe(false);
    expect(router.state.location).toMatchObject({ pathname: '/stub', hash: '' });
    expect(window.location.hash).toBe('');
  });

  it('from / to /does-not-exist and back: focus on the content target of each page', async () => {
    const { router } = openStudio('/');

    await act(() => router.navigate('/does-not-exist'));
    await expectFocusOnTarget('Page not found', 'Go to Home');

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/');
    await expectFocusOnTarget('Home', 'Refresh');
  });

  it("from / to /aws before the area has loaded: focus on the area's content target once it shows its h1", async () => {
    // Routes evaluated afresh, with the area's code held back until the route change has happened.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.resetModules();
    vi.doMock('./provider-list', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./provider-list')>();
      const providers = actual.PROVIDERS.map((provider) => ({
        ...provider,
        loadArea: async () => {
          await held;
          return provider.loadArea();
        },
      }));
      return { ...actual, PROVIDERS: providers };
    });
    const fresh = await import('./routes');
    const freshProviders = await import('./providers');
    const { router } = openStudio('/', fresh.routes, freshProviders.Providers);

    await act(() => router.navigate('/aws'));
    expect(screen.queryByRole('heading', { level: 1, name: 'Amazon Web Services' })).toBeNull();
    release();

    await screen.findByRole('heading', { level: 1, name: 'Amazon Web Services' }, { timeout: AREA_LOAD_MS });
    await expectFocusOnTarget('Amazon Web Services', 'Amazon API Gateway');
  });

  it('from /aws, once the area has loaded, to /: focus on the content target named Home', async () => {
    const { router } = openStudio('/aws');
    await screen.findByRole('heading', { level: 1, name: 'Amazon Web Services' }, { timeout: AREA_LOAD_MS });

    await act(() => router.navigate('/'));

    await expectFocusOnTarget('Home', 'Refresh');
  });

  it('on /, with focus on the frame’s Home, a move to / is no route change: focus stays on Home', async () => {
    const { router } = openStudio('/');
    const { home } = frameLinks();
    act(() => {
      home.focus();
    });

    await act(() => router.navigate('/'));

    expect(document.activeElement).toBe(frameLinks().home);
  });

  it.each([
    ['/', 'Home', 'button', 'Refresh'],
    ['/aws', 'Amazon Web Services', 'link', 'Amazon API Gateway'],
    ['/aws/s3', 'Amazon Simple Storage Service', 'link', 'Go to Home'],
  ])('on a first load of %s: focus stays on the body once the page shows its h1', async (path, name, role, first) => {
    openStudio(path);

    await screen.findByRole('heading', { level: 1, name }, { timeout: AREA_LOAD_MS });
    // The page's content past its h1 is on screen too: its first content stop.
    await screen.findAllByRole(role, { name: first });

    expect(document.activeElement).toBe(document.body);
  });
});
