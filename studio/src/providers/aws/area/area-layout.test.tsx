import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AwsArea from './index';
import { AREA_ROOT_CLASS } from './styles/root-class';

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

const AWS = 'Amazon Web Services';
const S3 = 'Amazon Simple Storage Service';

// providers/aws/services.ts, in label order, each under /aws.
const SERVICES: [string, string][] = [
  ['Amazon API Gateway', '/aws/apigateway'],
  ['Amazon CloudWatch', '/aws/cloudwatch'],
  ['Amazon CloudWatch Logs', '/aws/logs'],
  ['Amazon DynamoDB', '/aws/dynamodb'],
  ['Amazon Elastic Compute Cloud', '/aws/ec2'],
  ['Amazon Elastic Container Registry', '/aws/ecr'],
  ['Amazon EventBridge', '/aws/events'],
  ['Amazon Kinesis', '/aws/kinesis'],
  ['Amazon Route 53', '/aws/route53'],
  ['Amazon Simple Notification Service', '/aws/sns'],
  ['Amazon Simple Queue Service', '/aws/sqs'],
  ['Amazon Simple Storage Service', '/aws/s3'],
  ['Amazon Simple Systems Manager (SSM)', '/aws/ssm'],
  ['AWS CloudFormation', '/aws/cloudformation'],
  ['AWS Identity and Access Management', '/aws/iam'],
  ['AWS Key Management Service', '/aws/kms'],
  ['AWS Lambda', '/aws/lambda'],
  ['AWS Secrets Manager', '/aws/secretsmanager'],
  ['AWS Step Functions', '/aws/states'],
];

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

let scheme: ColourScheme;
let titles: string[];
/** The function the area named last to focus its content target; `null` while it names none. */
let focusContent: (() => void) | null;

beforeEach(() => {
  scheme = new ColourScheme();
  vi.stubGlobal('matchMedia', scheme.matchMedia);
  titles = [];
  focusContent = null;
});

function handlePageTitle(title: string) {
  titles.push(title);
}

function handleContentTarget(focus: (() => void) | null) {
  focusContent = focus;
}

/**
 * The area with Studio's props, as Studio's frame hands them: the route changes counted as Studio counts them, one
 * more each time the path changes, none on the first render.
 */
function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  let changes = seen.changes;
  if (seen.pathname !== pathname) {
    changes += 1;
    setSeen({ pathname, changes });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={handlePageTitle}
      onContentTarget={handleContentTarget}
      routeChanges={changes}
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
  it('on /aws: the side navigation header and the 19 services in label order, crumbs EmuForge (to /) then AWS, nothing active', () => {
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

  it('on /aws/s3/buckets: crumbs EmuForge (to /), AWS (to /aws), then S3, the current page, the service active', () => {
    const { wrapper } = open('/aws/s3/buckets');

    expect(breadcrumbs(wrapper)).toEqual([
      ['EmuForge', '/'],
      ['AWS', '/aws'],
      ['S3', null],
    ]);
    const active = wrapper.findSideNavigation()?.findActiveLink()?.getElement();
    expect(active).toHaveTextContent(S3);
    expect(active).toHaveAttribute('href', '/aws/s3');
    expect(screen.getByRole('heading', { level: 1, name: S3 })).toBeInTheDocument();
    expect(titles.at(-1)).toBe(S3);
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
    const s3 = wrapper.findSideNavigation()?.findLinkByHref('/aws/s3')?.getElement();
    expect(s3).toBeDefined();

    let followed = true;
    act(() => {
      followed = fireEvent.click(s3 as HTMLElement);
    });

    // A click whose default is prevented: the router moved, the browser did not load the address.
    expect(followed).toBe(false);
    expect(router.state.location.pathname).toBe('/aws/s3');
    expect(screen.getByRole('heading', { level: 1, name: S3 })).toBeInTheDocument();
    expect(wrapper.findSideNavigation()?.findActiveLink()?.getElement()).toHaveAttribute('href', '/aws/s3');
  });

  it('has no tools panel and no toggle for one', () => {
    const { wrapper } = open('/aws/s3');
    const layout = wrapper.findAppLayout();

    expect(layout).not.toBeNull();
    expect(layout?.findTools()).toBeNull();
    expect(layout?.findToolsToggle()).toBeNull();
    expect(screen.queryByRole('button', { name: /tools|help panel/i })).toBeNull();
  });

  it("carries Cloudscape's dark mode on the area's root only, following the scheme while open", async () => {
    scheme.dark = true;
    const { container } = open('/aws/s3');
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
    const { router } = open('/aws/s3');
    expect(cloudscapeElements().length).toBeGreaterThan(0);

    await act(() => router.navigate('/'));

    expect(screen.getByText("Studio's Home")).toBeInTheDocument();
    expect(cloudscapeElements()).toEqual([]);
    expect([...document.documentElement.classList].filter((name) => name.startsWith('awsui-'))).toEqual([]);
    expect([...document.body.classList].filter((name) => name.startsWith('awsui-'))).toEqual([]);
  });

  it.each([
    ['/aws', AWS, 'Amazon API Gateway'],
    ['/aws/s3', S3, 'Go to Home'],
    ['/aws/does-not-exist', 'Page not found', 'Go to Home'],
  ])('on %s: names a content target named "%s", past its navigation, not its main', (path, name, firstStop) => {
    open(path);
    expect(focusContent).not.toBeNull();

    act(() => {
      focusContent?.();
    });

    expect(contentTargetProblems(document.activeElement, name, firstStop)).toEqual([]);
  });

  it('on /aws, AWS Lambda chosen in the side navigation: focus on the content target named AWS Lambda', async () => {
    const { wrapper } = open('/aws');
    const lambda = wrapper.findSideNavigation()?.findLinkByHref('/aws/lambda')?.getElement();
    expect(lambda).toBeDefined();

    act(() => {
      (lambda as HTMLElement).focus();
      fireEvent.click(lambda as HTMLElement);
    });

    await expectFocusOnTarget('AWS Lambda', 'Go to Home');
    expect(wrapper.findSideNavigation()?.findActiveLink()?.getElement()).toHaveTextContent('AWS Lambda');
  });

  it('on /aws/s3, AWS chosen in the breadcrumbs: /aws and focus on the content target named Amazon Web Services', async () => {
    const { wrapper, router } = open('/aws/s3');
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

  it('on /aws/s3/buckets, the service chosen in the side navigation: /aws/s3 and focus on its content target', async () => {
    const { wrapper, router } = open('/aws/s3/buckets');
    const s3 = wrapper.findSideNavigation()?.findLinkByHref('/aws/s3')?.getElement();
    expect(s3).toBeDefined();

    act(() => {
      (s3 as HTMLElement).focus();
      fireEvent.click(s3 as HTMLElement);
    });

    expect(router.state.location.pathname).toBe('/aws/s3');
    await expectFocusOnTarget(S3, 'Go to Home');
  });

  it.each(['/aws', '/aws/s3', '/aws/does-not-exist'])(
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

  it.each(['/aws', '/aws/s3', '/aws/does-not-exist'])(
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
    const { wrapper } = open('/aws/s3');

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
