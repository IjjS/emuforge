import AppLayout from '@cloudscape-design/components/app-layout';
import BreadcrumbGroup, { type BreadcrumbGroupProps } from '@cloudscape-design/components/breadcrumb-group';
import SideNavigation, { type SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import { useEffect } from 'react';
import { Outlet, useLocation, useMatches, useNavigate } from 'react-router';

import { useFollow } from '../components/use-follow';
import { SERVICES } from './services';

export const STUDIO_NAME = 'EmuForge Studio';

/** What a route tells the shell: its breadcrumb after "EmuForge Studio", and its navigation item. */
export interface ShellHandle {
  /** The page's own breadcrumb; absent on Home, whose only breadcrumb is "EmuForge Studio". */
  breadcrumb?: (pathname: string) => BreadcrumbGroupProps.Item;
  /** The `href` of the active navigation item; `''` when the page has none. */
  activeHref: string;
}

const NAVIGATION_ITEMS: SideNavigationProps.Item[] = [
  { type: 'link', text: 'Home', href: '/' },
  { type: 'divider' },
  {
    type: 'section',
    text: 'Services',
    items: SERVICES.map(({ label, route }) => ({ type: 'link', text: label, href: route })),
  },
];

const APP_LAYOUT_LABELS = {
  navigation: 'Navigation',
  navigationClose: 'Close navigation',
  navigationToggle: 'Open navigation',
};

const TOP_NAVIGATION_ID = 'top-navigation';

function isShellHandle(handle: unknown): handle is ShellHandle {
  return typeof handle === 'object' && handle !== null && 'activeHref' in handle;
}

/** Every page sits in this shell: top navigation, side navigation, breadcrumbs (requirement 2). */
export function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const handleFollow = useFollow();
  const handle = useMatches()
    .map((match) => match.handle)
    .filter(isShellHandle)
    .at(-1) ?? { activeHref: '' };

  const own = handle.breadcrumb?.(pathname);
  const breadcrumbs: BreadcrumbGroupProps.Item[] = [{ text: STUDIO_NAME, href: '/' }, ...(own ? [own] : [])];

  const title = own ? `${own.text} | ${STUDIO_NAME}` : STUDIO_NAME;
  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <>
      <div id={TOP_NAVIGATION_ID}>
        <TopNavigation
          identity={{
            title: STUDIO_NAME,
            href: '/',
            onFollow: (event) => {
              event.preventDefault();
              void navigate('/');
            },
          }}
        />
      </div>
      <AppLayout
        headerSelector={`#${TOP_NAVIGATION_ID}`}
        toolsHide
        ariaLabels={APP_LAYOUT_LABELS}
        breadcrumbs={<BreadcrumbGroup items={breadcrumbs} ariaLabel="Breadcrumbs" onFollow={handleFollow} />}
        navigation={
          <SideNavigation
            header={{ text: STUDIO_NAME, href: '/' }}
            activeHref={handle.activeHref}
            items={NAVIGATION_ITEMS}
            onFollow={handleFollow}
          />
        }
        content={<Outlet />}
      />
    </>
  );
}
