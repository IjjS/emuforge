import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import HelpPanel from '@cloudscape-design/components/help-panel';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../lib/engine/engine-client';
import { preloadArea } from '../../../test/area-preload';
import type { AreaConnection } from './components/emulator-line';
import { AreaModal } from './components/area-modal';
import { usePageFlash, type FlashResult } from './components/page-flash';
import { usePageHelp } from './components/page-help';
import { useShowsResources } from './components/page-resources';
import type { ServiceEntries } from './entries';
import AwsArea from './index';
import type { AreaScreen, ScreenPageProps } from './screens';
import { AREA_ROOT_CLASS } from './styles/root-class';
import { NO_SCREEN_SENTENCE, NO_SCREEN_SERVICE } from '../../../test/no-screen';
import { serviceLinks } from '../../../test/service-files';

/**
 * Whether the area's "no screen yet" page also renders a Cloudscape `Calendar` below its own content, so a case can
 * see what a component of the area formats; off unless a case turns it on.
 */
const extra = vi.hoisted(() => ({ calendar: false }));

vi.mock('./pages/no-screen-page', async (importOriginal) => {
  const original = await importOriginal<typeof import('./pages/no-screen-page')>();
  const { default: Calendar } = await import('@cloudscape-design/components/calendar');
  return {
    NoScreenPage: (props: Parameters<typeof original.NoScreenPage>[0]) => (
      <>
        <original.NoScreenPage {...props} />
        {extra.calendar && <Calendar value="2026-11-15" />}
      </>
    ),
  };
});

/** The area's screens as a case registers them; empty, as on `main`, unless a case adds one. */
const registry = vi.hoisted(() => ({ screens: [] as unknown[], entries: [] as ServiceEntries[] }));

vi.mock('./screens', () => ({ SCREENS: registry.screens }));
vi.mock('./entries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./entries')>()),
  ENTRIES: registry.entries,
}));

const { SCREENS: realScreens } = await preloadArea(() => vi.importActual<typeof import('./screens')>('./screens'));

const AWS = 'Amazon Web Services';
const NO_SCREEN = NO_SCREEN_SERVICE.label;
/** The `h1` and title of the "no screen yet" page below a service that has screens (issue 57, requirement R4.2). */
const NO_SCREEN_PART = 'No screen yet';

// The services as their folders give them (providers/aws/area/services/*/service.json), in the order of issue 386's
// requirement R13.2, each under /aws.
const SERVICES = serviceLinks();

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The operating system's colour scheme, as `matchMedia` reports it; `setDark` changes it while the page is open. */
class ColourScheme {
  dark = false;
  private readonly listeners = new Set<() => void>();

  readonly matchMedia = (query: string): MediaQueryList => {
    const list: Partial<MediaQueryList> = {
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: unknown) => {
        if (query === DARK_QUERY) {
          this.listeners.add(listener as () => void);
        }
      },
      removeEventListener: (_type: string, listener: unknown) => {
        this.listeners.delete(listener as () => void);
      },
    };
    Object.defineProperty(list, 'matches', { get: () => query === DARK_QUERY && this.dark });
    return list as MediaQueryList;
  };

  setDark(dark: boolean) {
    this.dark = dark;
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

/** The connection Studio hands the area, as a test sets it; each change re-renders the area as Studio's frame does. */
class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;

  /** Studio's count of changes of target (`targetGeneration`); `undefined` hands the area none, as before issue 486. */
  generation: number | undefined = undefined;

  /** A change of target seen by Studio: the new generation, with the answer that named it when one is given. */
  changeTarget(generation: number, value: AreaConnection = { ...this.value }) {
    this.generation = generation;
    this.set(value);
  }

  set(value: AreaConnection) {
    this.value = value;
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

const ENGINE_ORIGIN = 'http://127.0.0.1:8297';

/** A connected answer for the emulator on `port`, as the engine client maps it. */
function connectedAt(port: number): CheckResult {
  return {
    kind: 'connected',
    checkedAt: Date.now(),
    emulator: { port, endpoint: `https://127.0.0.1:${String(port)}` },
  };
}

let connection: Connection;
/** The area Studio renders: the one imported above, or one evaluated afresh, as on a fresh load of the document. */
let Area: typeof AwsArea = AwsArea;
let scheme: ColourScheme;
let titles: string[];
/** The function the area named last to focus its content target; `null` while it names none. */
let focusContent: (() => void) | null;
/** What the area told Studio through `onModal`, in order. */
let modals: boolean[];

beforeEach(() => {
  connection = new Connection();
  connection.value = { result: connectedAt(9297), engineOrigin: ENGINE_ORIGIN };
  scheme = new ColourScheme();
  vi.stubGlobal('matchMedia', scheme.matchMedia);
  titles = [];
  focusContent = null;
  modals = [];
});

function handleModal(open: boolean) {
  modals.push(open);
}

function handlePageTitle(title: string) {
  titles.push(title);
}

function handleContentTarget(focus: (() => void) | null) {
  focusContent = focus;
}

/**
 * The area with Studio's props, as Studio's frame hands them: the route changes counted as Studio counts them, one
 * more each time the path changes, none on the first render; the connection as the test sets it, connected by default.
 */
function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  let changes = seen.changes;
  if (seen.pathname !== pathname) {
    changes += 1;
    setSeen({ pathname, changes });
  }
  return (
    <Area
      headerSelector="#top-bar"
      onPageTitle={handlePageTitle}
      onContentTarget={handleContentTarget}
      onModal={handleModal}
      routeChanges={changes}
      connection={current}
      {...(connection.generation !== undefined && { targetGeneration: connection.generation })}
    />
  );
}

const NAVIGATION = 'nav, [role~="navigation"]';
const TAB_STOP = 'a[href], button, input, select, textarea, [tabindex]';

/** The Tab stops of the document, in document order (no element of the area sets a positive `tabindex`). */
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
 * page's one `main` and not that `main` here; no navigation in it or between it and the first content stop
 * `firstStop`; not a Tab stop. `[]` when nothing does.
 */
function contentTargetProblems(target: Element | null, name: string, firstStop: string): string[] {
  if (!(target instanceof HTMLElement) || target === document.body) {
    return [`the target is ${target === null ? 'nothing' : target.tagName.toLowerCase()}`];
  }
  const problems: string[] = [];
  const mains = screen.getAllByRole('main');
  const h1 = screen.getByRole('heading', { level: 1 });
  if (mains.length !== 1) {
    problems.push(`the page has ${String(mains.length)} main landmarks`);
  } else if (target === mains[0]) {
    problems.push("it is the area's main");
  } else if (!mains[0]?.contains(target)) {
    problems.push("it is outside the page's main");
  }
  if (h1.textContent !== name) {
    problems.push(`the h1 is "${String(h1.textContent)}", not "${name}"`);
  }
  if (target === h1) {
    expect(target).toHaveAccessibleName(name);
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
async function expectFocusOnTarget(name: string, firstStop: string) {
  await waitFor(() => {
    expect(contentTargetProblems(document.activeElement, name, firstStop)).toEqual([]);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio's Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const result = render(<RouterProvider router={router} />);
  return { ...result, router, wrapper: createWrapper(result.container) };
}

function breadcrumbs(wrapper: ReturnType<typeof createWrapper>): [string | null, string | null][] {
  return (wrapper.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((item) => {
    const element = item.getElement();
    const link = element.closest('a[href]') ?? element.querySelector('a[href]');
    return [element.textContent, link?.getAttribute('href') ?? null];
  });
}

function areaRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(`.${AREA_ROOT_CLASS}`);
  expect(root).not.toBeNull();
  return root as HTMLElement;
}

/** Every element of the document, `html` and `body` included, that carries a class starting `awsui`. */
function cloudscapeElements(): Element[] {
  return [...document.querySelectorAll('*')].filter((element) =>
    [...element.classList].some((name) => name.startsWith('awsui')),
  );
}

describe('the AWS area', () => {
  it('on /aws: the side navigation header and the services in label order, crumbs EmuForge (to /) then AWS, nothing active', () => {
    const { wrapper } = open('/aws');
    const navigation = wrapper.findSideNavigation();

    const header = navigation?.findHeaderLink()?.getElement();
    expect(header).toHaveTextContent(AWS);
    expect(header).toHaveAttribute('href', '/aws');
    const section = navigation?.findItemByIndex(1);
    expect(section?.findSectionTitle()?.getElement()).toHaveTextContent('Services');
    const links = (section?.findItems() ?? []).map((item) => {
      const link = item.findLink()?.getElement();
      return [link?.textContent, link?.getAttribute('href')];
    });
    expect(links).toEqual(SERVICES);
    expect(navigation?.findItemByIndex(2)).toBeNull();
    expect(breadcrumbs(wrapper).map(([text]) => text)).toEqual(['EmuForge', 'AWS']);
    expect(breadcrumbs(wrapper)[0]).toEqual(['EmuForge', '/']);
    expect(navigation?.findActiveLink()).toBeNull();
    expect(titles.at(-1)).toBe(AWS);
  });

  it('on /aws/kinesis/streams: crumbs EmuForge (to /), AWS (to /aws), then Kinesis, the current page, the service active', () => {
    const { wrapper } = open(NO_SCREEN_SERVICE.below);

    expect(breadcrumbs(wrapper)).toEqual([
      ['EmuForge', '/'],
      ['AWS', '/aws'],
      [NO_SCREEN_SERVICE.crumb, null],
    ]);
    const active = wrapper.findSideNavigation()?.findActiveLink()?.getElement();
    expect(active).toHaveTextContent(NO_SCREEN);
    expect(active).toHaveAttribute('href', NO_SCREEN_SERVICE.path);
    expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN })).toBeInTheDocument();
    expect(titles.at(-1)).toBe(NO_SCREEN);
  });

  it('on /aws/does-not-exist: crumbs EmuForge, AWS, then Page not found, nothing active', () => {
    const { wrapper } = open('/aws/does-not-exist');

    expect(breadcrumbs(wrapper).map(([text]) => text)).toEqual(['EmuForge', 'AWS', 'Page not found']);
    expect(wrapper.findSideNavigation()?.findActiveLink()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(titles.at(-1)).toBe('Page not found');
  });

  it('moves to a service chosen in the side navigation without loading the page', () => {
    const { wrapper, router } = open('/aws');
    const service = wrapper.findSideNavigation()?.findLinkByHref(NO_SCREEN_SERVICE.path)?.getElement();
    expect(service).toBeDefined();

    let followed = true;
    act(() => {
      followed = fireEvent.click(service as HTMLElement);
    });

    // A click whose default is prevented: the router moved, the browser did not load the address.
    expect(followed).toBe(false);
    expect(router.state.location.pathname).toBe(NO_SCREEN_SERVICE.path);
    expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN })).toBeInTheDocument();
    expect(wrapper.findSideNavigation()?.findActiveLink()?.getElement()).toHaveAttribute(
      'href',
      NO_SCREEN_SERVICE.path,
    );
  });

  it('has no tools panel and no toggle for one', () => {
    const { wrapper } = open(NO_SCREEN_SERVICE.path);
    const layout = wrapper.findAppLayout();

    expect(layout).not.toBeNull();
    expect(layout?.findTools()).toBeNull();
    expect(layout?.findToolsToggle()).toBeNull();
    expect(screen.queryByRole('button', { name: /tools|help panel/i })).toBeNull();
  });

  it("carries Cloudscape's dark mode on the area's root only, following the scheme while open", async () => {
    scheme.dark = true;
    const { container } = open(NO_SCREEN_SERVICE.path);
    const root = areaRoot(container);

    expect(root).toHaveClass('awsui-dark-mode');
    expect([...document.documentElement.classList]).toEqual([]);
    expect([...document.body.classList].filter((name) => name.startsWith('awsui-'))).toEqual([]);

    scheme.setDark(false);
    expect(root).not.toHaveClass('awsui-dark-mode');
    // Cloudscape's own overlays follow the root's mode through a mutation observer, a moment later.
    await waitFor(() => {
      expect(document.querySelector('.awsui-dark-mode')).toBeNull();
    });

    scheme.setDark(true);
    expect(root).toHaveClass('awsui-dark-mode');
    expect(document.body).not.toHaveClass('awsui-dark-mode');
    expect(document.documentElement).not.toHaveClass('awsui-dark-mode');
  });

  it('leaves no Cloudscape class in the document after leaving the area for /', async () => {
    scheme.dark = true;
    const { router } = open(NO_SCREEN_SERVICE.path);
    expect(cloudscapeElements().length).toBeGreaterThan(0);

    await act(() => router.navigate('/'));

    expect(screen.getByText("Studio's Home")).toBeInTheDocument();
    expect(cloudscapeElements()).toEqual([]);
    expect([...document.documentElement.classList].filter((name) => name.startsWith('awsui-'))).toEqual([]);
    expect([...document.body.classList].filter((name) => name.startsWith('awsui-'))).toEqual([]);
  });

  it.each([
    ['/aws', AWS, 'Amazon API Gateway'],
    [NO_SCREEN_SERVICE.path, NO_SCREEN, 'Go to Home'],
    ['/aws/does-not-exist', 'Page not found', 'Go to Home'],
  ])('on %s: names a content target named "%s", past its navigation, not its main', (path, name, firstStop) => {
    open(path);
    expect(focusContent).not.toBeNull();

    act(() => {
      focusContent?.();
    });

    expect(contentTargetProblems(document.activeElement, name, firstStop)).toEqual([]);
  });

  it(`on /aws, ${NO_SCREEN} chosen in the side navigation: focus on the content target named ${NO_SCREEN}`, async () => {
    const { wrapper } = open('/aws');
    const service = wrapper.findSideNavigation()?.findLinkByHref(NO_SCREEN_SERVICE.path)?.getElement();
    expect(service).toBeDefined();

    act(() => {
      (service as HTMLElement).focus();
      fireEvent.click(service as HTMLElement);
    });

    await expectFocusOnTarget(NO_SCREEN, 'Go to Home');
    expect(wrapper.findSideNavigation()?.findActiveLink()?.getElement()).toHaveTextContent(NO_SCREEN);
  });

  it('on /aws/kinesis, AWS chosen in the breadcrumbs: /aws and focus on the content target named Amazon Web Services', async () => {
    const { wrapper, router } = open(NO_SCREEN_SERVICE.path);
    const crumb = wrapper
      .findBreadcrumbGroup()
      ?.findBreadcrumbLinks()
      .map((item) => item.getElement())
      .map((element) => element.closest<HTMLElement>('a[href]') ?? element.querySelector<HTMLElement>('a[href]'))
      .find((link) => link?.textContent === 'AWS' && link.getAttribute('href') === '/aws');
    expect(crumb).toBeDefined();

    act(() => {
      crumb?.focus();
      fireEvent.click(crumb as HTMLElement);
    });

    expect(router.state.location.pathname).toBe('/aws');
    await expectFocusOnTarget(AWS, 'Amazon API Gateway');
  });

  it('on /aws, Amazon API Gateway chosen in Services: focus on the content target named Amazon API Gateway', async () => {
    open('/aws');
    const main = screen.getByRole('main');
    const link = within(main)
      .getAllByRole('link', { name: 'Amazon API Gateway' })
      .find((element) => element.closest(NAVIGATION) === null);
    expect(link).toBeDefined();

    act(() => {
      link?.focus();
      fireEvent.click(link as HTMLElement);
    });

    await expectFocusOnTarget('Amazon API Gateway', 'Go to Home');
  });

  it('on /aws/kinesis/streams, the service chosen in the side navigation: /aws/kinesis and focus on its content target', async () => {
    const { wrapper, router } = open(NO_SCREEN_SERVICE.below);
    const service = wrapper.findSideNavigation()?.findLinkByHref(NO_SCREEN_SERVICE.path)?.getElement();
    expect(service).toBeDefined();

    act(() => {
      (service as HTMLElement).focus();
      fireEvent.click(service as HTMLElement);
    });

    expect(router.state.location.pathname).toBe(NO_SCREEN_SERVICE.path);
    await expectFocusOnTarget(NO_SCREEN, 'Go to Home');
  });

  it.each(['/aws', NO_SCREEN_SERVICE.path, '/aws/does-not-exist'])(
    'on %s, a first render: focus is on the body and stays there once the area has rendered',
    async (path) => {
      open(path);
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      expect(document.activeElement).toBe(document.body);

      // The area's effects and Cloudscape's own have run.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(document.activeElement).toBe(document.body);
    },
  );
});

const PAGES: [string, string, string][] = [
  ['/aws', AWS, 'AWS'],
  [NO_SCREEN_SERVICE.path, NO_SCREEN, NO_SCREEN_SERVICE.crumb],
  ['/aws/does-not-exist', 'Page not found', 'Page not found'],
];

const LINE_LABEL = 'Local emulator, not AWS';

/** The crumb links of the breadcrumbs, by their text. */
function crumbLink(wrapper: ReturnType<typeof createWrapper>, text: string): HTMLElement | undefined {
  return (
    (wrapper.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? [])
      .map((item) => item.getElement())
      .map((element) => element.closest<HTMLElement>('a[href]') ?? element.querySelector<HTMLElement>('a[href]'))
      .find((link) => link?.textContent === text) ?? undefined
  );
}

function emulatorLine(): HTMLElement {
  return screen.getByRole('group', { name: LINE_LABEL });
}

function lineStatus(): string {
  return (createWrapper(emulatorLine()).findStatusIndicator()?.getElement().textContent ?? '').trim();
}

function liveRegionText(): string {
  return (document.querySelector('[aria-live="polite"]')?.textContent ?? '').trim();
}

describe('the AWS area from EmuForge (issue 45)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // The area asks nothing itself: what it shows of the connection is what Studio hands it.
    fetchSpy = vi.fn(() => Promise.reject(new TypeError('no network in this test')));
    vi.stubGlobal('fetch', fetchSpy);
  });

  it.each(PAGES)('on %s: the last crumb is the current page and is not a link', (path, _h1, last) => {
    const { wrapper } = open(path);

    const items = wrapper.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? [];
    const current = items.at(-1)?.getElement();
    expect(current?.textContent).toBe(last);
    expect(current?.closest('a[href]') ?? current?.querySelector('a[href]') ?? null).toBeNull();
    // Cloudscape's current page: no address to follow, marked current and unavailable to follow.
    const marked = current?.closest('[aria-current="page"]') ?? current?.querySelector('[aria-current="page"]');
    expect(marked).not.toBeNull();
    expect(marked).not.toHaveAttribute('href');
    expect(marked).toHaveAttribute('aria-disabled', 'true');
    expect(breadcrumbs(wrapper).at(-1)).toEqual([last, null]);
  });

  it.each(PAGES)(
    'on %s: no crumb reads Amazon Web Services; the h1 is still "%s" and the side navigation header Amazon Web Services',
    (path, h1) => {
      const { wrapper } = open(path);

      expect(breadcrumbs(wrapper).map(([text]) => text)).not.toContain(AWS);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(h1);
      expect(wrapper.findSideNavigation()?.findHeaderLink()?.getElement()).toHaveTextContent(AWS);
    },
  );

  it('on /aws/kinesis, EmuForge chosen in the crumbs: the path is /, without a reload of the document', () => {
    const { wrapper, router } = open(NO_SCREEN_SERVICE.path);
    const crumb = crumbLink(wrapper, 'EmuForge');
    expect(crumb).toHaveAttribute('href', '/');

    let followed = true;
    act(() => {
      followed = fireEvent.click(crumb as HTMLElement);
    });

    // A click whose default is prevented: the router moved, the browser did not load the address.
    expect(followed).toBe(false);
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText("Studio's Home")).toBeInTheDocument();
  });

  it('after a connected answer on /aws, Kinesis then AWS: each page reads "Connected at <endpoint>" at once, nothing said, nothing asked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      connection.value = { result: undefined, engineOrigin: ENGINE_ORIGIN };
      const { wrapper, router } = open('/aws');
      expect(lineStatus()).toBe('Checking');
      connection.set({ result: connectedAt(9411), engineOrigin: ENGINE_ORIGIN });
      expect(lineStatus()).toBe('Connected at https://127.0.0.1:9411');
      const statuses: string[] = [];
      const said: string[] = [];
      const observer = new MutationObserver(() => {
        statuses.push(lineStatus());
        said.push(liveRegionText());
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });

      act(() => {
        fireEvent.click(
          wrapper.findSideNavigation()?.findLinkByHref(NO_SCREEN_SERVICE.path)?.getElement() as HTMLElement,
        );
      });
      expect(router.state.location.pathname).toBe(NO_SCREEN_SERVICE.path);
      expect(lineStatus()).toBe('Connected at https://127.0.0.1:9411');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      act(() => {
        fireEvent.click(crumbLink(wrapper, 'AWS') as HTMLElement);
      });
      expect(router.state.location.pathname).toBe('/aws');
      expect(lineStatus()).toBe('Connected at https://127.0.0.1:9411');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_900);
      });
      observer.disconnect();

      expect(statuses.filter((status) => status !== 'Connected at https://127.0.0.1:9411')).toEqual([]);
      expect(said.filter((text) => text !== '')).toEqual([]);
      expect(liveRegionText()).toBe('');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(PAGES)(
    'on %s, connected: the line is inside the content target before the h1; the target is named by the h1; no notice',
    (path, h1) => {
      open(path);
      act(() => {
        focusContent?.();
      });
      const target = document.activeElement as HTMLElement;
      const heading = screen.getByRole('heading', { level: 1 });

      expect(target).toContainElement(emulatorLine());
      expect(follows(emulatorLine(), heading)).toBe(true);
      expect(emulatorLine().contains(heading)).toBe(false);
      expect(target).toHaveAccessibleName(h1);
      expect(target.getAttribute('aria-labelledby')).toBe(heading.id);
      expect(lineStatus()).toBe('Connected at https://127.0.0.1:9297');
      expect(screen.queryByText(/^These .+ are in your local emulator$/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'About the local emulator' })).toBeNull();
    },
  );

  it('on /aws, connected, with no screen registered: the description under the h1; "Services", the number of services, "No service has a Studio screen yet." and the links in one list, as on main', () => {
    const { wrapper } = open('/aws');

    const header = wrapper.findContentLayout()?.findHeader()?.findHeader();
    expect(header?.findHeadingText().getElement()).toHaveTextContent(AWS);
    expect(header?.findDescription()?.getElement()).toHaveTextContent(
      'EmuForge Studio works with a local emulator of AWS services. It is a stand-alone tool, not the AWS console and not an AWS feature.',
    );
    const container = wrapper.findContentLayout()?.findContent()?.findContainer();
    const services = container?.findHeader()?.findHeader();
    expect(services?.findHeadingText().getElement()).toHaveTextContent('Services');
    expect(services?.findCounter()?.getElement()).toHaveTextContent(`(${String(SERVICES.length)})`);
    expect(services?.findDescription()?.getElement()).toHaveTextContent('No service has a Studio screen yet.');
    const links = within(container?.findContent().getElement() as HTMLElement)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual(SERVICES);
  });

  it('on /aws with the real build\'s registry: the description of "Services" is the registry\'s sentence, not "No service has a Studio screen yet."; the emulator line, and neither the notice nor "About the local emulator" (issue 61, R4, R6)', () => {
    registry.screens.push(...realScreens);
    try {
      const registered = new Set(realScreens.map(({ service }) => service));
      const routes = SERVICES.map(([, path]) => path.replace(/^\/aws/, ''));
      const screens = routes.filter((route) => registered.has(route)).length;
      expect(screens).toBeGreaterThan(0);
      const count = String(SERVICES.length);
      const expected =
        screens === SERVICES.length
          ? 'Every service has a Studio screen.'
          : screens === 1
            ? `1 of ${count} services has a Studio screen.`
            : `${String(screens)} of ${count} services have a Studio screen.`;

      const { wrapper } = open('/aws');
      const container = wrapper.findContentLayout()?.findContent()?.findContainer();
      const description = container?.findHeader()?.findHeader()?.findDescription()?.getElement();
      expect(description).toHaveTextContent(expected);
      expect(description).not.toHaveTextContent('No service has a Studio screen yet.');
      expect(screen.queryByText('No service has a Studio screen yet.')).toBeNull();
      expect(emulatorLine()).toBeInTheDocument();
      expect(screen.queryByText(/^These .+ are in your local emulator$/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'About the local emulator' })).toBeNull();
    } finally {
      registry.screens.length = 0;
    }
  });

  it.each([
    [NO_SCREEN_SERVICE.path, NO_SCREEN_SENTENCE],
    ['/aws/does-not-exist', 'Studio has no page at /aws/does-not-exist.'],
  ])('on %s: "%s" with "Go to Home", as on main', (path, statement) => {
    open(path);
    const main = screen.getByRole('main');

    expect(main).toHaveTextContent(statement);
    expect(within(main).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });
});

describe('the local-emulator notice in the AWS area (issue 45, R5)', () => {
  const ABOUT = 'About the local emulator';
  const NOTICE = 'Local emulator notice';

  /** The resources the "no screen yet" page names to the area's frame, as a service screen does; none until set. */
  let resources: { word?: string } | null;

  /**
   * A fresh load of the document: the area's modules, and the notice's open state with them, evaluated anew, with a
   * "no screen yet" page that names `resources` through the fresh area's own `useShowsResources`.
   */
  async function freshLoad() {
    vi.resetModules();
    vi.doMock('./pages/no-screen-page', async (importOriginal) => {
      const original = await importOriginal<typeof import('./pages/no-screen-page')>();
      const { useShowsResources } = await import('./components/page-resources');
      function NamesResources({ word }: { word: string | undefined }) {
        useShowsResources(word);
        return null;
      }
      return {
        NoScreenPage: (props: Parameters<typeof original.NoScreenPage>[0]) => (
          <>
            <original.NoScreenPage {...props} />
            {resources !== null && <NamesResources word={resources.word} />}
          </>
        ),
      };
    });
    Area = (await import('./index')).default;
  }

  beforeEach(async () => {
    resources = null;
    await freshLoad();
  });

  afterEach(() => {
    vi.doUnmock('./pages/no-screen-page');
    Area = AwsArea;
  });

  function notice(): HTMLElement | null {
    return screen.queryByRole('region', { name: NOTICE });
  }

  function about(): HTMLElement {
    return within(emulatorLine()).getByRole('button', { name: ABOUT });
  }

  function closeNotice() {
    act(() => {
      fireEvent.click(within(notice() as HTMLElement).getByRole('button', { name: 'Close the local emulator notice' }));
    });
  }

  it('a page that names its resources "buckets", connected: the line ending with the (i) control, the notice, the h1', () => {
    resources = { word: 'buckets' };
    open(NO_SCREEN_SERVICE.path);
    act(() => {
      focusContent?.();
    });
    const target = document.activeElement as HTMLElement;
    const heading = screen.getByRole('heading', { level: 1 });
    const region = notice() as HTMLElement;

    expect(lineStatus()).toBe('Connected at https://127.0.0.1:9297');
    const controls = [...emulatorLine().querySelectorAll('a[href], button')];
    expect(controls).toEqual([about()]);
    expect(within(region).getByText('These buckets are in your local emulator')).toBeInTheDocument();
    expect(target).toContainElement(emulatorLine());
    expect(target).toContainElement(region);
    expect(follows(emulatorLine(), region)).toBe(true);
    expect(follows(region, heading)).toBe(true);
    expect(target).toHaveAccessibleName(NO_SCREEN);
  });

  it('a page that shows resources and names no word: "These resources are in your local emulator"', () => {
    resources = {};
    open(NO_SCREEN_SERVICE.path);

    expect(within(notice() as HTMLElement).getByText('These resources are in your local emulator')).toBeInTheDocument();
    expect(about()).toHaveAttribute('aria-expanded', 'true');
  });

  it('the notice closed on one page: still closed on another page that shows resources, the (i) control collapsed', async () => {
    resources = { word: 'buckets' };
    const { router } = open(NO_SCREEN_SERVICE.path);
    closeNotice();
    expect(notice()).toBeNull();

    await act(() => router.navigate(NO_SCREEN_SERVICE.below));

    expect(router.state.location.pathname).toBe(NO_SCREEN_SERVICE.below);
    expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN })).toBeInTheDocument();
    expect(notice()).toBeNull();
    expect(about()).toHaveAttribute('aria-expanded', 'false');
  });

  it('the notice closed, then the area rendered again as after a reload of the document: the notice is open', async () => {
    resources = { word: 'buckets' };
    const first = open(NO_SCREEN_SERVICE.path);
    closeNotice();
    expect(notice()).toBeNull();
    first.unmount();

    await freshLoad();
    open(NO_SCREEN_SERVICE.path);

    expect(notice()).not.toBeNull();
    expect(about()).toHaveAttribute('aria-expanded', 'true');
  });
});

/**
 * A browser whose language is `tag`: `navigator.language` and `navigator.languages`, and the locale `Intl` takes when
 * none is given (Cloudscape reads the browser's locale from `Intl.DateTimeFormat`). Returns what puts it back.
 */
function browserIn(tag: string): () => void {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(tag);
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue([tag]);
  const native = Intl.DateTimeFormat;
  function InBrowser(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return new native(locales ?? tag, options);
  }
  InBrowser.prototype = native.prototype;
  InBrowser.supportedLocalesOf = native.supportedLocalesOf.bind(native);
  Object.defineProperty(Intl, 'DateTimeFormat', { value: InBrowser, configurable: true, writable: true });
  return () => {
    Object.defineProperty(Intl, 'DateTimeFormat', { value: native, configurable: true, writable: true });
  };
}

describe('the AWS area in a document of another language (R7.2, R7.3)', () => {
  let restoreBrowser: (() => void) | null = null;

  afterEach(() => {
    restoreBrowser?.();
    restoreBrowser = null;
    extra.calendar = false;
    document.documentElement.lang = '';
    vi.restoreAllMocks();
  });

  it.each(['/aws', NO_SCREEN_SERVICE.path, '/aws/does-not-exist'])(
    'on %s with <html lang="ko">: the area\'s root carries lang="en"',
    (path) => {
      document.documentElement.lang = 'ko';
      const { container } = open(path);

      expect(areaRoot(container)).toHaveAttribute('lang', 'en');
      expect(screen.getByRole('heading', { level: 1 }).closest('[lang]')).toBe(areaRoot(container));
    },
  );

  it('with <html lang="ko"> and the browser in ko-KR: a Calendar in the area names its month and weekdays in English', () => {
    document.documentElement.lang = 'ko';
    restoreBrowser = browserIn('ko-KR');
    extra.calendar = true;
    const { wrapper } = open(NO_SCREEN_SERVICE.path);

    const calendar = wrapper.findCalendar();
    expect(calendar).not.toBeNull();
    expect(calendar?.findHeader().getElement()).toHaveTextContent('November 2026');
    const weekdays = [...(calendar?.getElement().querySelectorAll('thead th') ?? [])];
    expect(weekdays.map((cell) => cell.querySelector('[aria-hidden="true"]')?.textContent)).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
    ]);
    expect(weekdays.map((cell) => cell.textContent)).toEqual([
      'SunSunday',
      'MonMonday',
      'TueTuesday',
      'WedWednesday',
      'ThuThursday',
      'FriFriday',
      'SatSaturday',
    ]);
  });
});

describe('a console screen in the AWS area (issue 56, R5)', () => {
  const HELP_TEXT = 'Things are kept in your local emulator.';
  /** The text of Cloudscape's "Info" link, with the hidden separator it names itself with. */
  const INFO_TEXT = 'Info:';

  /** A test screen's page: its `h1` with an "Info" control that asks for its help, and a sentence. */
  function ThingsPage() {
    const openHelp = usePageHelp();
    return (
      <Header
        variant="h1"
        info={
          <Link variant="info" onFollow={() => openHelp()}>
            Info
          </Link>
        }
      >
        Things
      </Header>
    );
  }

  function ThingsHelp() {
    return (
      <HelpPanel header={<h2>Things</h2>}>
        <p>{HELP_TEXT}</p>
      </HelpPanel>
    );
  }

  /** A second test screen, without help, that names its resources "widgets". */
  function WidgetsPage() {
    useShowsResources('widgets');
    return <Header variant="h1">Widgets</Header>;
  }

  const NAVIGATION_OF_THINGS = {
    header: { text: 'Things of DynamoDB', href: '/aws/dynamodb' },
    items: [
      {
        type: 'section',
        text: 'Things',
        items: [
          { type: 'link', text: 'All things', href: '/aws/dynamodb/things' },
          { type: 'link', text: 'Widgets', href: '/aws/dynamodb/widgets' },
          { type: 'link', text: 'Other things', href: '/aws/dynamodb/other-things' },
        ],
      },
    ],
    activeHref: '/aws/dynamodb/things',
  } satisfies AreaScreen['navigation'];

  const THINGS: AreaScreen = {
    service: '/dynamodb',
    paths: ['/aws/dynamodb', '/aws/dynamodb/things'],
    title: 'Things',
    crumbs: [{ text: 'Things' }],
    navigation: NAVIGATION_OF_THINGS,
    help: ThingsHelp,
    Page: ThingsPage,
  };

  const WIDGETS: AreaScreen = {
    service: '/dynamodb',
    paths: ['/aws/dynamodb/widgets'],
    title: 'Widgets',
    crumbs: [{ text: 'Widgets' }],
    navigation: { ...NAVIGATION_OF_THINGS, activeHref: '/aws/dynamodb/widgets' },
    Page: WidgetsPage,
  };

  beforeEach(() => {
    registry.screens.push(THINGS, WIDGETS);
  });

  afterEach(() => {
    registry.screens.length = 0;
  });

  function navigationLinks(wrapper: ReturnType<typeof createWrapper>): [string | null, string | null][] {
    const navigation = wrapper.findSideNavigation()?.getElement() as HTMLElement;
    const header = wrapper.findSideNavigation()?.findHeaderLink()?.getElement();
    return within(navigation)
      .getAllByRole('link')
      .filter((link) => link !== header)
      .map((link) => [link.textContent, link.getAttribute('href')]);
  }

  function info(): HTMLElement {
    return screen.getByRole('button', { name: /^Info/ });
  }

  /** The open help panel, the region that holds the help text; Cloudscape keeps a closed one in the document, hidden. */
  function helpPanel(): HTMLElement | null {
    const panel = screen.queryByText(HELP_TEXT)?.closest('aside');
    return panel instanceof HTMLElement && panel.closest('[aria-hidden="true"]') === null ? panel : null;
  }

  function askForHelp() {
    act(() => {
      info().focus();
      fireEvent.click(info());
    });
  }

  it.each(THINGS.paths)(
    'on %s: the h1, the content target and the title reported to Studio are "Things"; crumbs EmuForge, AWS, DynamoDB, then Things, not a link',
    (path) => {
      const { wrapper } = open(path);
      act(() => {
        focusContent?.();
      });

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Things');
      expect(contentTargetProblems(document.activeElement, 'Things', INFO_TEXT)).toEqual([]);
      expect(titles.at(-1)).toBe('Things');
      expect(breadcrumbs(wrapper)).toEqual([
        ['EmuForge', '/'],
        ['AWS', '/aws'],
        ['DynamoDB', '/aws/dynamodb'],
        ['Things', null],
      ]);
    },
  );

  // Issue 480: a screen's crumbs and title may read the address's query, as S3's objects read `?prefix=`.
  it('a screen whose crumbs and title read the query, on /aws/dynamodb/shelves?part=a%2Fb: both carry the decoded value', () => {
    const shelves: AreaScreen = {
      ...WIDGETS,
      paths: ['/aws/dynamodb/shelves'],
      title: (_params, query) => `Shelf ${query.get('part') ?? ''}`,
      crumbs: (_params, query) => [
        { text: 'Shelves', href: '/aws/dynamodb/shelves' },
        { text: query.get('part') ?? '' },
      ],
    };
    registry.screens.push(shelves);
    const { wrapper } = open('/aws/dynamodb/shelves?part=a%2Fb');

    expect(titles.at(-1)).toBe('Shelf a/b');
    expect(breadcrumbs(wrapper)).toEqual([
      ['EmuForge', '/'],
      ['AWS', '/aws'],
      ['DynamoDB', '/aws/dynamodb'],
      ['Shelves', '/aws/dynamodb/shelves'],
      ['a/b', null],
    ]);
  });

  /** A shelf's page: its `h1`, then a button, new for each shelf, that opens the other shelf by the query alone. */
  function ShelfPage() {
    const { search } = useLocation();
    const navigate = useNavigate();
    const part = new URLSearchParams(search).get('part') ?? '';
    const other = part === 'a' ? 'b' : 'a';
    return (
      <SpaceBetween size="m">
        <Header variant="h1">{`Shelf ${part}`}</Header>
        <Button key={part} onClick={() => void navigate(`/aws/dynamodb/shelves?part=${other}`)}>
          {`Open ${other}`}
        </Button>
      </SpaceBetween>
    );
  }

  // Issue 480, critique P1: walking S3's folders changes `?prefix=` alone, and the link followed is gone.
  it('on /aws/dynamodb/shelves?part=a, a control that changes the query alone chosen: focus on the content target', async () => {
    registry.screens.push({ ...WIDGETS, paths: ['/aws/dynamodb/shelves'], Page: ShelfPage });
    const { router } = open('/aws/dynamodb/shelves?part=a');
    const button = screen.getByRole('button', { name: 'Open b' });

    act(() => {
      button.focus();
      fireEvent.click(button);
    });

    expect(router.state.location.search).toBe('?part=b');
    await expectFocusOnTarget('Shelf b', 'Open a');
  });

  it('on /aws/dynamodb/shelves?part=a, a page that moves focus itself on a change of the query: focus stays there', async () => {
    function FocusingShelfPage() {
      const { search } = useLocation();
      const navigate = useNavigate();
      const part = new URLSearchParams(search).get('part') ?? '';
      const field = useRef<HTMLInputElement>(null);
      useEffect(() => {
        if (part === 'b') {
          field.current?.focus();
        }
      }, [part]);
      return (
        <SpaceBetween size="m">
          <Header variant="h1">{`Shelf ${part}`}</Header>
          <Button key={part} onClick={() => void navigate('/aws/dynamodb/shelves?part=b')}>
            Open b
          </Button>
          <input ref={field} aria-label="Shelf name" />
        </SpaceBetween>
      );
    }
    registry.screens.push({ ...WIDGETS, paths: ['/aws/dynamodb/shelves'], Page: FocusingShelfPage });
    open('/aws/dynamodb/shelves?part=a');
    const button = screen.getByRole('button', { name: 'Open b' });

    act(() => {
      button.focus();
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Shelf name' }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Shelf name' }));
  });

  it.each(THINGS.paths)(
    "on %s: the side navigation is the screen's header and links, All things current, none of the services",
    (path) => {
      const { wrapper } = open(path);
      const navigation = wrapper.findSideNavigation();

      const header = navigation?.findHeaderLink()?.getElement();
      expect(header).toHaveTextContent('Things of DynamoDB');
      expect(header).toHaveAttribute('href', '/aws/dynamodb');
      expect(navigation?.findItemByIndex(1)?.findSectionTitle()?.getElement()).toHaveTextContent('Things');
      expect(navigationLinks(wrapper)).toEqual([
        ['All things', '/aws/dynamodb/things'],
        ['Widgets', '/aws/dynamodb/widgets'],
        ['Other things', '/aws/dynamodb/other-things'],
      ]);
      expect(navigation?.findActiveLink()?.getElement()).toHaveAttribute('href', '/aws/dynamodb/things');
      const texts = navigationLinks(wrapper).map(([text]) => text);
      const hrefs = navigationLinks(wrapper).map(([, href]) => href);
      for (const [label, route] of SERVICES) {
        expect(texts).not.toContain(label);
        expect(hrefs).not.toContain(route);
      }
    },
  );

  // Issue 57 (test-criteria.md, "Unit — providers/aws/area/area-layout.test.tsx", rewritten): the page says that
  // this part of the service has no screen, not the service.
  it('on /aws/dynamodb/other-things, a path of the service no screen matches: the "no screen yet" page for this part of the service', () => {
    open('/aws/dynamodb/other-things');

    expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN_PART })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Studio has no screen for this part of Amazon DynamoDB yet.');
    expect(screen.getByRole('main')).not.toHaveTextContent('Studio has no screen for Amazon DynamoDB yet.');
    expect(titles.at(-1)).toBe(NO_SCREEN_PART);
  });

  it.each(['/aws', NO_SCREEN_SERVICE.path, '/aws/does-not-exist'])(
    'on %s: the services list as navigation and no help toggle, as before',
    (path) => {
      const { wrapper } = open(path);

      expect(wrapper.findSideNavigation()?.findHeaderLink()?.getElement()).toHaveTextContent(AWS);
      expect(navigationLinks(wrapper)).toEqual(SERVICES);
      expect(wrapper.findAppLayout()?.findToolsToggle()).toBeNull();
      expect(screen.queryByRole('button', { name: /help panel/i })).toBeNull();
    },
  );

  it.each([
    ['/aws/dynamodb/things', '/aws/dynamodb/other-things', NO_SCREEN_PART, 'Go to Things'],
    ['/aws/dynamodb', '/aws/dynamodb/things', 'Things', INFO_TEXT],
  ])(
    'on %s, %s chosen in the screen\'s navigation: the path changes without a document load, focus on the content target "%s"',
    async (path, href, name, firstStop) => {
      const { wrapper, router } = open(path);
      const link = wrapper.findSideNavigation()?.findLinkByHref(href)?.getElement();
      expect(link).toBeDefined();

      let followed = true;
      act(() => {
        (link as HTMLElement).focus();
        followed = fireEvent.click(link as HTMLElement);
      });

      expect(followed).toBe(false);
      expect(router.state.location.pathname).toBe(href);
      await expectFocusOnTarget(name, firstStop);
    },
  );

  it('on a screen that gives help: a toggle named "Open help panel", the panel closed', () => {
    const { wrapper } = open('/aws/dynamodb/things');

    const toggle = wrapper.findAppLayout()?.findToolsToggle()?.getElement();
    expect(toggle).toHaveAccessibleName('Open help panel');
    expect(helpPanel()).toBeNull();
  });

  it('the screen asks for its help: the panel opens with its help, focus inside it, the toggle named "Close help panel"', async () => {
    const { wrapper } = open('/aws/dynamodb/things');

    askForHelp();

    const panel = helpPanel();
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByText(HELP_TEXT)).toBeInTheDocument();
    await waitFor(() => {
      expect(panel).toContainElement(document.activeElement as HTMLElement);
    });
    expect(wrapper.findAppLayout()?.findToolsToggle()?.getElement()).toHaveAccessibleName('Close help panel');
  });

  it('the panel opened by "Info", then closed: it is gone and focus is on "Info"', async () => {
    const { wrapper } = open('/aws/dynamodb/things');
    askForHelp();
    await waitFor(() => {
      expect(helpPanel()).toContainElement(document.activeElement as HTMLElement);
    });

    act(() => {
      fireEvent.click(wrapper.findAppLayout()?.findToolsClose()?.getElement() as HTMLElement);
    });

    expect(helpPanel()).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(info());
    });
  });

  it('the panel opened by its toggle, then closed: it is gone and focus is on the toggle', async () => {
    const { wrapper } = open('/aws/dynamodb/things');
    const toggle = () => wrapper.findAppLayout()?.findToolsToggle()?.getElement() as HTMLElement;
    act(() => {
      toggle().focus();
      fireEvent.click(toggle());
    });
    expect(helpPanel()).not.toBeNull();

    act(() => {
      fireEvent.click(wrapper.findAppLayout()?.findToolsClose()?.getElement() as HTMLElement);
    });

    expect(helpPanel()).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(toggle());
    });
  });

  it.each([
    ['/aws/dynamodb/other-things', NO_SCREEN_PART],
    ['/aws/dynamodb/widgets', 'Widgets'],
  ])('the panel open, then %s chosen, a page without help: no panel and no toggle', (href, h1) => {
    const { wrapper, router } = open('/aws/dynamodb/things');
    askForHelp();
    expect(helpPanel()).not.toBeNull();

    act(() => {
      fireEvent.click(wrapper.findSideNavigation()?.findLinkByHref(href)?.getElement() as HTMLElement);
    });

    expect(router.state.location.pathname).toBe(href);
    expect(screen.getByRole('heading', { level: 1, name: h1 })).toBeInTheDocument();
    expect(helpPanel()).toBeNull();
    expect(wrapper.findAppLayout()?.findToolsToggle()).toBeNull();
    expect(screen.queryByRole('button', { name: /help panel/i })).toBeNull();
  });

  it('a screen that names its resources: the emulator line, then the notice, then the h1, inside the content target', () => {
    open('/aws/dynamodb/widgets');
    act(() => {
      focusContent?.();
    });
    const target = document.activeElement as HTMLElement;
    const notice = screen.getByRole('region', { name: 'Local emulator notice' });
    const heading = screen.getByRole('heading', { level: 1 });

    expect(target).toHaveAccessibleName('Widgets');
    expect(within(notice).getByText('These widgets are in your local emulator')).toBeInTheDocument();
    expect(target).toContainElement(emulatorLine());
    expect(target).toContainElement(notice);
    expect(target).toContainElement(heading);
    expect(follows(emulatorLine(), notice)).toBe(true);
    expect(follows(notice, heading)).toBe(true);
  });
});

// Test screens of issue 386 (requirement R4), under Amazon Kinesis, a service of the list with no product screen.
const KINESIS_NAVIGATION = {
  header: { text: 'Things of Kinesis', href: '/aws/kinesis' },
  items: [{ type: 'link', text: 'Things', href: '/aws/kinesis/things' }],
  activeHref: '/aws/kinesis/things',
} satisfies AreaScreen['navigation'];

const THINGS_PATH = '/aws/kinesis/things';

/** A thing's page, its name as one segment, percent-encoded once, as a screen writes a crumb's address. */
function thingPath(name: string): string {
  return `${THINGS_PATH}/thing/${encodeURIComponent(name)}`;
}

/** What the page reads of its address: the query. */
function QueryText() {
  const { search } = useLocation();
  return <p data-testid="query">{search}</p>;
}

/** A thing's page: its name as the `h1`, then the query it reads. Names no resources; gives no help. */
function ThingPage({ params }: ScreenPageProps) {
  return (
    <>
      <Header variant="h1">{params.name}</Header>
      <QueryText />
    </>
  );
}

/** A thing's edit page: an `h1` of its own, not the title. */
function EditThingPage({ params }: ScreenPageProps) {
  return (
    <>
      <Header variant="h1">Step 1: Edit settings</Header>
      <p data-testid="editing">{params.name}</p>
    </>
  );
}

const THING: AreaScreen = {
  service: '/kinesis',
  paths: ['/aws/kinesis/things/thing/{name}'],
  title: (params) => params.name ?? '',
  crumbs: (params) => [{ text: 'Things', href: THINGS_PATH }, { text: params.name ?? '' }],
  navigation: KINESIS_NAVIGATION,
  Page: ThingPage,
};

const EDIT_THING: AreaScreen = {
  service: '/kinesis',
  paths: ['/aws/kinesis/things/thing/{name}/edit'],
  title: (params) => `Edit ${params.name ?? ''}`,
  crumbs: (params) => [
    { text: 'Things', href: THINGS_PATH },
    { text: params.name ?? '', href: thingPath(params.name ?? '') },
    { text: 'Edit' },
  ],
  navigation: KINESIS_NAVIGATION,
  Page: EditThingPage,
};

/** `…/things/create` and `…/things/{name}`: two patterns that both match `…/things/create`. */
const CREATE_THING: AreaScreen = {
  service: '/kinesis',
  paths: ['/aws/kinesis/things/create'],
  title: 'Create thing',
  crumbs: [{ text: 'Things', href: THINGS_PATH }, { text: 'Create thing' }],
  navigation: KINESIS_NAVIGATION,
  Page: () => <Header variant="h1">Create thing</Header>,
};

const NAMED_THING: AreaScreen = {
  service: '/kinesis',
  paths: ['/aws/kinesis/things/{name}'],
  title: (params) => `Thing ${params.name ?? ''}`,
  crumbs: (params) => [{ text: 'Things', href: THINGS_PATH }, { text: params.name ?? '' }],
  navigation: KINESIS_NAVIGATION,
  Page: ({ params }) => <Header variant="h1">{`Thing ${params.name ?? ''}`}</Header>,
};

/** A screen at two fixed paths, as before issue 386. */
const GADGETS: AreaScreen = {
  service: '/kinesis',
  paths: ['/aws/kinesis/gadgets', '/aws/kinesis/gadgets/all'],
  title: 'Gadgets',
  crumbs: [{ text: 'Gadgets' }],
  navigation: { ...KINESIS_NAVIGATION, activeHref: '/aws/kinesis/gadgets' },
  Page: () => <Header variant="h1">Gadgets</Header>,
};

/** Two crumbs below the service, the first with an address. */
const PAIR: AreaScreen = {
  service: '/kinesis',
  paths: ['/aws/kinesis/pairs/one'],
  title: 'One pair',
  crumbs: [{ text: 'Pairs', href: '/aws/kinesis/pairs' }, { text: 'One pair' }],
  navigation: KINESIS_NAVIGATION,
  Page: () => <Header variant="h1">One pair</Header>,
};

/** A last crumb given an address. */
const LAST_WITH_ADDRESS: AreaScreen = {
  service: '/kinesis',
  paths: ['/aws/kinesis/last'],
  title: 'Last',
  crumbs: [{ text: 'Last', href: '/aws/kinesis/elsewhere' }],
  navigation: KINESIS_NAVIGATION,
  Page: () => <Header variant="h1">Last</Header>,
};

/** The side navigation's links, the header's left out. */
function sideLinks(wrapper: ReturnType<typeof createWrapper>): [string | null, string | null][] {
  const navigation = wrapper.findSideNavigation()?.getElement() as HTMLElement;
  const header = wrapper.findSideNavigation()?.findHeaderLink()?.getElement();
  return within(navigation)
    .getAllByRole('link')
    .filter((link) => link !== header)
    .map((link) => [link.textContent, link.getAttribute('href')]);
}

/** The crumbs every page of the area starts with, then Kinesis. */
const KINESIS_CRUMBS: [string, string | null][] = [
  ['EmuForge', '/'],
  ['AWS', '/aws'],
  ['Kinesis', '/aws/kinesis'],
];

/**
 * Expects the "no screen yet" page for a part of Amazon Kinesis, which has the test screens here (issue 57,
 * requirement R4): no screen opened (the `h1` and the reported title "No screen yet"), the statement for this part of
 * the service and not the sentence that it has none, the navigation of the screens ("Things of Kinesis") and none of
 * the services, and the crumbs EmuForge, AWS, Kinesis, then `above` (the crumbs of the screen above the path, every
 * one a link), then "No screen yet", not a link.
 */
function expectNoScreenPart(wrapper: ReturnType<typeof createWrapper>, above: [string, string][] = []) {
  expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN_PART })).toBeInTheDocument();
  expect(titles.at(-1)).toBe(NO_SCREEN_PART);
  expect(screen.getByRole('main')).toHaveTextContent(`Studio has no screen for this part of ${NO_SCREEN} yet.`);
  expect(screen.getByRole('main')).not.toHaveTextContent(NO_SCREEN_SENTENCE);
  expect(wrapper.findSideNavigation()?.findHeaderLink()?.getElement()).toHaveTextContent('Things of Kinesis');
  const links = sideLinks(wrapper);
  for (const [label, route] of SERVICES) {
    expect(links.map(([text]) => text)).not.toContain(label);
    expect(links.map(([, href]) => href)).not.toContain(route);
  }
  expect(breadcrumbs(wrapper)).toEqual([...KINESIS_CRUMBS, ...above, [NO_SCREEN_PART, null]]);
}

describe('paths and parameters (issue 386, R4.1 to R4.5, R4.7, R4.9)', () => {
  beforeEach(() => {
    registry.screens.push(THING, EDIT_THING, CREATE_THING, NAMED_THING, GADGETS);
  });

  afterEach(() => {
    registry.screens.length = 0;
  });

  function h1(): HTMLElement {
    return screen.getByRole('heading', { level: 1 });
  }

  it('a screen at /aws/kinesis/things/thing/{name}, opened with "my thing" percent-encoded: the h1, the content target and the title are "my thing"; the crumbs end with Things as a link, then "my thing", not a link', () => {
    const { wrapper } = open(thingPath('my thing'));
    act(() => {
      focusContent?.();
    });

    expect(h1()).toHaveTextContent(/^my thing$/);
    expect(document.activeElement).toHaveAccessibleName('my thing');
    expect(titles.at(-1)).toBe('my thing');
    expect(breadcrumbs(wrapper)).toEqual([...KINESIS_CRUMBS, ['Things', THINGS_PATH], ['my thing', null]]);
  });

  it('the screen below it, …/{name}/edit: the crumbs end with "my thing" as a link to the first screen, then "Edit", not a link; the title "Edit my thing", the h1 the page\'s own', () => {
    const { wrapper } = open(`${thingPath('my thing')}/edit`);

    expect(breadcrumbs(wrapper)).toEqual([
      ...KINESIS_CRUMBS,
      ['Things', THINGS_PATH],
      ['my thing', thingPath('my thing')],
      ['Edit', null],
    ]);
    expect(titles.at(-1)).toBe('Edit my thing');
    expect(h1()).toHaveTextContent(/^Step 1: Edit settings$/);
  });

  it('a name that holds /, ?, #, % and a space, each percent-encoded: shown decoded once, as text, in the h1 and the crumb', () => {
    const name = 'a/b?c#d%e f';
    const { wrapper } = open(`${THINGS_PATH}/thing/a%2Fb%3Fc%23d%25e%20f`);

    expect(h1()).toHaveTextContent(name, { normalizeWhitespace: false });
    expect(h1().textContent).toBe(name);
    expect(breadcrumbs(wrapper).at(-1)).toEqual([name, null]);
  });

  it('the name %2541: the h1 reads %41', () => {
    open(`${THINGS_PATH}/thing/%2541`);

    expect(h1().textContent).toBe('%41');
  });

  it("on the screen below such a name, the name's crumb followed: its address holds the name percent-encoded once as one segment, and the first screen shows the same name", async () => {
    const name = 'a/b?c#d%e f';
    const { wrapper, router } = open(`${thingPath(name)}/edit`);
    const link = crumbLink(wrapper, name);
    expect(link).toHaveAttribute('href', `${THINGS_PATH}/thing/a%2Fb%3Fc%23d%25e%20f`);

    act(() => {
      fireEvent.click(link as HTMLElement);
    });

    expect(router.state.location.pathname).toBe(`${THINGS_PATH}/thing/a%2Fb%3Fc%23d%25e%20f`);
    await waitFor(() => {
      expect(h1().textContent).toBe(name);
    });
    expect(titles.at(-1)).toBe(name);
  });

  it('a name of 255 characters without a space: the h1 and the crumb hold the whole name', () => {
    const name = 'x'.repeat(255);
    const { wrapper } = open(thingPath(name));

    expect(h1().textContent).toBe(name);
    expect(breadcrumbs(wrapper).at(-1)).toEqual([name, null]);
  });

  it('a name that holds markup: the title, the h1 and the crumb show it as text; no element is created from it', () => {
    const name = '<img src=x onerror=alert(1)><b>bold</b>';
    const { wrapper, container } = open(thingPath(name));

    expect(titles.at(-1)).toBe(name);
    expect(h1().textContent).toBe(name);
    expect(breadcrumbs(wrapper).at(-1)).toEqual([name, null]);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it.each(['%zz', '%E0%A4%A'])(
    'a name that is not valid percent-encoding (%s): the area\'s "Page not found", its h1, crumbs, navigation and title, and the address as text',
    (segment) => {
      const address = `${THINGS_PATH}/thing/${segment}`;
      const { wrapper } = open(address);

      expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
      expect(breadcrumbs(wrapper)).toEqual([
        ['EmuForge', '/'],
        ['AWS', '/aws'],
        ['Page not found', null],
      ]);
      expect(wrapper.findSideNavigation()?.findHeaderLink()?.getElement()).toHaveTextContent(AWS);
      expect(sideLinks(wrapper)).toEqual(SERVICES);
      expect(wrapper.findSideNavigation()?.findActiveLink()).toBeNull();
      expect(titles.at(-1)).toBe('Page not found');
      expect(screen.getByRole('main').textContent?.replace(/\s/g, '')).toContain(
        `Studio has no page at ${address}.`.replace(/\s/g, ''),
      );
    },
  );

  // Issue 57 (test-criteria.md, "Unit — providers/aws/area/area-layout.test.tsx", the Kinesis lines rewritten): each
  // path below opens no screen, as issue 386 asks, and shows the "no screen yet" page for that part of the service.
  it.each(['/aws/kinesis/%zz', '/aws/kinesis/gadget', NO_SCREEN_SERVICE.below])(
    '%s, which no pattern matches and no screen is above: the "no screen yet" page for this part of the service, no navigation link current',
    (address) => {
      const { wrapper } = open(address);

      expectNoScreenPart(wrapper);
      expect(wrapper.findSideNavigation()?.findActiveLink()).toBeNull();
    },
  );

  it(`${THINGS_PATH}, which no pattern matches, the address of the navigation's "Things": the same page, "Things" current`, () => {
    const { wrapper } = open(THINGS_PATH);

    expectNoScreenPart(wrapper);
    expect(wrapper.findSideNavigation()?.findActiveLink()?.getElement()).toHaveAttribute('href', THINGS_PATH);
  });

  it('with screens at …/things/create and …/things/{name}: …/things/create opens the first, …/things/other the second with the name "other"', () => {
    const first = open(`${THINGS_PATH}/create`);
    expect(h1().textContent).toBe('Create thing');
    expect(titles.at(-1)).toBe('Create thing');
    first.unmount();

    open(`${THINGS_PATH}/other`);
    expect(h1().textContent).toBe('Thing other');
    expect(titles.at(-1)).toBe('Thing other');
  });

  it.each<[string, [string, string][]]>([
    // One more than …/thing/{name} and …/things/{name}, and an empty parameter (one fewer is the case above).
    [
      `${THINGS_PATH}/thing/a/b`,
      [
        ['Things', THINGS_PATH],
        ['a', `${THINGS_PATH}/thing/a`],
      ],
    ],
    [
      `${THINGS_PATH}/a/b`,
      [
        ['Things', THINGS_PATH],
        ['a', `${THINGS_PATH}/a`],
      ],
    ],
    [
      `${THINGS_PATH}/thing/`,
      [
        ['Things', THINGS_PATH],
        ['thing', `${THINGS_PATH}/thing`],
      ],
    ],
  ])(
    '%s, one segment more than a pattern with a parameter, or an empty one: the "no screen yet" page with the crumbs of the screen above',
    (address, above) => {
      const { wrapper } = open(address);

      expectNoScreenPart(wrapper, above);
    },
  );

  it("a screen's route with a query: the same screen; the name does not hold the query, and the page reads it", () => {
    open(`${thingPath('my thing')}?tab=tags&sort=name`);

    expect(h1().textContent).toBe('my thing');
    expect(titles.at(-1)).toBe('my thing');
    expect(screen.getByTestId('query')).toHaveTextContent('?tab=tags&sort=name');
  });

  it.each(GADGETS.paths)('a screen with fixed paths, on %s: its title, crumbs and navigation as before', (path) => {
    const { wrapper } = open(path);

    expect(h1().textContent).toBe('Gadgets');
    expect(titles.at(-1)).toBe('Gadgets');
    expect(breadcrumbs(wrapper)).toEqual([...KINESIS_CRUMBS, ['Gadgets', null]]);
    expect(wrapper.findSideNavigation()?.findHeaderLink()?.getElement()).toHaveTextContent('Things of Kinesis');
    expect(sideLinks(wrapper)).toEqual([['Things', '/aws/kinesis/things']]);
  });

  it.each<[string, [string, string][]]>([
    ['/aws/kinesis/gadgets/other', [['Gadgets', '/aws/kinesis/gadgets']]],
    ['/aws/kinesis/gadgets/all/more', [['Gadgets', '/aws/kinesis/gadgets/all']]],
  ])(
    'a screen with fixed paths is at no other path: %s shows the "no screen yet" page with the crumbs of the screen above',
    (address, above) => {
      const { wrapper } = open(address);

      expectNoScreenPart(wrapper, above);
    },
  );

  it("a screen whose title is a function of the name: the title reported to Studio's frame is its text for the decoded name", () => {
    open(`${thingPath('a/b c')}/edit`);

    expect(titles.at(-1)).toBe('Edit a/b c');
    expect(screen.getByTestId('editing').textContent).toBe('a/b c');
  });
});

describe('crumbs and resources (issue 386, R4.6, R4.8)', () => {
  beforeEach(() => {
    registry.screens.push(THING, PAIR, LAST_WITH_ADDRESS);
  });

  afterEach(() => {
    registry.screens.length = 0;
  });

  it('a screen that gives two crumbs below its service, the first with an address: EmuForge, AWS, Kinesis, then the two in order, the first a link to its address, the last no link', () => {
    const { wrapper } = open('/aws/kinesis/pairs/one');

    expect(breadcrumbs(wrapper)).toEqual([...KINESIS_CRUMBS, ['Pairs', '/aws/kinesis/pairs'], ['One pair', null]]);
    expect(crumbLink(wrapper, 'Pairs')).toHaveAttribute('href', '/aws/kinesis/pairs');
    expect(crumbLink(wrapper, 'One pair')).toBeUndefined();
  });

  it('a screen whose last crumb was given an address: the last crumb is still not a link', () => {
    const { wrapper } = open('/aws/kinesis/last');

    expect(breadcrumbs(wrapper)).toEqual([...KINESIS_CRUMBS, ['Last', null]]);
    expect(crumbLink(wrapper, 'Last')).toBeUndefined();
    expect(document.querySelector('a[href="/aws/kinesis/elsewhere"]')).toBeNull();
  });

  it('a screen that names no resources: the emulator line, and neither the notice nor the (i) control', () => {
    open(thingPath('my thing'));

    expect(emulatorLine()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Local emulator notice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'About the local emulator' })).toBeNull();
  });

  it('a screen without help: no help panel and no toggle, as before', () => {
    const { wrapper } = open(thingPath('my thing'));

    expect(wrapper.findAppLayout()?.findToolsToggle()).toBeNull();
    expect(screen.queryByRole('button', { name: /help panel/i })).toBeNull();
  });
});

// Test screens of the area's flash (issue 386, R5), under Amazon Kinesis.
const FLASHES_PATH = '/aws/kinesis/flashes';
const TARGET_PATH = '/aws/kinesis/flashes/target';
const ELSEWHERE_PATH = '/aws/kinesis/flashes/elsewhere';

/** What the page's controls do: the result "Act" shows or "Hand over" hands, where to, and a path to go to after. */
const flashCase = {
  result: [{ type: 'success', content: 'Thing created' }] as FlashResult,
  handTo: TARGET_PATH,
  thenTo: undefined as string | undefined,
  /** The fresh area's `usePageFlash`, after a fresh load of the document; the one imported above otherwise. */
  usePageFlash,
};

/** A screen's page that names its resources (so the notice is open) and shows or hands a result on its controls. */
function FlashPage({ title }: { title: string }) {
  useShowsResources('things');
  const flash = flashCase.usePageFlash();
  const navigate = useNavigate();
  return (
    <>
      <Header variant="h1">{title}</Header>
      <SpaceBetween direction="horizontal" size="xs">
        <Button
          onClick={() => {
            flash.show(flashCase.result);
          }}
        >
          Act
        </Button>
        <Button
          onClick={() => {
            flash.handOver(flashCase.handTo, flashCase.result);
            if (flashCase.thenTo !== undefined) {
              void navigate(flashCase.thenTo);
            }
          }}
        >
          Hand over
        </Button>
      </SpaceBetween>
      <QueryText />
    </>
  );
}

function flashScreen(path: string, title: string): AreaScreen {
  return {
    service: '/kinesis',
    paths: [path],
    title,
    crumbs: [{ text: title }],
    navigation: KINESIS_NAVIGATION,
    Page: () => <FlashPage title={title} />,
  };
}

const FLASHES = flashScreen(FLASHES_PATH, 'Flashes');
const TARGET = flashScreen(TARGET_PATH, 'Target');
const ELSEWHERE = flashScreen(ELSEWHERE_PATH, 'Elsewhere');

describe('the flash (issue 386, R5)', () => {
  beforeEach(() => {
    registry.screens.push(FLASHES, TARGET, ELSEWHERE);
    flashCase.result = [{ type: 'success', content: 'Thing created' }];
    flashCase.handTo = TARGET_PATH;
    flashCase.thenTo = undefined;
    flashCase.usePageFlash = usePageFlash;
    // Reduced motion, a setting of the user's: Cloudscape then adds and removes an item at once, where it otherwise
    // waits for the end of a CSS transition, which jsdom never runs. What is shown afterwards is the same.
    vi.stubGlobal('matchMedia', (query: string) => {
      const list = scheme.matchMedia(query);
      return query === '(prefers-reduced-motion: reduce)' ? { ...list, matches: true } : list;
    });
  });

  afterEach(() => {
    registry.screens.length = 0;
    Area = AwsArea;
  });

  function choose(name: 'Act' | 'Hand over', result?: FlashResult) {
    if (result !== undefined) {
      flashCase.result = result;
    }
    act(() => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  }

  function flashbar(wrapper: ReturnType<typeof createWrapper>) {
    return wrapper.findFlashbar();
  }

  /** The items shown: each one's header and content as text, `null` for no header. */
  function items(wrapper: ReturnType<typeof createWrapper>): [string | null, string][] {
    return (flashbar(wrapper)?.findItems() ?? []).map((item) => [
      item.findHeader()?.getElement().textContent || null,
      item.findContent()?.getElement().textContent ?? '',
    ]);
  }

  function expectNoFlash(wrapper: ReturnType<typeof createWrapper>) {
    expect(flashbar(wrapper)).toBeNull();
    expect(document.querySelector('.aws-area-content [data-itemid]')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Notifications' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  }

  function notice(): HTMLElement {
    return screen.getByRole('region', { name: 'Local emulator notice' });
  }

  function h1(): HTMLElement {
    return screen.getByRole('heading', { level: 1 });
  }

  /** The accessible name of a Tab stop: its `aria-label`, else its text. */
  function stopName(stop: HTMLElement): string {
    return stop.getAttribute('aria-label') ?? (stop.textContent ?? '').trim();
  }

  it("a screen that shows no result: no flash region, no element of it, no landmark and no Tab stop between the notice's close control and the page", () => {
    const { wrapper } = open(FLASHES_PATH);
    const close = within(notice()).getByRole('button', { name: 'Close the local emulator notice' });

    expectNoFlash(wrapper);
    const stops = tabStops();
    expect(stops[stops.indexOf(close) + 1]).toBe(screen.getByRole('button', { name: 'Act' }));
    // Between the notice and the h1 lies no element of any flash: the notice's holder is followed by the page's.
    const between = [...document.querySelectorAll('*')].filter(
      (element) =>
        follows(notice(), element) &&
        follows(element, h1()) &&
        !element.contains(notice()) &&
        !element.contains(h1()) &&
        !notice().contains(element),
    );
    expect(between).toEqual([]);
    const landmarks = screen.queryAllByRole('region').map((region) => region.getAttribute('aria-label') ?? '');
    expect(landmarks.filter((name) => name !== 'Local emulator notice')).toHaveLength(1);
  });

  it('a screen shows a success result of one item: inside the content target, after the emulator line and the notice and before the h1, with a control named "Dismiss"', () => {
    const { wrapper } = open(FLASHES_PATH);
    choose('Act');
    act(() => {
      focusContent?.();
    });
    const target = document.activeElement as HTMLElement;
    const flash = flashbar(wrapper)?.getElement() as HTMLElement;

    expect(items(wrapper)).toEqual([[null, 'Thing created']]);
    expect(flashbar(wrapper)?.findItems()[0]?.findDismissButton()?.getElement()).toHaveAccessibleName('Dismiss');
    expect(target).toHaveAccessibleName('Flashes');
    expect(target).toContainElement(flash);
    expect(follows(emulatorLine(), flash)).toBe(true);
    expect(follows(notice(), flash)).toBe(true);
    expect(follows(flash, h1())).toBe(true);
  });

  it("Tab from the breadcrumbs while a flash is shown, the notice open: the line's controls, the notice's close control, the flash's \"Dismiss\", then the page's first control", async () => {
    const user = userEvent.setup();
    const { wrapper } = open(FLASHES_PATH);
    choose('Act');
    const crumbs = wrapper.findBreadcrumbGroup()?.getElement() as HTMLElement;
    const lastCrumbLink = [...crumbs.querySelectorAll<HTMLElement>('a[href]')].at(-1) as HTMLElement;
    lastCrumbLink.focus();

    const names: string[] = [];
    for (let step = 0; step < 4; step += 1) {
      await user.tab();
      names.push(stopName(document.activeElement as HTMLElement));
    }
    expect(names).toEqual(['About the local emulator', 'Close the local emulator notice', 'Dismiss', 'Act']);
  });

  it('"Dismiss" chosen: the flash is gone and the region with it', () => {
    const { wrapper } = open(FLASHES_PATH);
    choose('Act');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    });

    expectNoFlash(wrapper);
  });

  const THREE: FlashResult = [
    { type: 'success', content: 'Deleted 1 thing' },
    { type: 'error', header: 'Failed to delete thing-a', content: 'AccessDenied' },
    { type: 'error', header: 'Failed to delete thing-b', content: 'NotFound' },
  ];

  it('a result of three items of one action, one success and two errors: the three in the order given', () => {
    const { wrapper } = open(FLASHES_PATH);
    choose('Act', THREE);

    expect(items(wrapper)).toEqual([
      [null, 'Deleted 1 thing'],
      ['Failed to delete thing-a', 'AccessDenied'],
      ['Failed to delete thing-b', 'NotFound'],
    ]);
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(3);
  });

  it('"Dismiss" on the second of them: that item alone is gone', () => {
    const { wrapper } = open(FLASHES_PATH);
    choose('Act', THREE);
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[1] as HTMLElement);
    });

    expect(items(wrapper)).toEqual([
      [null, 'Deleted 1 thing'],
      ['Failed to delete thing-b', 'NotFound'],
    ]);
  });

  it("a second result while a result of several items is shown: only the second result's items", () => {
    const { wrapper } = open(FLASHES_PATH);
    choose('Act', THREE);
    choose('Act', [{ type: 'info', content: 'Nothing to delete' }]);

    expect(items(wrapper)).toEqual([[null, 'Nothing to delete']]);
  });

  it('an item with a header and a content shows both; an item without a header shows its content alone', () => {
    const { wrapper } = open(FLASHES_PATH);
    choose('Act', [
      { type: 'success', header: 'Thing created', content: 'thing-a is ready' },
      { type: 'success', content: 'thing-b is ready' },
    ]);

    const [first, second] = flashbar(wrapper)?.findItems() ?? [];
    expect(first?.findHeader()?.getElement()).toHaveTextContent('Thing created');
    expect(first?.findContent()?.getElement()).toHaveTextContent('thing-a is ready');
    expect(second?.findHeader()?.getElement().textContent ?? '').toBe('');
    expect(second?.findContent()?.getElement()).toHaveTextContent('thing-b is ready');
  });

  it('an item of each type: the error item is announced once as an alert, each other one once as a status', () => {
    const { wrapper } = open(FLASHES_PATH);
    choose('Act', [
      { type: 'success', content: 'Saved one' },
      { type: 'error', content: 'Failed two' },
      { type: 'info', content: 'Noted three' },
      { type: 'warning', content: 'Careful four' },
    ]);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Failed two');
    expect(flashbar(wrapper)?.getElement()).toContainElement(alerts[0] as HTMLElement);
    const status = screen.getByRole('status');
    const said = status.textContent ?? '';
    expect(said).toBe('Success Saved one Info Noted three Warning Careful four');
    expect(said).not.toContain('Failed two');
    // Said once: a later render of the same result, a dismissal, says nothing more.
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0] as HTMLElement);
    });
    expect(screen.getByRole('status').textContent).toBe(said);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('an item whose header and content hold markup from the emulator: shown as text, no element created from it', () => {
    const { wrapper } = open(FLASHES_PATH);
    choose('Act', [
      { type: 'error', header: '<b>bold</b>', content: '<img src=x onerror=alert(1)>' },
      { type: 'success', header: '<i>it</i>', content: '<script>x</script>' },
    ]);

    expect(items(wrapper)).toEqual([
      ['<b>bold</b>', '<img src=x onerror=alert(1)>'],
      ['<i>it</i>', '<script>x</script>'],
    ]);
    const flash = flashbar(wrapper)?.getElement() as HTMLElement;
    expect(flash.querySelector('b, i, img, script')).toBeNull();
    expect(screen.getByRole('status').querySelector('b, i, img, script')).toBeNull();
  });

  it('only the query of the address changed while a result is shown: the result is still shown', async () => {
    const { wrapper, router } = open(FLASHES_PATH);
    choose('Act');
    await act(() => router.navigate(`${FLASHES_PATH}?sort=name`));

    expect(screen.getByTestId('query')).toHaveTextContent('?sort=name');
    expect(items(wrapper)).toEqual([[null, 'Thing created']]);
  });

  it('the screen that shows a result left for another path of the area and opened again: no flash', async () => {
    const { wrapper, router } = open(FLASHES_PATH);
    choose('Act');
    await act(() => router.navigate(ELSEWHERE_PATH));
    expectNoFlash(wrapper);
    await act(() => router.navigate(FLASHES_PATH));

    expect(h1()).toHaveTextContent('Flashes');
    expectNoFlash(wrapper);
  });

  it("a screen hands a result to another screen's path and leads there: the result is shown on that screen", () => {
    const { wrapper, router } = open(FLASHES_PATH);
    choose('Hand over');

    expect(router.state.location.pathname).toBe(TARGET_PATH);
    expect(h1()).toHaveTextContent('Target');
    expect(items(wrapper)).toEqual([[null, 'Thing created']]);
    expect(screen.getByRole('status')).toHaveTextContent('Success Thing created');
  });

  it('a result handed to a path, and the next change of path goes to a different one: no flash there, and none on the handed path opened afterwards', async () => {
    const { wrapper, router } = open(FLASHES_PATH);
    flashCase.thenTo = ELSEWHERE_PATH;
    choose('Hand over');

    expect(router.state.location.pathname).toBe(ELSEWHERE_PATH);
    expectNoFlash(wrapper);
    await act(() => router.navigate(TARGET_PATH));
    expect(h1()).toHaveTextContent('Target');
    expectNoFlash(wrapper);
  });

  it('after a handed result was shown, that screen left and opened again: no flash', async () => {
    const { wrapper, router } = open(FLASHES_PATH);
    choose('Hand over');
    expect(items(wrapper)).toHaveLength(1);
    await act(() => router.navigate(ELSEWHERE_PATH));
    await act(() => router.navigate(TARGET_PATH));

    expect(h1()).toHaveTextContent('Target');
    expectNoFlash(wrapper);
  });

  it('the area\'s index, a "no screen yet" page and the area\'s "Page not found" after a screen showed a result: none shows a flash', async () => {
    const { wrapper, router } = open(FLASHES_PATH);
    choose('Act');
    for (const [path, name] of PAGES) {
      await act(() => router.navigate(path));
      // Issue 57: with the flash's screens of Amazon Kinesis registered, its route shows the page for that part of it.
      expect(h1()).toHaveTextContent(path === NO_SCREEN_SERVICE.path ? NO_SCREEN_PART : name);
      expectNoFlash(wrapper);
    }
    // Nor does a result handed to one of them.
    await act(() => router.navigate(FLASHES_PATH));
    flashCase.handTo = '/aws';
    choose('Hand over');
    expect(h1()).toHaveTextContent(AWS);
    expectNoFlash(wrapper);
  });

  it('a screen shows a result, then the app rendered afresh at the same path, as a reload of the document: no flash, and local and session storage hold nothing new', async () => {
    const stored = () => [
      Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
      Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)]),
    ];
    const before = stored();
    const first = open(FLASHES_PATH);
    choose('Act');
    expect(items(first.wrapper)).toHaveLength(1);
    first.unmount();

    vi.resetModules();
    flashCase.usePageFlash = (await import('./components/page-flash')).usePageFlash;
    Area = (await import('./index')).default;
    const { wrapper } = open(FLASHES_PATH);

    expect(h1()).toHaveTextContent('Flashes');
    expectNoFlash(wrapper);
    expect(stored()).toEqual(before);
  });
});

// Issue 57 (test-criteria.md, "Unit — providers/aws/area/area-layout.test.tsx", New): the "no screen yet" page for a
// part of a service that has screens, on test screens of Amazon DynamoDB of this block's own.
describe('the "no screen yet" page for a part of a service that has screens (issue 57, R4)', () => {
  const PART_STATEMENT = 'Studio has no screen for this part of Amazon DynamoDB yet.';
  const PART_SENTENCE = 'Opening this page changed nothing in your local emulator.';

  const NAVIGATION_OF_THINGS = {
    header: { text: 'Things of DynamoDB', href: '/aws/dynamodb' },
    items: [
      {
        type: 'section',
        text: 'Things',
        items: [
          { type: 'link', text: 'All things', href: '/aws/dynamodb/things' },
          { type: 'link', text: 'Widgets', href: '/aws/dynamodb/widgets' },
          { type: 'link', text: 'Other things', href: '/aws/dynamodb/other-things' },
        ],
      },
    ],
    activeHref: '/aws/dynamodb/things',
  } satisfies AreaScreen['navigation'];

  const THINGS: AreaScreen = {
    service: '/dynamodb',
    paths: ['/aws/dynamodb', '/aws/dynamodb/things'],
    title: 'Things',
    crumbs: [{ text: 'Things' }],
    navigation: NAVIGATION_OF_THINGS,
    Page: () => <Header variant="h1">Things</Header>,
  };

  const WIDGETS: AreaScreen = {
    service: '/dynamodb',
    paths: ['/aws/dynamodb/widgets'],
    title: 'Widgets',
    crumbs: [{ text: 'Widgets' }],
    navigation: {
      ...NAVIGATION_OF_THINGS,
      header: { text: 'Widgets of DynamoDB', href: '/aws/dynamodb' },
      activeHref: '/aws/dynamodb/widgets',
    },
    Page: () => <Header variant="h1">Widgets</Header>,
  };

  /** An item's page: two crumbs below the service, the first with an address; it leads to an item's settings. */
  const ITEM: AreaScreen = {
    service: '/dynamodb',
    paths: ['/aws/dynamodb/items/{name}'],
    leadsTo: ['/aws/dynamodb/item/{name}/settings'],
    title: (params) => params.name ?? '',
    crumbs: (params) => [{ text: 'Items', href: '/aws/dynamodb/items' }, { text: params.name ?? '' }],
    navigation: { ...NAVIGATION_OF_THINGS, activeHref: '/aws/dynamodb/widgets' },
    Page: ({ params }) => <Header variant="h1">{params.name}</Header>,
  };

  const DYNAMODB_CRUMBS: [string, string | null][] = [
    ['EmuForge', '/'],
    ['AWS', '/aws'],
    ['DynamoDB', '/aws/dynamodb'],
  ];

  afterEach(() => {
    registry.screens.length = 0;
  });

  function register(...screens: AreaScreen[]) {
    registry.screens.push(...screens);
  }

  function activeLink(wrapper: ReturnType<typeof createWrapper>): HTMLElement | undefined {
    return wrapper.findSideNavigation()?.findActiveLink()?.getElement();
  }

  /** The page's actions, the links of its content whose names start "Go to ", in order, with their addresses. */
  function actions(): [string | null, string | null][] {
    return screen
      .getAllByRole('link', { name: /^Go to / })
      .map((link) => [link.textContent, link.getAttribute('href')]);
  }

  /** The path shown under "Path": the first `code` element after the label. */
  function shownPath(): string | null {
    const main = screen.getByRole('main');
    const label = within(main).getByText('Path', { exact: true });
    const code = [...main.querySelectorAll('code')].find((element) => follows(label, element));
    return code?.textContent ?? null;
  }

  function expectPartPage() {
    expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN_PART })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent(PART_STATEMENT);
    expect(titles.at(-1)).toBe(NO_SCREEN_PART);
  }

  it('on /aws/dynamodb/other-things: the crumbs EmuForge (/), AWS (/aws), DynamoDB to /aws/dynamodb, then "No screen yet", the current page and no link', () => {
    register(THINGS, WIDGETS);
    const { wrapper } = open('/aws/dynamodb/other-things');

    expect(breadcrumbs(wrapper)).toEqual([...DYNAMODB_CRUMBS, [NO_SCREEN_PART, null]]);
    expect(crumbLink(wrapper, NO_SCREEN_PART)).toBeUndefined();
    expect(crumbLink(wrapper, 'DynamoDB')).toHaveAttribute('href', '/aws/dynamodb');
  });

  it('on that page: the first screen\'s navigation, its header and three links in order, none of the services, "Other things" current', () => {
    register(THINGS, WIDGETS);
    const { wrapper } = open('/aws/dynamodb/other-things');

    expect(wrapper.findSideNavigation()?.findHeaderLink()?.getElement()).toHaveTextContent('Things of DynamoDB');
    const links = sideLinks(wrapper);
    expect(links).toEqual([
      ['All things', '/aws/dynamodb/things'],
      ['Widgets', '/aws/dynamodb/widgets'],
      ['Other things', '/aws/dynamodb/other-things'],
    ]);
    for (const [label, route] of SERVICES) {
      expect(links.map(([text]) => text)).not.toContain(label);
      expect(links.map(([, href]) => href)).not.toContain(route);
    }
    expect(activeLink(wrapper)).toHaveTextContent('Other things');
  });

  it('on /aws/dynamodb/nothing-links-here: the same navigation, no link current', () => {
    register(THINGS, WIDGETS);
    const { wrapper } = open('/aws/dynamodb/nothing-links-here');

    expectPartPage();
    expect(wrapper.findSideNavigation()?.findHeaderLink()?.getElement()).toHaveTextContent('Things of DynamoDB');
    expect(sideLinks(wrapper)).toHaveLength(3);
    expect(activeLink(wrapper)).toBeUndefined();
  });

  it.each([
    ['/aws/dynamodb/things/x', 'Things', '/aws/dynamodb/things', 'All things'],
    ['/aws/dynamodb/widgets/x', 'Widgets', '/aws/dynamodb/widgets', 'Widgets'],
  ])('on %s: after DynamoDB the crumb %s to %s, then "No screen yet"; %s current', (path, crumb, href, current) => {
    register(THINGS, WIDGETS);
    const { wrapper } = open(path);

    expectPartPage();
    expect(breadcrumbs(wrapper)).toEqual([...DYNAMODB_CRUMBS, [crumb, href], [NO_SCREEN_PART, null]]);
    expect(activeLink(wrapper)).toHaveTextContent(current);
  });

  it('a screen above with two crumbs, the first with an address, at the name a/b (…/a%2Fb/more): both links, the second "a/b" to the leading part with a%2Fb; "No screen yet" the only crumb that is no link', () => {
    register(THINGS, ITEM);
    const { wrapper } = open('/aws/dynamodb/items/a%2Fb/more');

    expectPartPage();
    expect(breadcrumbs(wrapper)).toEqual([
      ...DYNAMODB_CRUMBS,
      ['Items', '/aws/dynamodb/items'],
      ['a/b', '/aws/dynamodb/items/a%2Fb'],
      [NO_SCREEN_PART, null],
    ]);
    expect(breadcrumbs(wrapper).filter(([, href]) => href === null)).toEqual([[NO_SCREEN_PART, null]]);
  });

  it("a screen that leads to a pattern, a path below that pattern: the screen's crumbs, the last to its first path for that name, and its navigation's current link", () => {
    register(THINGS, ITEM);
    const { wrapper } = open('/aws/dynamodb/item/my%20item/settings/edit');

    expectPartPage();
    expect(breadcrumbs(wrapper)).toEqual([
      ...DYNAMODB_CRUMBS,
      ['Items', '/aws/dynamodb/items'],
      ['my item', '/aws/dynamodb/items/my%20item'],
      [NO_SCREEN_PART, null],
    ]);
    expect(activeLink(wrapper)).toHaveTextContent('Widgets');
  });

  it.each(['/aws/dynamodb/nothing-links-here', '/aws/dynamodb/things/x'])(
    'on %s, with and without a screen above: no help toggle, no local-emulator notice, no (i) control; the emulator line shown',
    (path) => {
      register({ ...THINGS, help: () => <HelpPanel header={<h2>Things</h2>}>Help</HelpPanel> }, WIDGETS);
      const { wrapper } = open(path);

      expectPartPage();
      expect(wrapper.findAppLayout()?.findToolsToggle()).toBeNull();
      expect(screen.queryByRole('button', { name: /help panel/i })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Local emulator notice' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'About the local emulator' })).toBeNull();
      expect(emulatorLine()).toBeInTheDocument();
    },
  );

  it('the content target is named "No screen yet"; a route change to the page from a screen puts focus on it', async () => {
    register(THINGS, WIDGETS);
    const { router } = open('/aws/dynamodb/things');

    await act(() => router.navigate('/aws/dynamodb/things/x'));

    await expectFocusOnTarget(NO_SCREEN_PART, 'Go to Things');
  });

  it('on /aws/dynamodb/ (a trailing slash): the changed page, "Path" showing /aws/dynamodb/', () => {
    register(THINGS, WIDGETS);
    open('/aws/dynamodb/');

    expectPartPage();
    expect(shownPath()).toBe('/aws/dynamodb/');
  });

  it.each(['/aws/dynamodb', '/aws/dynamodb/x'])(
    'with only "Widgets" registered (the route shows no screen), on %s: the changed page; "Go to Widgets" to /aws/dynamodb/widgets; the Widgets screen\'s navigation',
    (path) => {
      register(WIDGETS);
      const { wrapper } = open(path);

      expectPartPage();
      expect(actions()).toEqual([
        ['Go to Widgets', '/aws/dynamodb/widgets'],
        ['Go to Home', '/'],
      ]);
      expect(wrapper.findSideNavigation()?.findHeaderLink()?.getElement()).toHaveTextContent('Widgets of DynamoDB');
    },
  );

  it('with only screens at paths with a parameter: no "Go to …" before "Go to Home", its one action', () => {
    register(ITEM);
    open('/aws/dynamodb/x');

    expectPartPage();
    expect(actions()).toEqual([['Go to Home', '/']]);
  });

  it.each(['/aws/dynamodb/other-things', '/aws/dynamodb/widgets/x'])(
    'with "Things" and "Widgets", on %s: the first action "Go to Things", to the service\'s route /aws/dynamodb',
    (path) => {
      register(THINGS, WIDGETS);
      open(path);

      expect(actions()).toEqual([
        ['Go to Things', '/aws/dynamodb'],
        ['Go to Home', '/'],
      ]);
    },
  );

  it.each([NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.below])(
    "with screens of DynamoDB only, on %s of a service without a screen: today's page in every part",
    (path) => {
      register(THINGS, WIDGETS);
      const { wrapper } = open(path);

      expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN })).toBeInTheDocument();
      expect(screen.getByRole('main')).toHaveTextContent(NO_SCREEN_SENTENCE);
      expect(wrapper.findSideNavigation()?.findHeaderLink()?.getElement()).toHaveTextContent(AWS);
      expect(sideLinks(wrapper)).toEqual(SERVICES);
      expect(activeLink(wrapper)).toHaveAttribute('href', NO_SCREEN_SERVICE.path);
      expect(breadcrumbs(wrapper)).toEqual([
        ['EmuForge', '/'],
        ['AWS', '/aws'],
        [NO_SCREEN_SERVICE.crumb, null],
      ]);
      expect(actions()).toEqual([['Go to Home', '/']]);
      expect(screen.queryByText('Path', { exact: true })).toBeNull();
    },
  );

  it.each([
    ['/aws', AWS],
    ['/aws/does-not-exist', 'Page not found'],
    ['/aws/dynamodb/items/%zz', 'Page not found'],
  ])('with those screens, on %s: the h1 %s, as before', (path, h1) => {
    register(THINGS, WIDGETS, ITEM);
    open(path);

    expect(screen.getByRole('heading', { level: 1, name: h1 })).toBeInTheDocument();
    expect(screen.queryByText(PART_STATEMENT)).toBeNull();
  });

  const STATES: [string, CheckResult | undefined, string, boolean][] = [
    ['no check has answered', undefined, 'Checking', false],
    ['connected', connectedAt(9297), 'Connected at https://127.0.0.1:9297', false],
    [
      'emulator not started',
      {
        kind: 'emulator-unreachable',
        checkedAt: 1,
        emulator: { port: 9297, endpoint: 'https://127.0.0.1:9297' },
        reason: 'not_started',
        message: '',
      },
      'Not started on port 9297',
      true,
    ],
    [
      'emulator not answering',
      {
        kind: 'emulator-unreachable',
        checkedAt: 1,
        emulator: { port: 9297, endpoint: 'https://127.0.0.1:9297' },
        reason: 'refused',
        message: '',
      },
      'Not answering at https://127.0.0.1:9297',
      true,
    ],
    [
      'engine not answering',
      { kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: 9297 },
      `The EmuForge engine at ${ENGINE_ORIGIN} is not answering`,
      true,
    ],
    [
      'engine error with a code',
      { kind: 'engine-error', checkedAt: 1, status: 500, code: 'Boom', message: undefined },
      'The EmuForge engine answered with an error: Boom',
      true,
    ],
    [
      'engine error without a code',
      { kind: 'engine-error', checkedAt: 1, status: 502, code: undefined, message: undefined },
      'The EmuForge engine answered with HTTP status 502',
      true,
    ],
  ];

  it.each(STATES)(
    'in the state "%s": the line\'s text, the same h1, statement, path and sentence, both actions leading where R4.7 says; "Connection status" first when shown',
    (_state, result, status, recovery) => {
      register(THINGS, WIDGETS);
      connection.value = { result, engineOrigin: ENGINE_ORIGIN };
      const { router } = open('/aws/dynamodb/other-things');

      expect(lineStatus()).toBe(status);
      expectPartPage();
      expect(shownPath()).toBe('/aws/dynamodb/other-things');
      expect(screen.getByRole('main')).toHaveTextContent(PART_SENTENCE);
      expect(actions()).toEqual([
        ['Go to Things', '/aws/dynamodb'],
        ['Go to Home', '/'],
      ]);
      const stops = tabStops().map((stop) => stop.textContent);
      const goTo = stops.indexOf('Go to Things');
      const connectionStatus = stops.indexOf('Connection status');
      if (recovery) {
        expect(connectionStatus).toBeGreaterThanOrEqual(0);
        expect(connectionStatus).toBeLessThan(goTo);
      } else {
        expect(connectionStatus).toBe(-1);
      }
      act(() => {
        fireEvent.click(screen.getByRole('link', { name: 'Go to Things' }));
      });
      expect(router.state.location.pathname).toBe('/aws/dynamodb');
      act(() => {
        void router.navigate('/aws/dynamodb/other-things');
      });
      act(() => {
        fireEvent.click(screen.getByRole('link', { name: 'Go to Home' }));
      });
      expect(router.state.location.pathname).toBe('/');
    },
  );
});

/** A connected answer for the emulator on `port` that names the target `target`. */
function connectedTo(target: string, port: number): CheckResult {
  return { ...connectedAt(port), target } as CheckResult;
}

// Test screens of a change of target (issue 486, R3), under Amazon Kinesis: each with state of its own to see a remount.
const PROBE_PATH = '/aws/kinesis/probe';
const OTHER_PROBE_PATH = '/aws/kinesis/probe/other';
const TARGET_CHANGED = 'The target is now second. This page now reads from it.';

/** A screen's page that names its resources (so the notice is open) and keeps a count of its own, from 0. */
function ProbePage({ title }: { title: string }) {
  useShowsResources('things');
  const [count, setCount] = useState(0);
  return (
    <>
      <Header variant="h1">{title}</Header>
      <Button
        onClick={() => {
          setCount((current) => current + 1);
        }}
      >
        {`Count ${String(count)}`}
      </Button>
    </>
  );
}

function probeScreen(path: string, title: string): AreaScreen {
  return {
    service: '/kinesis',
    paths: [path],
    title,
    crumbs: [{ text: title }],
    navigation: KINESIS_NAVIGATION,
    Page: () => <ProbePage title={title} />,
  };
}

describe('a change of target (issue 486, R3)', () => {
  beforeEach(() => {
    registry.screens.push(probeScreen(PROBE_PATH, 'Probe'), probeScreen(OTHER_PROBE_PATH, 'Other probe'));
    connection.value = { result: connectedTo('local', 9301), engineOrigin: ENGINE_ORIGIN };
    connection.generation = 0;
    // Reduced motion, as the flash's own cases: Cloudscape then adds and removes a flash item at once.
    vi.stubGlobal('matchMedia', (query: string) => {
      const list = scheme.matchMedia(query);
      return query === '(prefers-reduced-motion: reduce)' ? { ...list, matches: true } : list;
    });
  });

  afterEach(() => {
    registry.screens.length = 0;
  });

  function count(): HTMLElement {
    return screen.getByRole('button', { name: /^Count / });
  }

  function countUp(times: number) {
    for (let step = 0; step < times; step += 1) {
      act(() => {
        fireEvent.click(count());
      });
    }
  }

  function notice(): HTMLElement | null {
    return screen.queryByRole('region', { name: 'Local emulator notice' });
  }

  function contentTarget(): HTMLElement {
    return document.querySelector('.aws-area-content') as HTMLElement;
  }

  /** Opens the notice when a case before closed it: its open state outlives the page, as the layout keeps it. */
  function openNotice() {
    const about = screen.getByRole('button', { name: 'About the local emulator' });
    if (about.getAttribute('aria-expanded') === 'false') {
      act(() => {
        fireEvent.click(about);
      });
    }
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
  }

  function openProbe(path = PROBE_PATH) {
    const opened = open(path);
    openNotice();
    return opened;
  }

  function flashTexts(wrapper: ReturnType<typeof createWrapper>): string[] {
    return (wrapper.findFlashbar()?.findItems() ?? []).map((item) =>
      (item.findContent()?.getElement().textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  function flashSaid(): string {
    return screen.getByRole('status').textContent;
  }

  /** Studio sees the target change to `second` and hands the area its answer with the next generation. */
  function changeToSecond(generation = 1) {
    connection.changeTarget(generation, { result: connectedTo('second', 9302), engineOrigin: ENGINE_ORIGIN });
  }

  it('from 0 to 1 while a page is shown: the page below the line is mounted again; the line, the notice and the layout are not', () => {
    openProbe();
    countUp(2);
    expect(count()).toHaveTextContent('Count 2');
    const line = emulatorLine();
    const target = contentTarget();
    const heading = screen.getByRole('heading', { level: 1 });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close the local emulator notice' }));
    });
    expect(notice()).toBeNull();

    changeToSecond();

    expect(count()).toHaveTextContent('Count 0');
    expect(screen.getByRole('heading', { level: 1 })).not.toBe(heading);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Probe');
    expect(emulatorLine()).toBe(line);
    expect(contentTarget()).toBe(target);
    expect(lineStatus()).toBe('Connected at https://127.0.0.1:9302');
    // The notice's state is the layout's: closed it stays closed, the (i) control collapsed.
    expect(notice()).toBeNull();
    expect(screen.getByRole('button', { name: 'About the local emulator' })).toHaveAttribute('aria-expanded', 'false');
  });

  it("on that change, with focus inside the page: focus moves to the page's content target", () => {
    openProbe();
    act(() => {
      count().focus();
    });
    expect(document.activeElement).toBe(count());

    changeToSecond();

    expect(document.activeElement).toBe(contentTarget());
    expect(contentTarget()).toHaveAccessibleName('Probe');
  });

  it.each([
    ["the line's (i) control", () => screen.getByRole('button', { name: 'About the local emulator' })],
    ["the notice's close control", () => screen.getByRole('button', { name: 'Close the local emulator notice' })],
    [
      'a link of the side navigation',
      () => within(screen.getByRole('navigation', { name: 'Navigation' })).getAllByRole('link')[0] as HTMLElement,
    ],
  ])('on that change, with focus on %s: focus stays there', (_name, element) => {
    openProbe();
    const focused = element();
    act(() => {
      focused.focus();
    });
    expect(document.activeElement).toBe(focused);

    changeToSecond();

    expect(document.activeElement).toBe(focused);
  });

  it('on that change: the flash shows "The target is now second. …" and it is announced once, the line\'s live region quiet', () => {
    const { wrapper } = openProbe();
    expect(flashSaid()).toBe('');

    changeToSecond();

    expect(flashTexts(wrapper)).toEqual([TARGET_CHANGED]);
    const flash = wrapper.findFlashbar()?.findItems()[0]?.findContent()?.getElement() as HTMLElement;
    expect(flash.querySelector('code, [class*="awsui_box"]')).toHaveTextContent('second');
    expect(flashSaid()).toBe(`Info ${TARGET_CHANGED}`);
    expect(liveRegionText()).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    // Later answers naming the same target: nothing more is said, nothing mounted again.
    countUp(1);
    connection.set({ result: connectedTo('second', 9302), engineOrigin: ENGINE_ORIGIN });
    expect(flashTexts(wrapper)).toEqual([TARGET_CHANGED]);
    expect(flashSaid()).toBe(`Info ${TARGET_CHANGED}`);
    expect(liveRegionText()).toBe('');
    expect(count()).toHaveTextContent('Count 1');
  });

  it.each([
    ["the area's index", '/aws'],
    ['a service with no screen', '/aws/kinesis'],
    ['the area\'s "Page not found"', '/aws/does-not-exist'],
  ])(
    "on %s, which shows no flash: the line's live region announces the change of target alone, once",
    (_name, path) => {
      const { wrapper } = open(path);
      expect(liveRegionText()).toBe('');

      changeToSecond();

      expect(liveRegionText()).toBe(`${LINE_LABEL} Connected at https://127.0.0.1:9302. Target second`);
      expect(flashTexts(wrapper)).toEqual([]);
      expect(flashSaid()).toBe('');
      // A later answer naming the same target says nothing more.
      connection.set({ result: connectedTo('second', 9302), engineOrigin: ENGINE_ORIGIN });
      expect(liveRegionText()).toBe(`${LINE_LABEL} Connected at https://127.0.0.1:9302. Target second`);
    },
  );

  it('the generation handed before the answer that names the new target: the flash names it once that answer comes', () => {
    const { wrapper } = openProbe();

    connection.changeTarget(1);
    expect(flashTexts(wrapper)).toEqual([]);

    connection.set({ result: connectedTo('second', 9302), engineOrigin: ENGINE_ORIGIN });
    expect(flashTexts(wrapper)).toEqual([TARGET_CHANGED]);
    expect(flashSaid()).toBe(`Info ${TARGET_CHANGED}`);
  });

  it('the area mounted with targetGeneration already 1: no flash, nothing mounted again, focus as on any load', () => {
    connection.value = { result: connectedTo('second', 9302), engineOrigin: ENGINE_ORIGIN };
    connection.generation = 1;
    const { wrapper } = openProbe();

    expect(document.activeElement).toBe(document.body);
    countUp(2);
    connection.set({ result: connectedTo('second', 9302), engineOrigin: ENGINE_ORIGIN });

    expect(flashTexts(wrapper)).toEqual([]);
    expect(flashSaid()).toBe('');
    expect(count()).toHaveTextContent('Count 2');
    expect(document.activeElement).toBe(document.body);
  });

  it('a route change with the same targetGeneration: no flash, the page as before this issue', async () => {
    const { wrapper, router } = openProbe();
    countUp(1);

    act(() => {
      void router.navigate(OTHER_PROBE_PATH);
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(contentTarget());
    });
    expect(contentTarget()).toHaveAccessibleName('Other probe');
    expect(count()).toHaveTextContent('Count 0');
    expect(flashTexts(wrapper)).toEqual([]);
    expect(flashSaid()).toBe('');
  });

  it('no targetGeneration handed, as before issue 486: answers naming another target mount nothing again and show no flash', () => {
    connection.generation = undefined;
    const { wrapper } = openProbe();
    countUp(1);

    connection.set({ result: connectedTo('second', 9302), engineOrigin: ENGINE_ORIGIN });

    expect(count()).toHaveTextContent('Count 1');
    expect(flashTexts(wrapper)).toEqual([]);
  });
});

describe('a dialog of the area, told to Studio (issue 531)', () => {
  /** A page with a button that opens an `AreaModal`, closed by its own dismissal. */
  function DialogPage() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Header variant="h1">Dialogs</Header>
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          Open dialog
        </Button>
        <AreaModal
          visible={open}
          header="A dialog"
          closeAriaLabel="Close modal"
          onDismiss={() => {
            setOpen(false);
          }}
        >
          Nothing happens.
        </AreaModal>
      </>
    );
  }

  const DIALOGS: AreaScreen = {
    service: '/kinesis',
    paths: ['/aws/kinesis/dialogs'],
    title: 'Dialogs',
    crumbs: [{ text: 'Dialogs' }],
    navigation: KINESIS_NAVIGATION,
    Page: DialogPage,
  };

  beforeEach(() => {
    registry.screens.push(DIALOGS);
  });

  afterEach(() => {
    registry.screens.length = 0;
  });

  it('a dialog opened, closed with Esc, then opened again and the area left: onModal is told true, false, true, then false', async () => {
    const { router } = open('/aws/kinesis/dialogs');
    expect(modals).toEqual([]);

    fireEvent.click(await screen.findByRole('button', { name: 'Open dialog' }));
    await screen.findByRole('dialog', { name: 'A dialog' });
    await waitFor(() => {
      expect(modals).toEqual([true]);
    });

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => {
      expect(modals).toEqual([true, false]);
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    await waitFor(() => {
      expect(modals).toEqual([true, false, true]);
    });

    await act(() => router.navigate('/'));
    expect(modals).toEqual([true, false, true, false]);
  });
});

describe('a service that gives entries (issue 650, R4–R5)', () => {
  const service = '/dynamodb';
  const route = '/aws/dynamodb';
  const widgets = { label: 'Widgets', path: `${route}/widgets`, listedBy: 'ListWidgets' };
  const things = { label: 'Things', path: `${route}/things`, listedBy: 'ListThings' };
  const header = { text: 'Amazon DynamoDB', href: route };
  const widgetScreen: AreaScreen = {
    service,
    paths: [route, widgets.path],
    title: widgets.label,
    crumbs: [{ text: widgets.label }],
    navigation: { header, activeHref: widgets.path },
    help: () => <HelpPanel header={<h2>Widgets help</h2>} />,
    Page: () => <Header variant="h1">{widgets.label}</Header>,
  };

  beforeEach(() => {
    registry.screens.push(widgetScreen);
    registry.entries.push({ service, groups: [{ entries: [widgets, things] }] });
  });

  afterEach(() => {
    registry.screens.length = 0;
    registry.entries.length = 0;
  });

  it('shows the service header and the entries, with exactly one current link on the built screen', () => {
    const { wrapper } = open(widgets.path);
    const nav = wrapper.findSideNavigation();
    expect(nav?.findHeaderLink()?.getElement()).toHaveAttribute('href', route);
    const unbuilt = nav?.findLinkByHref(things.path)?.getElement();
    const built = nav?.findLinkByHref(widgets.path)?.getElement();
    expect(unbuilt?.textContent).toBe(things.label);
    expect(unbuilt).toHaveAccessibleName(things.label);
    expect(unbuilt).toHaveAccessibleDescription('No screen yet');
    expect(unbuilt?.closest('li')).toHaveTextContent('No screen yet');
    expect(built).not.toHaveAccessibleDescription();
    expect(built).toHaveAttribute('aria-current', 'page');
    expect(nav?.getElement().querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
  });

  it.each([false, true])('opens the current range in a long navigation (named groups: %s)', async (grouped) => {
    const kinds = ['Adapters', 'Bridges', 'Cables'].flatMap((label) =>
      Array.from({ length: 10 }, (_, index) => ({
        label: `${label} ${index}`,
        path: `${route}/${label.toLowerCase()}-${index}`,
        listedBy: `List${label}`,
      })),
    );
    const core = { entries: [widgets, ...kinds] };
    const groups = grouped
      ? [
          { ...core, name: 'Core' },
          { name: 'Secondary', entries: [things] },
        ]
      : [core];
    registry.entries.splice(0, 1, { service, groups });

    const { router, wrapper } = open(widgets.path);
    const navigation = () => wrapper.findSideNavigation();
    const rangeSection = (index: number) => {
      const nav = navigation();
      if (!grouped) return nav?.findItemByIndex(index)?.findSection();
      const core = nav?.findItemByIndex(1);
      const children = core
        ?.findItems()
        .filter((item) => item.getElement().parentElement?.closest('li') === core.getElement());
      return children?.[index - 1]?.findSection();
    };
    if (grouped) {
      expect(navigation()?.findItemByIndex(1)?.findSectionTitle()?.getElement()).toHaveTextContent('Core');
      expect(navigation()?.findItemByIndex(2)?.findSectionTitle()?.getElement()).toHaveTextContent('Secondary');
    }
    const ranges = [2, 3, 4].map((index) => rangeSection(index)?.findExpandButton().getElement());
    expect(ranges.map((button) => button?.textContent?.trim())).toEqual(['A', 'B', 'C']);
    for (const button of ranges) expect(button).toHaveAttribute('aria-expanded', 'false');
    const built = navigation()?.findLinkByHref(widgets.path)?.getElement();
    expect(built).toHaveAccessibleName(widgets.label);
    expect(built).toHaveAttribute('aria-current', 'page');

    const [adapters] = ranges;
    fireEvent.click(adapters as HTMLElement);
    expect(adapters).toHaveAttribute('aria-expanded', 'true');
    const adapter = navigation()?.findLinkByHref(`${route}/adapters-0`)?.getElement();
    expect(adapter).toHaveAccessibleName('Adapters 0');
    expect(adapter).toHaveAccessibleDescription('No screen yet');

    await act(() => router.navigate(`${route}/cables-9`));
    if (grouped) {
      const core = navigation()?.findItemByIndex(1)?.findSection()?.findExpandButton().getElement();
      expect(core).toHaveAttribute('aria-expanded', 'true');
    }
    expect(rangeSection(4)?.findExpandButton().getElement()).toHaveAttribute('aria-expanded', 'true');
    const cable = navigation()?.findLinkByHref(`${route}/cables-9`)?.getElement();
    expect(cable).toHaveAccessibleName('Cables 9');
    expect(cable).toHaveAttribute('aria-current', 'page');
    expect(navigation()?.findActiveLink()?.getElement()).toBe(cable);
  });

  it('uses the entry’s title and crumbs, with the emulator line and without the notice or help controls', () => {
    const { wrapper } = open(things.path);
    expect(breadcrumbs(wrapper)).toEqual([
      ['EmuForge', '/'],
      ['AWS', '/aws'],
      ['DynamoDB', route],
      [things.label, null],
    ]);
    const target = screen.getByRole('region', { name: things.label });
    expect(within(target).getByRole('heading', { name: things.label, level: 1 })).toBeInTheDocument();
    expect(target).toContainElement(emulatorLine());
    expect(within(target).queryByText(/are in your local emulator/)).not.toBeInTheDocument();
    expect(within(target).queryByRole('button', { name: 'About the local emulator' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open help panel' })).not.toBeInTheDocument();
    expect(titles.at(-1)).toBe(things.label);
    expect(wrapper.findSideNavigation()?.findActiveLink()?.getElement()).toHaveAttribute('href', things.path);
  });

  it('focuses the entry’s content target after following the navigation from a built screen', async () => {
    const { wrapper, router } = open(widgets.path);
    const link = wrapper.findSideNavigation()?.findLinkByHref(things.path)?.getElement();
    expect(link).toBeDefined();
    fireEvent.click(link as HTMLElement);

    expect(router.state.location.pathname).toBe(things.path);
    await expectFocusOnTarget(things.label, 'Go to Widgets');
  });

  it('shows the generated navigation with the screen above current on a generic part page', () => {
    const { wrapper } = open(`${widgets.path}/extra`);
    expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN_PART })).toBeInTheDocument();
    const nav = wrapper.findSideNavigation();
    expect(nav?.findLinkByHref(things.path)?.getElement()).toBeInTheDocument();
    expect(nav?.findActiveLink()?.getElement()).toHaveAttribute('href', widgets.path);
  });
});
