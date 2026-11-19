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
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Link, Outlet, useLocation } from 'react-router';

import { useConnectionCheck } from '../features/home/use-connection-check';

import type { MessageKey } from '../i18n/catalogue';
import { useLanguage } from '../i18n/language-context';
import { BrandTile } from '../ui/brand-tile';
import { LanguageControl } from '../ui/language-control';
import { PAGE_TITLE_ID } from '../ui/page-head';
import { PROVIDERS, type ProviderAreaProps, type ProviderConnection } from './provider-list';
import { createQueryClient } from './query-client';
import { useTargetSeen } from './target-seen';

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
  /** Tells the frame whether a dialog of the page's area is open: the bar is inert while one is. */
  onAreaModal: (open: boolean) => void;
}

const PageFocusContext = createContext<PageFocus>({
  routeChanges: 0,
  nameContentTarget: () => () => undefined,
  onAreaModal: () => undefined,
});

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
 * Studio's frame on every page (requirement R5.1): the top bar with the tile and "EmuForge Studio" (issue #36, R6), the
 * navigation "Studio" with Home, Connections (issue 486, R1) and one link per provider of the providers list, and the
 * language control (issue #17, R3.1), then the page. Built from Studio's own design only.
 */
export function Frame() {
  const { t } = useLanguage();
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
  // Whether a dialog of the area below is open (ProviderPage): the bar is then inert, out of the Tab order and of the
  // accessibility tree, while the dialog's backdrop, drawn above it, takes every press on it.
  const [areaModal, setAreaModal] = useState(false);
  const pageFocus = useMemo(
    () => ({ routeChanges, nameContentTarget, onAreaModal: setAreaModal }),
    [routeChanges, nameContentTarget],
  );

  /**
   * A tab that takes focus is scrolled into the tab list's view, should the list be wider than the bar (issue 486):
   * focus never lands on a tab out of sight.
   */
  const handleNavFocus = (event: FocusEvent<HTMLElement>) => {
    event.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  /** "Skip to content": focuses the content target the page named, and never follows its address. */
  const handleSkip = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    focusContent.current?.();
  };

  return (
    <div className="st-root">
      <header id={BAR_ID} className="st-bar" inert={areaModal}>
        <a className="st-skip" href={`#${MAIN_ID}`} onClick={handleSkip}>
          {t('frame.skip')}
        </a>
        {/* The tile, then the text. The space is inside the element that holds "Studio", so the link's name is
            "EmuForge Studio" whether that element is drawn or not (requirement R6.3, R6.5); the two holders are
            blocks, which a name computation that trims each element's text still separates by a space. */}
        <Link className="st-wordmark" to="/">
          <BrandTile />
          <div className="st-wordmark-text">
            <b>EmuForge</b>
            <div className="st-wordmark-studio"> Studio</div>
          </div>
        </Link>
        <nav className="st-nav" aria-label={t('frame.nav')} onFocus={handleNavFocus}>
          <Link to="/" aria-current={currentOf(pathname, '/', false)}>
            {t('frame.home')}
          </Link>
          <Link to="/connections" aria-current={currentOf(pathname, '/connections', false)}>
            {t('frame.connections')}
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
        <LanguageControl />
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
  /**
   * The message of the page's `h1`, for the document title in the current language; `null` on Home, whose title is
   * Studio's name alone (requirement R5.2).
   */
  title: MessageKey | null;
  children: ReactNode;
}

/**
 * A page of Studio's own layer, below the bar: Studio's one `main` landmark, named by the page's `h1`. It is the
 * page's content target; it takes focus from script only (`tabindex="-1"`), so it is not a Tab stop.
 */
export function StudioPage({ title, children }: StudioPageProps) {
  const { t } = useLanguage();
  useDocumentTitle(title === null ? null : t(title));
  const main = useRef<HTMLElement>(null);
  useStudioContentTarget(main);
  return (
    <main ref={main} id={MAIN_ID} className="st-main" tabIndex={-1} aria-labelledby={PAGE_TITLE_ID}>
      {children}
    </main>
  );
}

/** The connection before its first answer. */
const NO_ANSWER: ProviderConnection = { result: undefined, engineOrigin: undefined };

/**
 * Runs Home's connection check for as long as it is mounted and hands each answer up as a plain value. It renders
 * nothing.
 */
function ConnectionCheck({ onConnection }: { onConnection: (connection: ProviderConnection) => void }) {
  const { result, engineOrigin } = useConnectionCheck();
  useEffect(() => {
    onConnection({ result, engineOrigin });
  }, [onConnection, result, engineOrigin]);
  return null;
}

interface ProviderPageProps {
  /** The provider's area, loaded on first render (`React.lazy` of the provider's `loadArea`). */
  area: ComponentType<ProviderAreaProps>;
}

/**
 * Everything under a provider's segment: its area, below the bar, in a holder that is layout only; while a dialog of
 * the area is open, the holder lets the dialog be drawn above the bar. The area brings
 * its own `main` landmark, tells the page's title, from which the document title is made, and names its content
 * target; it moves focus to that target itself on a route change.
 *
 * It checks the engine's connection status as Home does, once when a page of the area opens and again 5 seconds after
 * each answer, and hands the latest answer to the area (issue 45, R4.4). It stays mounted across the area's route
 * changes, so the answer and the rhythm go on. The check runs in a query client of its own, made for this mount: Home
 * and the area use the same check under the same key, and Home, mounted in the same render that removes the area,
 * would otherwise be handed the area's last answer instead of checking afresh.
 */
export function ProviderPage({ area: Area }: ProviderPageProps) {
  const [checks] = useState(createQueryClient);
  const [connection, setConnection] = useState(NO_ANSWER);
  // Unknown until the area, once loaded, tells its page's title.
  const [title, setTitle] = useState<string>();
  useDocumentTitle(title);
  const { routeChanges, nameContentTarget, onAreaModal } = useContext(PageFocusContext);
  const { generation } = useTargetSeen();
  // Whether a dialog of the area is open, as the area tells it: the holder then makes no stacking context of its own,
  // so the dialog is drawn above Studio's bar (base.css, `.st-area`), and the frame makes the bar inert. Told to the
  // frame again once the holder goes, so the bar is never left inert.
  const [modal, setModal] = useState(false);
  useEffect(() => {
    onAreaModal(modal);
    return () => {
      onAreaModal(false);
    };
  }, [onAreaModal, modal]);
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
    <div className={modal ? 'st-area st-area-modal' : 'st-area'}>
      <QueryClientProvider client={checks}>
        <ConnectionCheck onConnection={setConnection} />
      </QueryClientProvider>
      <Suspense fallback={null}>
        <Area
          headerSelector={`#${BAR_ID}`}
          onPageTitle={setTitle}
          onContentTarget={handleContentTarget}
          routeChanges={routeChanges}
          connection={connection}
          targetGeneration={generation}
          onModal={setModal}
        />
      </Suspense>
    </div>
  );
}
