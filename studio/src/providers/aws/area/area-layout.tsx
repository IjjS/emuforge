import AppLayout from '@cloudscape-design/components/app-layout';
import BreadcrumbGroup, { type BreadcrumbGroupProps } from '@cloudscape-design/components/breadcrumb-group';
import SideNavigation, { type SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { AWS_NAME, AWS_PATH, servicePath } from '../identity';
import { SERVICES } from '../services';
import { areaPage, areaPageTitle, type AreaPage } from './area-page';
import { AreaRootContext } from './area-root';
import { AREA_ROOT_CLASS } from './styles/root-class';
import { useColourMode } from './colour-mode';
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
 * and breadcrumbs, no tools panel. Its root element carries Cloudscape's mode and scopes Cloudscape's base.
 */
export function AreaLayout({ headerSelector, onPageTitle }: AreaLayoutProps) {
  const { pathname } = useLocation();
  const handleFollow = useFollow();
  const root = useRef<HTMLDivElement>(null);
  useColourMode(root);

  const page = areaPage(pathname);
  const title = areaPageTitle(page);
  useEffect(() => {
    onPageTitle(title);
  }, [onPageTitle, title]);

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
          content={<PageContent page={page} />}
        />
      </AreaRootContext>
    </div>
  );
}
