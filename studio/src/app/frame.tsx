import '../ui/bar.css';
import '../ui/page.css';

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { PAGE_TITLE_ID } from '../ui/page-head';
import { PROVIDERS, type ProviderAreaProps } from './provider-list';

export const STUDIO_NAME = 'EmuForge Studio';

/** The id of Studio's top bar; a provider's area keeps its own sticky parts below it. */
const BAR_ID = 'studio-bar';

/** The id of Studio's own `main`: the address "Skip to content" names, which it never follows. */
const MAIN_ID = 'main';

/** A function that moves focus to a page's content target. */
type FocusContent = () => void;

/** What the frame shares with the page below it. */
interface PageFocus {
  /** Route changes since the document loaded: `0` on a first load (ProviderAreaProps, `routeChanges`). */
  routeChanges: number;
  /** Names the page's content target, for "Skip to content"; returns the function that withdraws it. */
  nameContentTarget: (focus: FocusContent) => () => void;
}

const PageFocusContext = createContext<PageFocus>({ routeChanges: 0, nameContentTarget: () => () => undefined });

/**
 * Counts the route changes of the open document: one more each time the path changes, none on a first load and
 * none for a link to the path already open. Kept from the previous render, as React's own pattern for it.
 */
function useRouteChanges(pathname: string): number {
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  if (seen.pathname !== pathname) {
    const next = { pathname, changes: seen.changes + 1 };
    setSeen(next);
    return next.changes;
  }
  return seen.changes;
}

/**
 * The document title of requirement R4.4: `<page title> | EmuForge Studio`, or `EmuForge Studio` on Home (`null`).
 * `undefined` leaves the title as it is: a page that does not know its title yet.
 */
function useDocumentTitle(pageTitle: string | null | undefined): void {
  useEffect(() => {
    if (pageTitle === undefined) {
      return;
    }
    document.title = pageTitle === null ? STUDIO_NAME : `${pageTitle} | ${STUDIO_NAME}`;
  }, [pageTitle]);
}

type Current = 'page' | 'true' | undefined;

/** How a frame link to `target` is marked on `pathname`: the current page, inside a provider's area, or not at all. */
function currentOf(pathname: string, target: string, deeper: boolean): Current {
  if (pathname === target || (deeper && pathname === `${target}/`)) {
    return 'page';
  }
  return deeper && pathname.startsWith(`${target}/`) ? 'true' : undefined;
}

/**
 * Studio's frame on every page (requirement R5.1): the top bar with "EmuForge Studio" and the navigation "Studio",
 * Home and one link per provider of the providers list, then the page. Built from Studio's own design only.
 */
export function Frame() {
  const { pathname } = useLocation();
  const routeChanges = useRouteChanges(pathname);
  // The content target the page below names; `null` while it names none (an area whose code is still loading).
  const focusContent = useRef<FocusContent | null>(null);
  const nameContentTarget = useCallback((focus: FocusContent) => {
    focusContent.current = focus;
    return () => {
      if (focusContent.current === focus) {
        focusContent.current = null;
      }
    };
  }, []);
  const pageFocus = useMemo(() => ({ routeChanges, nameContentTarget }), [routeChanges, nameContentTarget]);

  /** "Skip to content": focuses the content target the page named, and never follows its address. */
  const handleSkip = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    focusContent.current?.();
  };

  return (
    <div className="st-root">
      <header id={BAR_ID} className="st-bar">
        <a className="st-skip" href={`#${MAIN_ID}`} onClick={handleSkip}>
          Skip to content
        </a>
        <Link className="st-wordmark" to="/">
          <b>EmuForge</b> <span>Studio</span>
        </Link>
        <nav className="st-nav" aria-label="Studio">
          <Link to="/" aria-current={currentOf(pathname, '/', false)}>
            Home
          </Link>
          {PROVIDERS.map((provider) => {
            const target = `/${provider.segment}`;
            return (
              <Link key={provider.segment} to={target} aria-current={currentOf(pathname, target, true)}>
                {provider.shortName}
              </Link>
            );
          })}
        </nav>
      </header>
      <PageFocusContext value={pageFocus}>
        <Outlet />
      </PageFocusContext>
    </div>
  );
}

/**
 * The content target of a page of Studio's own layer, its `main`: named to the frame for "Skip to content", and
 * focused after a route change once the page has rendered; a first load leaves focus where it is.
 */
function useStudioContentTarget(target: RefObject<HTMLElement | null>): void {
  const { routeChanges, nameContentTarget } = useContext(PageFocusContext);
  useEffect(
    () =>
      nameContentTarget(() => {
        target.current?.focus();
      }),
    [nameContentTarget, target],
  );
  useEffect(() => {
    if (routeChanges > 0) {
      target.current?.focus();
    }
  }, [routeChanges, target]);
}

interface StudioPageProps {
  /** The page's `h1`, for the document title; `null` on Home, whose title is Studio's name alone. */
  title: string | null;
  children: ReactNode;
}

/**
 * A page of Studio's own layer, below the bar: Studio's one `main` landmark, named by the page's `h1`. It is the
 * page's content target; it takes focus from script only (`tabindex="-1"`), so it is not a Tab stop.
 */
export function StudioPage({ title, children }: StudioPageProps) {
  useDocumentTitle(title);
  const main = useRef<HTMLElement>(null);
  useStudioContentTarget(main);
  return (
    <main ref={main} id={MAIN_ID} className="st-main" tabIndex={-1} aria-labelledby={PAGE_TITLE_ID}>
      {children}
    </main>
  );
}

interface ProviderPageProps {
  /** The provider's area, loaded on first render (`React.lazy` of the provider's `loadArea`). */
  area: ComponentType<ProviderAreaProps>;
}

/**
 * Everything under a provider's segment: its area, below the bar, in a holder that is layout only. The area brings
 * its own `main` landmark, tells the page's title, from which the document title is made, and names its content
 * target; it moves focus to that target itself on a route change.
 */
export function ProviderPage({ area: Area }: ProviderPageProps) {
  // Unknown until the area, once loaded, tells its page's title.
  const [title, setTitle] = useState<string>();
  useDocumentTitle(title);
  const { routeChanges, nameContentTarget } = useContext(PageFocusContext);
  // The area's content target, as the area named it; none until its code has loaded.
  const areaFocus = useRef<FocusContent | null>(null);
  const handleContentTarget = useCallback((focus: FocusContent | null) => {
    areaFocus.current = focus;
  }, []);
  useEffect(
    () =>
      nameContentTarget(() => {
        areaFocus.current?.();
      }),
    [nameContentTarget],
  );
  return (
    <div className="st-area">
      <Suspense fallback={null}>
        <Area
          headerSelector={`#${BAR_ID}`}
          onPageTitle={setTitle}
          onContentTarget={handleContentTarget}
          routeChanges={routeChanges}
        />
      </Suspense>
    </div>
  );
}
