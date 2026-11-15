import '../ui/bar.css';
import '../ui/page.css';

import { Suspense, useEffect, useState, type ComponentType, type MouseEvent, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { PROVIDERS, type ProviderAreaProps } from './provider-list';

export const STUDIO_NAME = 'EmuForge Studio';

/** The id of Studio's top bar; a provider's area keeps its own sticky parts below it. */
const BAR_ID = 'studio-bar';

/** The id of Studio's own `main`, the target of "Skip to content" on Studio's own pages. */
const MAIN_ID = 'main';

/** The document title of requirement R4.4: `<page title> | EmuForge Studio`, or `EmuForge Studio` on Home. */
function useDocumentTitle(pageTitle: string | null): void {
  useEffect(() => {
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
 * "Skip to content": moves focus to the page's one `main`, Studio's own or the provider area's. A `main` that takes
 * no focus of its own is made focusable by script only (`tabindex="-1"`), so it is not a Tab stop.
 */
function handleSkip(event: MouseEvent<HTMLAnchorElement>) {
  const main = document.querySelector('main');
  if (main === null) {
    return;
  }
  event.preventDefault();
  if (!main.hasAttribute('tabindex')) {
    main.setAttribute('tabindex', '-1');
  }
  main.focus();
}

/**
 * Studio's frame on every page (requirement R5.1): the top bar with "EmuForge Studio" and the navigation "Studio",
 * Home and one link per provider of the providers list, then the page. Built from Studio's own design only.
 */
export function Frame() {
  const { pathname } = useLocation();
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
      <Outlet />
    </div>
  );
}

interface StudioPageProps {
  /** The page's `h1`, for the document title; `null` on Home, whose title is Studio's name alone. */
  title: string | null;
  children: ReactNode;
}

/** A page of Studio's own layer, below the bar: Studio's one `main` landmark. */
export function StudioPage({ title, children }: StudioPageProps) {
  useDocumentTitle(title);
  return (
    <main id={MAIN_ID} className="st-main" tabIndex={-1}>
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
 * its own `main` landmark and tells the page's title, from which the document title is made.
 */
export function ProviderPage({ area: Area }: ProviderPageProps) {
  const [title, setTitle] = useState<string | null>(null);
  useDocumentTitle(title);
  return (
    <div className="st-area">
      <Suspense fallback={null}>
        <Area headerSelector={`#${BAR_ID}`} onPageTitle={setTitle} />
      </Suspense>
    </div>
  );
}
