import AppLayout from '@cloudscape-design/components/app-layout';
import BreadcrumbGroup, { type BreadcrumbGroupProps } from '@cloudscape-design/components/breadcrumb-group';
import { I18nProvider } from '@cloudscape-design/components/i18n';
import englishMessages from '@cloudscape-design/components/i18n/messages/all.en';
import SideNavigation, { type SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { AWS_NAME, AWS_PATH, AWS_SHORT_NAME, servicePath } from '../identity';
import { SERVICES } from '../services';
import { areaPage, areaPageTitle, type AreaPage } from './area-page';
import { AreaRootContext } from './area-root';
import { AREA_ROOT_CLASS } from './styles/root-class';
import { useColourMode } from './colour-mode';
import { ContentTarget } from './components/content-target';
import { EmulatorLine, type AreaConnection } from './components/emulator-line';
import { useFollow } from './components/use-follow';
import { IndexPage } from './pages/index-page';
import { NoScreenPage } from './pages/no-screen-page';
import { NotFoundPage } from './pages/not-found-page';

/** What Studio hands the area (Studio's `ProviderAreaProps`; the area imports nothing of Studio's own). */
export interface AreaLayoutProps {
  /** A CSS selector of Studio's top bar, above the area. */
  headerSelector: string;
  /** Called with the title of the page shown, its `h1`, whenever it changes. */
  onPageTitle: (title: string) => void;
  /** Called with a function that focuses the content target of the page shown, and with `null` once it is gone. */
  onContentTarget: (focus: (() => void) | null) => void;
  /** Route changes since the document loaded: `0` on a first load, one more on each change of path. */
  routeChanges: number;
  /** The engine's connection status, as Studio's frame last read it; the area never asks for it itself. */
  connection: AreaConnection;
}

const NAVIGATION_ITEMS: SideNavigationProps.Item[] = [
  {
    type: 'section',
    text: 'Services',
    items: SERVICES.map((service) => ({ type: 'link', text: service.label, href: servicePath(service) })),
  },
];

const APP_LAYOUT_LABELS = {
  navigation: 'Navigation',
  navigationClose: 'Close navigation',
  navigationToggle: 'Open navigation',
};

/** Cloudscape's own English text, for the built-in strings of the components the area renders. */
const CLOUDSCAPE_MESSAGES = [englishMessages];

/** The first crumbs of every page (requirement R3): EmuForge's Home, then the area's index. */
const AREA_CRUMBS: BreadcrumbGroupProps.Item[] = [
  { text: 'EmuForge', href: '/' },
  { text: AWS_SHORT_NAME, href: AWS_PATH },
];

/** `EmuForge > AWS > <service's crumb> > …`; the last crumb is the current page, which Cloudscape shows as no link. */
function breadcrumbs(page: AreaPage, pathname: string): BreadcrumbGroupProps.Item[] {
  switch (page.kind) {
    case 'index':
      return AREA_CRUMBS;
    case 'service':
      return [...AREA_CRUMBS, { text: page.service.crumb, href: servicePath(page.service) }];
    case 'not-found':
      return [...AREA_CRUMBS, { text: areaPageTitle(page), href: pathname }];
  }
}

function activeHref(page: AreaPage): string {
  return page.kind === 'service' ? servicePath(page.service) : '';
}

function PageContent({ page }: { page: AreaPage }) {
  switch (page.kind) {
    case 'index':
      return <IndexPage />;
    case 'service':
      return <NoScreenPage service={page.service} />;
    case 'not-found':
      return <NotFoundPage />;
  }
}

/**
 * The AWS area, at `/aws` and below, as the AWS console: an `AppLayout` with the side navigation of the services
 * and breadcrumbs from EmuForge, no tools panel. Its root element carries Cloudscape's mode and scopes Cloudscape's
 * base. It names its content target to Studio and moves focus to it after a route change. The content target holds
 * the emulator line, then the page (requirement R4.8), so what is read first after a move is that this is a local
 * emulator and not AWS.
 *
 * The area is English in every language of Studio (issue #17, R7): its root says so with `lang="en"`, and Cloudscape's
 * locale is `en` for everything it renders, whatever the document's `lang` and the browser's languages, so a date, a
 * number or a component's built-in text comes out in English.
 */
export function AreaLayout({
  headerSelector,
  onPageTitle,
  onContentTarget,
  routeChanges,
  connection,
}: AreaLayoutProps) {
  const { pathname } = useLocation();
  const handleFollow = useFollow();
  const root = useRef<HTMLDivElement>(null);
  useColourMode(root);

  const page = areaPage(pathname);
  const title = areaPageTitle(page);
  useEffect(() => {
    onPageTitle(title);
  }, [onPageTitle, title]);

  // The page's content target: named to Studio for "Skip to content", focused after a route change once the page
  // has rendered (on the area's first render too, when a route change opened it), never on a first load.
  const target = useRef<HTMLElement>(null);
  const focusTarget = useCallback(() => {
    target.current?.focus();
  }, []);
  useEffect(() => {
    onContentTarget(focusTarget);
    return () => {
      onContentTarget(null);
    };
  }, [onContentTarget, focusTarget]);
  useEffect(() => {
    if (routeChanges > 0) {
      focusTarget();
    }
  }, [routeChanges, focusTarget]);

  return (
    <div ref={root} className={AREA_ROOT_CLASS} lang="en">
      <I18nProvider locale="en" messages={CLOUDSCAPE_MESSAGES}>
        <AreaRootContext value={root}>
          <AppLayout
            headerSelector={headerSelector}
            toolsHide
            ariaLabels={APP_LAYOUT_LABELS}
            breadcrumbs={
              <BreadcrumbGroup items={breadcrumbs(page, pathname)} ariaLabel="Breadcrumbs" onFollow={handleFollow} />
            }
            navigation={
              <SideNavigation
                header={{ text: AWS_NAME, href: AWS_PATH }}
                activeHref={activeHref(page)}
                items={NAVIGATION_ITEMS}
                onFollow={handleFollow}
              />
            }
            content={
              // One target per path, so a route change between two paths of the same page focuses a new element.
              <ContentTarget key={pathname} targetRef={target}>
                <SpaceBetween size="m">
                  <EmulatorLine connection={connection} />
                  <PageContent page={page} />
                </SpaceBetween>
              </ContentTarget>
            }
          />
        </AreaRootContext>
      </I18nProvider>
    </div>
  );
}
