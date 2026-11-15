import AppLayout from '@cloudscape-design/components/app-layout';
import BreadcrumbGroup, { type BreadcrumbGroupProps } from '@cloudscape-design/components/breadcrumb-group';
import SideNavigation, { type SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { AWS_NAME, AWS_PATH, servicePath } from '../identity';
import { SERVICES } from '../services';
import { areaPage, areaPageTitle, type AreaPage } from './area-page';
import { AreaRootContext } from './area-root';
import { AREA_ROOT_CLASS } from './styles/root-class';
import { useColourMode } from './colour-mode';
import { ContentTarget } from './components/content-target';
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

const HOME_CRUMB: BreadcrumbGroupProps.Item = { text: AWS_NAME, href: AWS_PATH };

function breadcrumbs(page: AreaPage, pathname: string): BreadcrumbGroupProps.Item[] {
  switch (page.kind) {
    case 'index':
      return [HOME_CRUMB];
    case 'service':
      return [HOME_CRUMB, { text: page.service.label, href: servicePath(page.service) }];
    case 'not-found':
      return [HOME_CRUMB, { text: areaPageTitle(page), href: pathname }];
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
 * and breadcrumbs, no tools panel. Its root element carries Cloudscape's mode and scopes Cloudscape's base. It names
 * its content target to Studio and moves focus to it after a route change.
 */
export function AreaLayout({ headerSelector, onPageTitle, onContentTarget, routeChanges }: AreaLayoutProps) {
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
    <div ref={root} className={AREA_ROOT_CLASS}>
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
              <PageContent page={page} />
            </ContentTarget>
          }
        />
      </AreaRootContext>
    </div>
  );
}
