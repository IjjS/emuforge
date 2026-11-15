import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUNDLED_CATALOGUES } from '../i18n/bundled';
import { STORAGE_KEY } from '../i18n/language';
import { LanguageProvider } from '../i18n/language-provider';
import {
  buildOnceToggle,
  connected,
  connectionNotice,
  connectionSection,
  emulatorDown,
  FakeEngine,
  languageStore,
  present,
  textNotFrom,
} from '../test/home-test-kit';
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
const AREA_PATH = '/aws/s3';
const AREA_TITLE = 'Amazon Simple Storage Service';

describe('the frame in each of the twelve languages (R5.2, R2.7)', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
    document.title = '';
  });

  it.each([...BUNDLED_CATALOGUES.byTag.keys()])(
    "%s: from / to /does-not-exist the route change announces the catalogue's page title; to /aws/s3, the area's",
    async (tag) => {
      const { router } = openStudioIn('/', tag);

      await act(() => router.navigate('/does-not-exist'));
      await expectFocusOnTarget(messageIn(tag, 'notFound.title'), messageIn(tag, 'notFound.home'));

      await act(() => router.navigate('/'));
      await expectFocusOnTarget(messageIn(tag, 'home.title'), messageIn(tag, 'home.refresh'));
      await act(() => router.navigate(AREA_PATH));
      await screen.findByRole('heading', { level: 1, name: AREA_TITLE }, { timeout: AREA_LOAD_MS });
      await expectFocusOnTarget(AREA_TITLE, 'Go to Home');
    },
    20_000,
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
      { timeout: AREA_LOAD_MS },
    );
  }, 20_000);

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
        await screen.findByRole('heading', { level: 1, name: AREA_TITLE }, { timeout: AREA_LOAD_MS });
      }
      const { banner, nav } = frameLinks();
      const control = languageControl();

      expect(banner.contains(control)).toBe(true);
      expect(nav.contains(control)).toBe(false);
      expect(follows(nav, control)).toBe(true);
      expect(control.closest('.st-area')).toBeNull();
    },
    20_000,
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
