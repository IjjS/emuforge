import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, getRoles, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUNDLED_CATALOGUES } from '../i18n/bundled';
import { STORAGE_KEY } from '../i18n/language';
import { LanguageProvider } from '../i18n/language-provider';
import { preloadArea } from '../test/area-preload';
import {
  advance,
  buildOnceToggle,
  connected,
  connectedTo,
  connectionNotice,
  connectionSection,
  emulatorDown,
  FakeEngine,
  headerRefresh,
  languageStore,
  present,
  row,
  textNotFrom,
} from '../test/home-test-kit';
import { NO_SCREEN_SERVICE } from '../test/no-screen';
import { serviceLinks, SERVICES_DIR } from '../test/service-files';
import { Frame, ProviderPage } from './frame';
import type { ProviderAreaProps } from './provider-list';
import { Providers } from './providers';
import { routes } from './routes';

// Keep the preloaded area available even when a case resets the module cache to inspect Studio's startup.
vi.mock('../providers/aws/provider', async (importOriginal) => {
  const { AWS_PROVIDER } = await importOriginal<typeof import('../providers/aws/provider')>();
  const { preloadArea } = await import('../test/area-preload');
  const area = await preloadArea(AWS_PROVIDER.loadArea);
  return { AWS_PROVIDER: { ...AWS_PROVIDER, loadArea: () => Promise.resolve(area) } };
});

const AREA_WAIT_MS = 5000;

// Fresh routes keep the already evaluated area pending until the focus case releases it.
let releaseArea: () => void = () => undefined;
const heldArea = new Promise<void>((resolve) => {
  releaseArea = resolve;
});
vi.resetModules();
vi.doMock('./provider-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./provider-list')>();
  const providers = actual.PROVIDERS.map((provider) => ({
    ...provider,
    loadArea: async () => {
      await heldArea;
      return provider.loadArea();
    },
  }));
  return { ...actual, PROVIDERS: providers };
});
const [fresh, freshProviders] = await preloadArea(() => Promise.all([import('./routes'), import('./providers')]));
vi.doUnmock('./provider-list');

/**
 * The first link of "Services" on /aws: the first, in label order, of the services whose folder holds a `screens.ts`,
 * which the index lists first (issue 61, R5); computed from the folders, never written as a name.
 */
const FIRST_INDEX_LINK = (() => {
  const first = serviceLinks().find(([, href]) =>
    existsSync(path.join(SERVICES_DIR, href.replace(/^\/aws\//, ''), 'screens.ts')),
  );
  if (first === undefined) throw new Error('No service folder holds a screens.ts.');
  return first[0];
})();

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
    connections: within(nav).getByRole('link', { name: 'Connections' }),
    aws: within(nav).getByRole('link', { name: 'AWS' }),
  };
}

describe('Studio’s frame', () => {
  it('on /: a banner with "EmuForge Studio" to / and the navigation "Studio" with Home, Connections, then AWS; Home current', () => {
    openFrame('/');
    const { banner, nav, home, connections, aws } = frameLinks();

    expect(within(banner).getByRole('link', { name: 'EmuForge Studio' })).toHaveAttribute('href', '/');
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual([
      ['Home', '/'],
      ['Connections', '/connections'],
      ['AWS', '/aws'],
    ]);
    expect(home).toHaveAttribute('aria-current', 'page');
    expect(connections).not.toHaveAttribute('aria-current');
    expect(aws).not.toHaveAttribute('aria-current');
  });

  it('on /connections: Connections is the current page, Home and AWS are not marked (issue 486, R1)', () => {
    openFrame('/connections');
    const { home, connections, aws } = frameLinks();

    expect(connections).toHaveAttribute('aria-current', 'page');
    expect(home).not.toHaveAttribute('aria-current');
    expect(aws).not.toHaveAttribute('aria-current');
  });

  it.each(['/', '/aws', '/aws/s3', '/connections/x', '/connectionsx', '/does-not-exist'])(
    'on %s: Connections is not marked (issue 486, R1)',
    (path) => {
      openFrame(path);

      expect(frameLinks().connections).not.toHaveAttribute('aria-current');
    },
  );

  it("a tab that takes focus is scrolled into the tab list's view, the nearest way (issue 486, critique)", () => {
    const scrolled: { element: Element; options: unknown }[] = [];
    const original = HTMLElement.prototype.scrollIntoView as HTMLElement['scrollIntoView'] | undefined;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement, options?: unknown) {
      scrolled.push({ element: this, options });
    } as HTMLElement['scrollIntoView'];
    try {
      openFrame('/');
      const { aws } = frameLinks();

      aws.focus();

      expect(document.activeElement).toBe(aws);
      expect(scrolled).toEqual([{ element: aws, options: { block: 'nearest', inline: 'nearest' } }]);
    } finally {
      if (original === undefined) {
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      } else {
        HTMLElement.prototype.scrollIntoView = original;
      }
    }
  });

  it('at 480 and below each tab is at least 24px wide with its label centred, a target of its own (issue 486, critique)', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'ui', 'bar.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const start = css.indexOf('@media (max-width: 480px)');
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let end = css.indexOf('{', start);
    for (let i = end; i < css.length; i++) {
      depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    const narrow = css.slice(css.indexOf('{', start) + 1, end);
    const rule = /(?:^|\})\s*\.st-nav a\s*\{([^{}]*)\}/.exec(narrow)?.[1] ?? '';
    const declarations = new Map(
      rule
        .split(';')
        .map((d) => d.split(':').map((part) => part.trim()))
        .filter(([property]) => property !== undefined && property !== '')
        .map(([property = '', value = '']) => [property, value]),
    );

    expect(declarations.get('min-width')).toBe('24px');
    expect(declarations.get('justify-content')).toBe('center');
  });

  it('on /aws: AWS is the current page, Home is not marked', () => {
    openFrame('/aws');
    const { home, aws } = frameLinks();

    expect(aws).toHaveAttribute('aria-current', 'page');
    expect(home).not.toHaveAttribute('aria-current');
  });

  it.each([NO_SCREEN_SERVICE.path, '/aws/does-not-exist'])(
    'on %s: AWS is marked as current (true), Home is not',
    (path) => {
      openFrame(path);
      const { home, aws } = frameLinks();

      expect(aws).toHaveAttribute('aria-current', 'true');
      expect(home).not.toHaveAttribute('aria-current');
    },
  );

  it.each(['/does-not-exist', '/s3'])('on %s: no link of the frame is marked', (path) => {
    openFrame(path);
    const { banner } = frameLinks();

    for (const link of within(banner).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it.each(['/', '/aws', NO_SCREEN_SERVICE.path, '/aws/does-not-exist', '/does-not-exist', '/s3'])(
    'on %s: no element of the frame has a Cloudscape class',
    async (path) => {
      openStudio(path);
      if (path.startsWith('/aws')) {
        // The area is on the page beside the frame.
        await screen.findByRole('main', {}, { timeout: AREA_WAIT_MS });
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
    ['/connections', 'Connections | EmuForge Studio'],
    ['/aws', 'Amazon Web Services | EmuForge Studio'],
    [NO_SCREEN_SERVICE.below, `${NO_SCREEN_SERVICE.label} | EmuForge Studio`],
  ])('on %s: the document title is "%s"', async (path, title) => {
    document.title = 'not set by Studio';
    openStudio(path);

    await act(async () => {
      await vi.waitFor(
        () => {
          expect(document.title).toBe(title);
        },
        { timeout: AREA_WAIT_MS },
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
    // The engine answers connected, so the AWS area's emulator line adds no Tab stop (issue 45, R4.8).
    vi.stubGlobal('fetch', new FakeEngine().fetch);
    const { router } = openStudio('/aws');
    await screen.findByRole('heading', { level: 1, name: 'Amazon Web Services' }, { timeout: AREA_WAIT_MS });

    await activateSkip();

    expect(contentTargetProblems(document.activeElement, 'Amazon Web Services', FIRST_INDEX_LINK)).toEqual([]);
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
    // The engine answers connected, so the AWS area's emulator line adds no Tab stop (issue 45, R4.8).
    vi.stubGlobal('fetch', new FakeEngine().fetch);
    const { router } = openStudio('/', fresh.routes, freshProviders.Providers);

    await act(() => router.navigate('/aws'));
    expect(screen.queryByRole('heading', { level: 1, name: 'Amazon Web Services' })).toBeNull();
    releaseArea();

    await screen.findByRole('heading', { level: 1, name: 'Amazon Web Services' }, { timeout: AREA_WAIT_MS });
    await expectFocusOnTarget('Amazon Web Services', FIRST_INDEX_LINK);
  });

  it('from /aws, once the area has loaded, to /: focus on the content target named Home', async () => {
    const { router } = openStudio('/aws');
    await screen.findByRole('heading', { level: 1, name: 'Amazon Web Services' }, { timeout: AREA_WAIT_MS });

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
    ['/aws', 'Amazon Web Services', 'link', FIRST_INDEX_LINK],
    [NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.label, 'link', 'Go to Home'],
  ])('on a first load of %s: focus stays on the body once the page shows its h1', async (path, name, role, first) => {
    openStudio(path);

    await screen.findByRole('heading', { level: 1, name }, { timeout: AREA_WAIT_MS });
    // The page's content past its h1 is on screen too: its first content stop.
    await screen.findAllByRole(role, { name: first });

    expect(document.activeElement).toBe(document.body);
  });
});

/** The catalogue's text of `key` in `tag`. */
function messageIn(tag: string, key: string): string {
  const message = BUNDLED_CATALOGUES.byTag.get(tag)?.messages.get(key);
  if (typeof message !== 'string') {
    throw new Error(`${tag} has no text "${key}"`);
  }
  return message;
}

/** Studio at `path` with its real routes, in `tag`, as a browser whose only language it is. */
function openStudioIn(path: string, tag: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <Providers language={languageStore(tag)}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...result, router };
}

/** The AWS area page the language cases open, and its English title. */
const AREA_PATH = NO_SCREEN_SERVICE.path;
const AREA_TITLE = NO_SCREEN_SERVICE.label;

describe('the frame in each of the twelve languages (R5.2, R2.7)', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
    document.title = '';
  });

  it.each([...BUNDLED_CATALOGUES.byTag.keys()])(
    "%s: from / to /does-not-exist the route change announces the catalogue's page title; to /aws/kinesis, the area's",
    async (tag) => {
      // The engine answers connected, so the AWS area's emulator line adds no Tab stop (issue 45, R4.8).
      vi.stubGlobal('fetch', new FakeEngine().fetch);
      const { router } = openStudioIn('/', tag);

      await act(() => router.navigate('/does-not-exist'));
      await expectFocusOnTarget(messageIn(tag, 'notFound.title'), messageIn(tag, 'notFound.home'));

      await act(() => router.navigate('/'));
      await expectFocusOnTarget(messageIn(tag, 'home.title'), messageIn(tag, 'home.refresh'));
      await act(() => router.navigate(AREA_PATH));
      const areaTitle = await screen.findByRole('heading', { level: 1, name: AREA_TITLE }, { timeout: AREA_WAIT_MS });
      await expectFocusOnTarget(AREA_TITLE, 'Go to Home');
      // The area page title the announcement reads, and the target it names, are in an element with lang="en".
      expect(areaTitle.closest('[lang]')).toHaveAttribute('lang', 'en');
      expect(document.activeElement?.closest('[lang]')).toHaveAttribute('lang', 'en');
    },
  );

  it('German: the document title is EmuForge Studio on Home, the German page title on "Page not found", English in the area', async () => {
    const { router } = openStudioIn('/', 'de');
    await waitFor(() => {
      expect(document.title).toBe('EmuForge Studio');
    });

    await act(() => router.navigate('/does-not-exist'));
    await waitFor(() => {
      expect(document.title).toBe(`${messageIn('de', 'notFound.title')} | EmuForge Studio`);
    });
    expect(document.title).not.toBe('Page not found | EmuForge Studio');

    await act(() => router.navigate(AREA_PATH));
    await waitFor(
      () => {
        expect(document.title).toBe(`${AREA_TITLE} | EmuForge Studio`);
      },
      { timeout: AREA_WAIT_MS },
    );
  });

  it('the app started with stored th: <html lang> is th before the first render, whose first content is Thai', async () => {
    localStorage.setItem(STORAGE_KEY, 'th');
    document.documentElement.lang = 'en';
    // As index.html holds them until the first render (R2.7).
    document.title = 'EmuForge Studio';
    const container = document.createElement('div');
    container.id = 'root';
    document.body.append(container);
    const langAtRender: string[] = [];
    const roots: Root[] = [];
    // The first content put into #root, as a recorder of every change to it sees it.
    const firstContent: { lang: string; heading: string | undefined; notThai: string[] }[] = [];
    const observer = new MutationObserver(() => {
      if (firstContent.length === 0 && container.childNodes.length > 0) {
        firstContent.push({
          lang: document.documentElement.lang,
          heading: container.querySelector('h1')?.textContent ?? undefined,
          notThai: textNotFrom('th'),
        });
      }
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    vi.resetModules();
    vi.doMock('react-dom/client', async (importOriginal) => {
      const actual = await importOriginal<typeof import('react-dom/client')>();
      return {
        ...actual,
        createRoot: (...args: Parameters<typeof actual.createRoot>) => {
          const root = actual.createRoot(...args);
          roots.push(root);
          const renderNow = root.render.bind(root);
          root.render = (children: ReactNode) => {
            langAtRender.push(document.documentElement.lang);
            renderNow(children);
          };
          return root;
        },
      };
    });
    try {
      await import('../main');
      await waitFor(() => {
        expect(firstContent).toHaveLength(1);
      });
      expect(langAtRender).toEqual(['th']);
      expect(firstContent[0]).toEqual({ lang: 'th', heading: messageIn('th', 'home.title'), notThai: [] });
    } finally {
      observer.disconnect();
      act(() => {
        roots.forEach((root) => {
          root.unmount();
        });
      });
      container.remove();
      vi.doUnmock('react-dom/client');
      vi.resetModules();
    }
  });
});

/** The own names of Studio's languages in the order of `Intl.Collator('und')` (requirement R3.3). */
const OWN_NAMES_IN_ORDER = [
  'Deutsch',
  'English',
  'Español',
  'Français',
  'Italiano',
  'Polski',
  'Português',
  'Tiếng Việt',
  'Русский',
  'ไทย',
  '한국어',
  '日本語',
];

/** The tag of the language whose own name is `name`. */
function tagOfName(name: string): string {
  const found = [...BUNDLED_CATALOGUES.byTag.values()].find((catalogue) => catalogue.name === name);
  return present(found, `the language named ${name}`).tag;
}

/** The control's accessible name in `tag`: the catalogue's "Language" with the own name in it (R3.2). */
function controlName(tag: string): string {
  return messageIn(tag, 'language.control').replace('{name}', present(BUNDLED_CATALOGUES.byTag.get(tag), tag).name);
}

/** The language control in the banner: its accessible name ends with a language's own name. */
function languageControl(): HTMLElement {
  const names = OWN_NAMES_IN_ORDER.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return within(screen.getByRole('banner')).getByRole('button', { name: new RegExp(`(?:${names})$`, 'u') });
}

function menuOptions(): HTMLElement[] {
  return within(screen.getByRole('menu')).getAllByRole('menuitemradio');
}

function checkedOptions(): string[] {
  return menuOptions()
    .filter((option) => option.getAttribute('aria-checked') === 'true')
    .map((option) => option.getAttribute('aria-label') ?? option.textContent);
}

/** Opens the menu with a click on the control. */
async function openMenu(user = userEvent.setup()) {
  await user.click(languageControl());
  return { user, menu: screen.getByRole('menu') };
}

/** The option of the menu whose label is `label`. */
function option(label: string): HTMLElement {
  return present(
    menuOptions().find((item) => item.textContent === label || item.textContent.startsWith(label)),
    `the option ${label}`,
  );
}

describe('the language control (R3)', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  it.each(['/', '/does-not-exist', AREA_PATH])(
    'on %s: the banner holds the control, after the navigation "Studio"',
    async (path) => {
      openStudio(path);
      if (path.startsWith('/aws')) {
        await screen.findByRole('heading', { level: 1, name: AREA_TITLE }, { timeout: AREA_WAIT_MS });
      }
      const { banner, nav } = frameLinks();
      const control = languageControl();

      expect(banner.contains(control)).toBe(true);
      expect(nav.contains(control)).toBe(false);
      expect(follows(nav, control)).toBe(true);
      expect(control.closest('.st-area')).toBeNull();
    },
  );

  it('in English, nothing stored: named "Language: English", it shows "English" in an element with lang="en"', () => {
    openFrame('/');
    const control = languageControl();

    expect(control).toHaveAccessibleName('Language: English');
    expect(control).toHaveTextContent(/^English$/);
    expect(within(control).getByText('English')).toHaveAttribute('lang', 'en');
    expect(control).toHaveAttribute('aria-haspopup', 'menu');
    expect(control).toHaveAttribute('aria-expanded', 'false');
  });

  it.each(['de', 'fr'])('stored %s: the catalogue\'s "Language" followed by the own name, which it shows', (tag) => {
    localStorage.setItem(STORAGE_KEY, tag);
    openFrame('/');
    const control = languageControl();
    const own = present(BUNDLED_CATALOGUES.byTag.get(tag), tag).name;

    // The attribute as the catalogue gives it, French space before the colon included.
    expect(control).toHaveAttribute('aria-label', controlName(tag));
    expect(control.getAttribute('aria-label')).not.toBe(`Language: ${own}`);
    expect(control).toHaveTextContent(new RegExp(`^${own}$`, 'u'));
    expect(within(control).getByText(own)).toHaveAttribute('lang', tag);
  });

  it('opened: a menu named "Language", "Browser language" first, then the twelve own names in order, each with its lang', async () => {
    openFrame('/');
    await openMenu();

    expect(screen.getByRole('menu')).toHaveAccessibleName('Language');
    expect(languageControl()).toHaveAttribute('aria-expanded', 'true');
    const [first, ...languages] = menuOptions();
    expect(first).toHaveAccessibleName('Browser language, English');
    expect(languages.map((item) => item.textContent)).toEqual(OWN_NAMES_IN_ORDER);
    for (const item of languages) {
      expect(item).toHaveAttribute('lang', tagOfName(item.textContent));
    }
  });

  it('opened in German: "Language" and "Browser language" are the German catalogue\'s', async () => {
    localStorage.setItem(STORAGE_KEY, 'de');
    openFrame('/');
    await openMenu();

    expect(screen.getByRole('menu')).toHaveAccessibleName(messageIn('de', 'language.menu'));
    expect(menuOptions()[0]).toHaveAccessibleName(
      messageIn('de', 'language.browserNamed').replace('{name}', 'English'),
    );
    expect(menuOptions()[0]).toHaveTextContent(`${messageIn('de', 'language.browser')}English`);
    expect(textNotFrom('de')).toEqual([]);
  });

  it('opened with nothing stored: only "Browser language" is checked, showing the resolved language\'s own name', async () => {
    openFrame('/');
    await openMenu();

    expect(checkedOptions()).toEqual(['Browser language, English']);
    expect(within(present(menuOptions()[0], 'the first option')).getByText('English')).toHaveAttribute('lang', 'en');
  });

  it('opened with stored de: only Deutsch is checked', async () => {
    localStorage.setItem(STORAGE_KEY, 'de');
    openFrame('/');
    await openMenu();

    expect(checkedOptions()).toEqual(['Deutsch']);
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
    ['ArrowDown', '{ArrowDown}'],
  ])('opened with %s on the control: focus is on the checked option', async (_key, keys) => {
    localStorage.setItem(STORAGE_KEY, 'de');
    openFrame('/');
    const user = userEvent.setup();
    act(() => {
      languageControl().focus();
    });

    await user.keyboard(keys);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(document.activeElement).toBe(option('Deutsch'));
  });

  it('in the menu: ArrowDown on the last → first, ArrowUp on the first → last, Home → first, End → last', async () => {
    openFrame('/');
    const { user } = await openMenu();
    const first = menuOptions()[0];
    const last = menuOptions().at(-1);
    expect(document.activeElement).toBe(first);

    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(last);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(first);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(option('Deutsch'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(last);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(first);
  });

  it('in the menu: typing "p" goes to the next own name that starts with P, Polski, then Português', async () => {
    openFrame('/');
    const { user } = await openMenu();

    await user.keyboard('p');
    expect(document.activeElement).toBe(option('Polski'));
    await user.keyboard('p');
    expect(document.activeElement).toBe(option('Português'));
    await user.keyboard('p');
    expect(document.activeElement).toBe(option('Polski'));
  });

  it.each([
    ['Esc', '{Escape}'],
    ['Tab', '{Tab}'],
  ])('%s in the menu: closed, nothing changed', async (key, keys) => {
    localStorage.setItem(STORAGE_KEY, 'de');
    openFrame('/');
    const { user } = await openMenu();
    await user.keyboard('{ArrowDown}');

    await user.keyboard(keys);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(languageControl()).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(languageControl()).toHaveAttribute('aria-label', controlName('de'));
    if (key === 'Esc') {
      expect(document.activeElement).toBe(languageControl());
    } else {
      expect(screen.getByRole('banner').contains(document.activeElement)).toBe(false);
    }
  });

  it("the control's first focus loads each own name's face, once (crit revised r2 P3)", () => {
    const load = vi.fn<(font: string, text: string) => Promise<FontFace[]>>(() => Promise.resolve([]));
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    try {
      openFrame('/');
      act(() => {
        languageControl().focus();
      });
      act(() => {
        languageControl().blur();
        languageControl().focus();
      });

      expect(load.mock.calls.map(([, text]) => text).sort()).toEqual([...OWN_NAMES_IN_ORDER].sort());
      // No probe of the load stays in the page.
      expect(screen.getByRole('banner').querySelectorAll('[hidden]')).toHaveLength(0);
    } finally {
      Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('a press outside the menu closes it, and changes nothing', async () => {
    openFrame('/');
    const { user } = await openMenu();

    await user.click(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('choosing a language (R3.6, R2.4, R2.6)', () => {
  let engine: FakeEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    vi.stubGlobal('fetch', engine.fetch);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  /** Home in the browser's language, once its first check has answered. */
  async function openHome() {
    openStudio('/');
    await waitFor(() => {
      expect(engine.healths.length).toBeGreaterThan(0);
    });
    const answered = [...BUNDLED_CATALOGUES.byTag.keys()].flatMap((tag) => [
      messageIn(tag, 'status.connected'),
      messageIn(tag, 'status.notStarted'),
    ]);
    await screen.findAllByText((text) => answered.includes(text));
  }

  it('Deutsch on Home: <html lang> de, the frame and Home in German, focus on the control, stored de, no request', async () => {
    await openHome();
    const before = engine.requests.length;

    const { user } = await openMenu();
    await user.click(option('Deutsch'));

    expect(document.documentElement.lang).toBe('de');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(messageIn('de', 'home.title'));
    expect(textNotFrom('de')).toEqual([]);
    expect(document.activeElement).toBe(languageControl());
    expect(languageControl()).toHaveAttribute('aria-label', controlName('de'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('de');
    expect(engine.requests).toHaveLength(before);
  });

  it.each([
    ['nothing stored, "Browser language"', null, 'Browser language'],
    ['stored de, Deutsch', 'de', 'Deutsch'],
  ])(
    'the checked option (%s): nothing stored changes, the text stays, focus on the control',
    async (_n, stored, label) => {
      if (stored !== null) {
        localStorage.setItem(STORAGE_KEY, stored);
      }
      await openHome();
      const text = document.body.textContent;
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

      const { user } = await openMenu();
      await user.click(option(label));

      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(stored);
      expect(document.body.textContent).toBe(text);
      expect(document.activeElement).toBe(languageControl());
      setItem.mockRestore();
      removeItem.mockRestore();
    },
  );

  it('"Browser language" with stored de and the browser in English: the key is removed and the text is English', async () => {
    localStorage.setItem(STORAGE_KEY, 'de');
    await openHome();

    const { user } = await openMenu();
    await user.click(option(messageIn('de', 'language.browser')));

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.documentElement.lang).toBe('en');
    expect(languageControl()).toHaveAccessibleName('Language: English');
    expect(textNotFrom('en')).toEqual([]);
  });

  it('German on Home with the build-once disclosure open: it stays open; the connection keeps its last answer', async () => {
    engine.healthAnswers = [emulatorDown('not_started', 9297)];
    await openHome();
    const user = userEvent.setup();
    await user.click(present(buildOnceToggle(), 'the build-once toggle'));
    expect(buildOnceToggle()).toHaveAttribute('aria-expanded', 'true');
    const checks = engine.healths.length;

    await openMenu(user);
    await user.click(option('Deutsch'));

    const toggle = present(buildOnceToggle(), 'the build-once toggle in German');
    expect(toggle).toHaveAccessibleName(messageIn('de', 'notice.buildOnce'));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(connectionNotice()).getByRole('heading', { level: 3 })).toHaveTextContent(
      messageIn('de', 'notice.notStarted').replace('{port}', '9297'),
    );
    expect(within(connectionSection()).getAllByText(messageIn('de', 'status.notStarted')).length).toBeGreaterThan(0);
    expect(engine.healths).toHaveLength(checks);
  });

  it('connected Home, then Deutsch: the rows keep their answer, in German', async () => {
    engine.healthAnswers = [connected()];
    await openHome();
    const checks = engine.healths.length;

    const { user } = await openMenu();
    await user.click(option('Deutsch'));

    expect(within(connectionSection()).getAllByText(messageIn('de', 'status.connected'))).toHaveLength(2);
    expect(engine.healths).toHaveLength(checks);
  });
});

/** The attributes that give an element an accessible name or description. */
const NAMING = ['aria-label', 'aria-labelledby', 'aria-describedby', 'aria-description', 'title', 'alt'];

/** The elements of `scope` in the accessibility tree that have a role, in document order. */
function accessibleIn(scope: HTMLElement): Element[] {
  const elements = new Set<Element>(Object.values(getRoles(scope)).flat());
  return [...scope.querySelectorAll('*')].filter((element) => elements.has(element));
}

describe('a press outside the open menu only puts it away (issue 32, R2, R3.3, R3.4)', () => {
  let engine: FakeEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    vi.stubGlobal('fetch', engine.fetch);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  /** The link of Home's providers to Amazon API Gateway, and the path it opens. */
  const SERVICE = { name: 'Amazon API Gateway', path: '/aws/apigateway' };

  /** Home, connected, once its first check has answered and its service links are shown. */
  async function openHome(user = userEvent.setup()) {
    const opened = openStudio('/');
    await waitFor(() => {
      expect(engine.healths.length).toBeGreaterThan(0);
    });
    await screen.findAllByText('Connected');
    await screen.findByRole('link', { name: SERVICE.name });
    return { ...opened, user, path: () => opened.router.state.location.pathname };
  }

  /** The AWS area's index at `/aws`, once its service links are shown. */
  async function openArea(user = userEvent.setup()) {
    const opened = openStudio('/aws');
    await screen.findByRole('heading', { level: 1, name: 'Amazon Web Services' }, { timeout: AREA_WAIT_MS });
    return { ...opened, user, path: () => opened.router.state.location.pathname };
  }

  function homeService(): HTMLElement {
    return within(screen.getByRole('main')).getByRole('link', { name: SERVICE.name });
  }

  function areaService(): HTMLElement {
    const area = present(document.querySelector('.st-area'), 'the AWS area');
    return present(area.querySelector<HTMLElement>(`a[href="${SERVICE.path}"]`), `the area's link to ${SERVICE.path}`);
  }

  /** Records every event of `types` that reaches `element` or a listener below the window. */
  function heard(element: HTMLElement, types: string[]): string[] {
    const seen: string[] = [];
    for (const type of types) {
      element.addEventListener(type, () => seen.push(type));
    }
    return seen;
  }

  const PRESS_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick'];

  function expectClosedWithFocus() {
    expect(screen.queryByRole('menu')).toBeNull();
    expect(languageControl()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(languageControl());
    expect(languageControl()).toHaveAccessibleName('Language: English');
  }

  it('on / with the menu open, a click on the bar\'s "AWS" tab: closed, the path is still / (regression)', async () => {
    const { user, path } = await openHome();
    await openMenu(user);

    await user.click(frameLinks().aws);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(path()).toBe('/');
  });

  it('on / with the menu open, a click on a service link of Home: closed, the path is still /, nothing stored (regression)', async () => {
    const { user, path } = await openHome();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    await openMenu(user);
    const link = homeService();
    const seen = heard(link, PRESS_EVENTS);

    await user.click(link);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(path()).toBe('/');
    expect(seen).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    setItem.mockRestore();
    removeItem.mockRestore();
  });

  it('on / with the menu open, a click on Home\'s "Refresh": closed, no new check is sent to the engine', async () => {
    const { user } = await openHome();
    const requests = engine.requests.length;
    await openMenu(user);

    await user.click(headerRefresh());
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(engine.requests).toHaveLength(requests);
  });

  it.each([
    ['the bar\'s "AWS" tab', () => frameLinks().aws],
    ['a service link of Home', homeService],
    ['Home\'s "Refresh"', headerRefresh],
  ])(
    'after a click on %s with the menu open: focus is on the control, named "Language: English"',
    async (_n, target) => {
      const { user } = await openHome();
      await openMenu(user);

      await user.click(target());

      expectClosedWithFocus();
    },
  );

  it('after the menu was closed by a click on the "AWS" tab, a second click on it: the path is /aws', async () => {
    const { user, path } = await openHome();
    await openMenu(user);
    await user.click(frameLinks().aws);
    expect(path()).toBe('/');

    await user.click(frameLinks().aws);

    expect(path()).toBe('/aws');
  });

  it('on /aws with the menu open, a click on a service link inside the area: closed, the path is still /aws; again: the service', async () => {
    const { user, path } = await openArea();
    await openMenu(user);

    await user.click(areaService());

    expect(screen.queryByRole('menu')).toBeNull();
    expect(path()).toBe('/aws');
    expect(document.activeElement).toBe(languageControl());

    await user.click(areaService());

    expect(path()).toBe(SERVICE.path);
  });

  it('a touch on a service link that the browser cancels (a drag): closed, the path unchanged; then a click opens it', async () => {
    const { user, path } = await openHome();
    await openMenu(user);
    const link = homeService();

    fireEvent.pointerDown(link, { pointerId: 7, pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(link, { pointerId: 7, pointerType: 'touch', isPrimary: true });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(path()).toBe('/');

    await user.click(homeService());

    expect(path()).toBe(SERVICE.path);
  });

  it('a press of the middle button on a service link: closed, the path unchanged, no auxiliary click heard; then a click opens it', async () => {
    const { user, path } = await openHome();
    await openMenu(user);
    const link = homeService();
    const seen = heard(link, PRESS_EVENTS);
    const auxclicks: MouseEvent[] = [];
    const record = (event: MouseEvent) => auxclicks.push(event);
    window.addEventListener('auxclick', record, true);

    await user.pointer({ keys: '[MouseMiddle]', target: link });

    window.removeEventListener('auxclick', record, true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(path()).toBe('/');
    expect(seen).toEqual([]);
    // The browser opens a link in another tab as the auxiliary click's default action: it is cancelled.
    expect(auxclicks.map((event) => event.defaultPrevented)).toEqual([true]);

    await user.click(homeService());

    expect(path()).toBe(SERVICE.path);
  });

  it('a press of the secondary button on a service link: closed, the path unchanged, the context menu not cancelled; then a click opens it', async () => {
    const { user, path } = await openHome();
    await openMenu(user);
    const link = homeService();
    const contextMenus: MouseEvent[] = [];
    const record = (event: MouseEvent) => contextMenus.push(event);
    window.addEventListener('contextmenu', record);

    await user.pointer({ keys: '[MouseRight]', target: link });

    window.removeEventListener('contextmenu', record);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(path()).toBe('/');
    expect(contextMenus).toHaveLength(1);
    expect(contextMenus[0]?.defaultPrevented).toBe(false);

    await user.click(homeService());

    expect(path()).toBe(SERVICE.path);
  });

  it('a press of a pen on a service link: closed, the path unchanged, focus on the control; then a click opens it', async () => {
    const { user, path } = await openHome();
    await openMenu(user);
    const link = homeService();
    const seen = heard(link, PRESS_EVENTS);
    const pen = { pointerId: 9, pointerType: 'pen', isPrimary: true, button: 0 };

    // A pen's press as a browser delivers it: its pointer events, the mouse events made from them, then the click.
    fireEvent.pointerDown(link, { ...pen, buttons: 1 });
    fireEvent.mouseDown(link, { button: 0, buttons: 1 });
    fireEvent.pointerUp(link, { ...pen, buttons: 0 });
    fireEvent.mouseUp(link, { button: 0, buttons: 0 });
    const followed = fireEvent.click(link, { button: 0, detail: 1 });

    expect(seen).toEqual([]);
    expect(followed).toBe(false);
    expect(path()).toBe('/');
    expectClosedWithFocus();

    await user.click(homeService());

    expect(path()).toBe(SERVICE.path);
  });

  it('with the menu open, a click on the control: closed, focus stays on the control', async () => {
    openFrame('/');
    const { user } = await openMenu();

    await user.click(languageControl());

    expectClosedWithFocus();
  });

  it('with the menu open, the banner exposes the control and the menu and nothing else new', async () => {
    openFrame('/');
    const banner = screen.getByRole('banner');
    const before = new Set(banner.querySelectorAll('*'));
    const rolesBefore = accessibleIn(banner);
    const textBefore = banner.textContent;

    const { menu } = await openMenu();

    const added = [...banner.querySelectorAll('*')].filter((element) => !before.has(element));
    const besideMenu = added.filter((element) => element !== menu && !menu.contains(element));
    // What is added beside the menu has no role, no name, no text and takes no focus.
    for (const element of besideMenu) {
      expect(element.getAttribute('role')).toBeNull();
      expect(NAMING.filter((name) => element.hasAttribute(name))).toEqual([]);
      expect(element.textContent).toBe('');
      expect((element as HTMLElement).tabIndex).toBeLessThan(0);
      expect(element.matches(TAB_STOP)).toBe(false);
    }
    // The accessible elements beside the menu are those of before; nothing new but the menu can take focus.
    expect(accessibleIn(banner).filter((element) => !menu.contains(element))).toEqual(rolesBefore);
    const focusable = [...banner.querySelectorAll<HTMLElement>(TAB_STOP)].filter((element) => !before.has(element));
    expect(
      focusable.every((element) => menu.contains(element) && element.getAttribute('role') === 'menuitemradio'),
    ).toBe(true);
    // No text is added but the menu's.
    expect((banner.textContent ?? '').replace(menu.textContent, '')).toBe(textBefore);
  });

  it.each([
    ['Esc', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    ['a choice', async (user: ReturnType<typeof userEvent.setup>) => user.click(option('Browser language'))],
    ['a press outside', async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('main'))],
  ])(
    'the menu closed by %s: nothing of the menu or of what covered the page is left in the document',
    async (_n, close) => {
      const { user } = await openHome();
      const before = new Set(document.querySelectorAll('*'));
      await openMenu(user);

      await close(user);

      expect(screen.queryByRole('menu')).toBeNull();
      expect([...document.querySelectorAll('*')].filter((element) => !before.has(element))).toEqual([]);
    },
  );
});

/** The banner's link "EmuForge Studio" and the tile in it. */
function wordmark() {
  const link = within(screen.getByRole('banner')).getByRole('link', { name: 'EmuForge Studio' });
  const tiles = link.querySelectorAll('svg');
  expect(tiles).toHaveLength(1);
  return { link, tile: tiles[0] as SVGSVGElement };
}

/** Elements of `root` that draw an image: an image element, an embedded document or anything given the role. */
const IMAGE = 'img, picture, canvas, object, embed, iframe, image, [role="img"], [role^="graphics-"]';

describe('the tile in the wordmark link (issue #36, R6)', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  it('on /: the link to / holds the tile first, then "EmuForge" and "Studio", named exactly "EmuForge Studio"', () => {
    openFrame('/');
    const { link, tile } = wordmark();

    expect(link).toHaveAttribute('href', '/');
    expect(link).toHaveAccessibleName('EmuForge Studio');
    expect(link.firstElementChild).toBe(tile);
    const texts = [...link.querySelectorAll('*')]
      .filter((element) => !tile.contains(element) && element.children.length === 0)
      .map((element) => element.textContent.trim());
    expect(texts).toEqual(['EmuForge', 'Studio']);
    expect(follows(tile, screen.getByText('EmuForge'))).toBe(true);
  });

  it.each(['/', '/does-not-exist', '/aws', NO_SCREEN_SERVICE.below])(
    'on %s: the banner holds exactly one tile, inside the wordmark link, and no other image',
    async (path) => {
      openStudio(path);
      if (path.startsWith('/aws')) {
        await screen.findByRole('main', {}, { timeout: AREA_WAIT_MS });
      }
      const banner = screen.getByRole('banner');
      const { tile } = wordmark();

      expect(banner.querySelectorAll(IMAGE)).toHaveLength(0);
      // Every other drawing of the banner is a glyph of the language control's button, hidden as the tile is.
      const others = [...banner.querySelectorAll('svg')].filter((svg) => svg !== tile);
      for (const svg of others) {
        expect(svg.closest('.st-lang-btn'), 'an svg of the banner outside the language control').not.toBeNull();
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      }
      expect(banner.querySelectorAll('.st-tile')).toHaveLength(1);
    },
  );

  it.each(['de', 'th', 'pl'])(
    'in %s: the link is named exactly "EmuForge Studio" and the tile is as in English',
    (tag) => {
      // The clip's id is made per tile, unique in the document (ui/brand-tile.test.tsx); the rest is compared as it is.
      const markupOf = (tile: SVGSVGElement) => tile.outerHTML.replaceAll(tile.querySelector('[id]')?.id ?? '\0', 'ID');
      const english = openFrame('/');
      const markup = markupOf(wordmark().tile);
      english.unmount();

      openStudioIn('/does-not-exist', tag);
      const { link, tile } = wordmark();

      expect(document.documentElement.lang).toBe(tag);
      expect(link).toHaveAccessibleName('EmuForge Studio');
      expect(markupOf(tile)).toBe(markup);
    },
  );

  it('the text content of the wordmark link is "EmuForge Studio", the space inside the element that holds "Studio"', () => {
    openFrame('/');
    const { link } = wordmark();

    expect(link.textContent).toBe('EmuForge Studio');
    const studio = [...link.querySelectorAll('*')].find((element) => element.textContent.trim() === 'Studio');
    expect(studio?.textContent).toBe(' Studio');
  });

  it('Tab from the page’s start: the skip link, then the wordmark link; the tile is never focused', async () => {
    openFrame('/');
    const { link, tile } = wordmark();
    const user = userEvent.setup();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to content' }));
    await user.tab();
    expect(document.activeElement).toBe(link);
    expect(tile).toHaveAttribute('focusable', 'false');
    expect(tile).not.toHaveAttribute('tabindex');
    for (let step = 0; step < tabStops().length; step++) {
      await user.tab();
      expect(document.activeElement).not.toBe(tile);
      expect(tile.contains(document.activeElement)).toBe(false);
    }
  });
});

describe("the AWS area's connection, as the frame checks it (issue 45, R4.4)", () => {
  let engine: FakeEngine;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    engine = new FakeEngine();
    vi.stubGlobal('fetch', engine.fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const LINE = 'Local emulator, not AWS';

  /** The emulator line's status: the text of its status indicator. */
  function lineStatus(): string {
    const line = screen.getByRole('group', { name: LINE });
    return (createWrapper(line).findStatusIndicator()?.getElement().textContent ?? '').trim();
  }

  /** Studio at `path` under the AWS area, once its `h1` is shown. */
  async function openArea(path: string, h1: string) {
    const opened = openStudio(path);
    await vi.waitFor(
      async () => {
        await advance();
        expect(screen.getByRole('heading', { level: 1, name: h1 })).toBeInTheDocument();
      },
      { timeout: AREA_WAIT_MS, interval: 20 },
    );
    return opened;
  }

  it('on /aws: the line shows "Checking", then the answer\'s state once the engine has answered', async () => {
    engine.healthAnswers = [{ ...connected(9411), delayMs: 1_000 }];
    await openArea('/aws', 'Amazon Web Services');

    expect(lineStatus()).toBe('Checking');
    expect(engine.healths).toHaveLength(1);

    await advance(1_000);

    expect(lineStatus()).toBe('Connected at https://127.0.0.1:9411');
  });

  it('on /aws/kinesis, more than 5 seconds after an answer: a new request, and the line shows its answer', async () => {
    engine.healthAnswers = [connected(9411), emulatorDown('not_started', 9411)];
    await openArea(NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.label);
    await advance();
    expect(lineStatus()).toBe('Connected at https://127.0.0.1:9411');
    expect(engine.healths).toHaveLength(1);

    await advance(5_000);

    expect(engine.healths).toHaveLength(2);
    expect(lineStatus()).toBe('Not started on port 9411');
  });

  it('a route change inside the area within 5 seconds of an answer: the line keeps it, and no new request is made', async () => {
    engine.healthAnswers = [connected(9411)];
    const { router } = await openArea('/aws', 'Amazon Web Services');
    await advance();
    expect(lineStatus()).toBe('Connected at https://127.0.0.1:9411');

    await act(() => router.navigate(NO_SCREEN_SERVICE.path));
    await advance(2_000);
    expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN_SERVICE.label })).toBeInTheDocument();
    expect(lineStatus()).toBe('Connected at https://127.0.0.1:9411');
    await act(() => router.navigate('/aws'));
    await advance(2_900);

    expect(lineStatus()).toBe('Connected at https://127.0.0.1:9411');
    expect(engine.healths).toHaveLength(1);
    await advance(100);
    expect(engine.healths).toHaveLength(2);
  });

  it('a later check in flight after a connected answer: the line still reads "Connected at <endpoint>"', async () => {
    engine.healthAnswers = [connected(9411), { hang: true }];
    await openArea(NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.label);
    await advance();

    await advance(5_000);
    expect(engine.healths).toHaveLength(2);

    expect(lineStatus()).toBe('Connected at https://127.0.0.1:9411');
  });

  it('Home chosen in the frame: no further request for the area; Home asks for itself and shows "Checking" until it answers', async () => {
    engine.healthAnswers = [connected(9411)];
    await openArea(NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.label);
    await advance();
    expect(lineStatus()).toBe('Connected at https://127.0.0.1:9411');
    const areaChecks = engine.healths.length;
    // Home's own checks take a second each.
    engine.answerHealth({ ...connected(9411), delayMs: 1_000 });

    fireEvent.click(frameLinks().home);
    await advance();

    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(engine.healths).toHaveLength(areaChecks + 1);
    expect(row('Engine').status).toBe('Checking');
    expect(row('Emulator').status).toBe('Checking');
    await advance(1_000);
    expect(row('Emulator').status).toBe('Connected');

    // Only Home's rhythm from here: a check 5 seconds after each of its answers, each answered a second later.
    await advance(19_000);
    expect(engine.healths).toHaveLength(areaChecks + 4);
  });
});

describe("the area's target generation (issue 486, s1)", () => {
  let engine: FakeEngine;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    engine = new FakeEngine();
    vi.stubGlobal('fetch', engine.fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('the area is rendered with targetGeneration 0 on load, then the target seen’s generation, and is not mounted again', async () => {
    const seen: (number | undefined)[] = [];
    let mounts = 0;
    function ProbeArea({ targetGeneration }: ProviderAreaProps) {
      // A probe of the area's own state: set once per mount.
      const [mount] = useState(() => ++mounts);
      seen.push(targetGeneration);
      return (
        <main>
          <p>
            Mount {mount}, generation {String(targetGeneration)}
          </p>
        </main>
      );
    }
    engine.healthAnswers = [connectedTo('local'), connectedTo('second')];
    openStudio('/stub', [
      { element: <Frame />, children: [{ path: 'stub/*', element: <ProviderPage area={ProbeArea} /> }] },
    ]);
    await advance();
    expect(engine.healths).toHaveLength(1);
    expect(screen.getByText('Mount 1, generation 0')).toBeInTheDocument();
    expect(new Set(seen)).toEqual(new Set([0]));

    await advance(5_000);

    expect(engine.healths).toHaveLength(2);
    expect(screen.getByText('Mount 1, generation 1')).toBeInTheDocument();
    expect(seen.at(-1)).toBe(1);
    expect(mounts).toBe(1);
  });
});

describe('a dialog of the area and Studio’s bar (issue 531, s1)', () => {
  /**
   * A stub area with a button that opens a dialog in the area's own root, as the AWS area's modal root does, and tells
   * the frame through `onModal` while it is open. The dialog traps focus: Tab and Shift+Tab cycle among its buttons.
   */
  function DialogArea({ onPageTitle, onModal }: ProviderAreaProps) {
    const [open, setOpen] = useState(false);
    const close = useRef<HTMLButtonElement>(null);
    const opener = useRef<HTMLButtonElement>(null);
    useEffect(() => {
      onPageTitle('Stub page');
    }, [onPageTitle]);
    useEffect(() => {
      if (!open) {
        return;
      }
      const back = opener.current;
      onModal(true);
      close.current?.focus();
      return () => {
        onModal(false);
        back?.focus();
      };
    }, [open, onModal]);
    const trap = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Tab') {
        return;
      }
      const buttons = [...event.currentTarget.querySelectorAll('button')];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      event.preventDefault();
      buttons[next]?.focus();
    };
    return (
      <div data-testid="stub-root">
        <main>
          <button
            ref={opener}
            type="button"
            onClick={() => {
              setOpen(true);
            }}
          >
            Open dialog
          </button>
        </main>
        {open && (
          <div role="dialog" aria-modal="true" aria-label="Stub dialog" onKeyDown={trap}>
            <button
              ref={close}
              type="button"
              onClick={() => {
                setOpen(false);
              }}
            >
              Close
            </button>
            <button type="button">Keep</button>
          </div>
        )}
      </div>
    );
  }

  function openDialogArea() {
    return openStudio('/stub', [
      { element: <Frame />, children: [{ path: 'stub/*', element: <ProviderPage area={DialogArea} /> }] },
    ]);
  }

  /** The bar's controls: the wordmark, Home, Connections, AWS and the language control. */
  function barControls(): HTMLElement[] {
    const { banner, home, connections, aws } = frameLinks();
    return [within(banner).getByRole('link', { name: 'EmuForge Studio' }), home, connections, aws, languageControl()];
  }

  it('the stub area’s dialog open, trapping focus: 20 presses of Tab then 20 of Shift+Tab reach none of the bar’s controls, and the bar is inert while it is open', async () => {
    const user = userEvent.setup();
    openDialogArea();
    await user.click(await screen.findByRole('button', { name: 'Open dialog' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stub dialog' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    const banner = screen.getByRole('banner');
    expect(banner).toHaveAttribute('inert');
    expect(present(document.querySelector('.st-area'), 'the holder')).toHaveClass('st-area-modal');

    const controls = barControls();
    for (const key of ['{Tab}', '{Shift>}{Tab}{/Shift}']) {
      for (let press = 0; press < 20; press += 1) {
        await user.keyboard(key);
        expect(controls).not.toContain(document.activeElement);
        expect(banner.contains(document.activeElement)).toBe(false);
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
    }
  });

  it('the stub area’s dialog opened, then removed: each of the bar’s controls is found by its role and name, none disabled or hidden from assistive technology, and the language control opens its menu', async () => {
    const user = userEvent.setup();
    openDialogArea();
    await user.click(await screen.findByRole('button', { name: 'Open dialog' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stub dialog' });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    const banner = screen.getByRole('banner');
    expect(banner).not.toHaveAttribute('inert');
    expect(present(document.querySelector('.st-area'), 'the holder')).not.toHaveClass('st-area-modal');
    for (const control of barControls()) {
      expect(control).toBeEnabled();
      expect(control).not.toHaveAttribute('aria-disabled', 'true');
      expect(control.closest('[inert], [aria-hidden="true"]')).toBeNull();
    }

    await user.click(languageControl());
    expect(screen.getByRole('menu')).toHaveAccessibleName('Language');
    expect(languageControl()).toHaveAttribute('aria-expanded', 'true');
  });
});
