import AppLayout, { type AppLayoutProps } from '@cloudscape-design/components/app-layout';
import BreadcrumbGroup, { type BreadcrumbGroupProps } from '@cloudscape-design/components/breadcrumb-group';
import { I18nProvider } from '@cloudscape-design/components/i18n';
import englishMessages from '@cloudscape-design/components/i18n/messages/all.en';
import SideNavigation, { type SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import { AWS_NAME, AWS_PATH, AWS_SHORT_NAME, servicePath } from '../identity';
import { SERVICES } from '../services';
import { areaPage, areaPageTitle, type AreaPage } from './area-page';
import { AreaRootContext } from './area-root';
import { AREA_ROOT_CLASS } from './styles/root-class';
import { useColourMode } from './colour-mode';
import { ContentTarget } from './components/content-target';
import type { AreaConnection } from './components/emulator-line';
import { EmulatorLineAndNotice } from './components/local-notice';
import { PageHelpContext } from './components/page-help';
import { PageResourcesContext, type PageResources } from './components/page-resources';
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

/** The area's own navigation, on every page that is not a screen with its own (requirement R5.1). */
const NAVIGATION_ITEMS: SideNavigationProps.Item[] = [
  {
    type: 'section',
    text: 'Services',
    items: SERVICES.map((service) => ({ type: 'link', text: service.label, href: servicePath(service) })),
  },
];

/**
 * The layout's labels. The help panel's toggle stays while the panel is open and then closes it, so it is named for
 * what it does next (requirement R5.6): "Open help panel" while the panel is closed, "Close help panel" while it is open.
 */
const APP_LAYOUT_LABELS = {
  navigation: 'Navigation',
  navigationClose: 'Close navigation',
  navigationToggle: 'Open navigation',
  tools: 'Help panel',
  toolsClose: 'Close help panel',
  toolsToggle: 'Open help panel',
};

const APP_LAYOUT_LABELS_HELP_OPEN = { ...APP_LAYOUT_LABELS, toolsToggle: 'Close help panel' };

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
    case 'screen':
      return [
        ...AREA_CRUMBS,
        { text: page.service.crumb, href: servicePath(page.service) },
        { text: page.screen.crumb, href: pathname },
      ];
    case 'service':
      return [...AREA_CRUMBS, { text: page.service.crumb, href: servicePath(page.service) }];
    case 'not-found':
      return [...AREA_CRUMBS, { text: areaPageTitle(page), href: pathname }];
  }
}

/** The side navigation: a screen's own (R5.1), or the area's header and services with the page's service active. */
function navigation(page: AreaPage): SideNavigationProps {
  if (page.kind === 'screen') {
    const { header, items, activeHref } = page.screen.navigation;
    return { header, items, activeHref };
  }
  return {
    header: { text: AWS_NAME, href: AWS_PATH },
    items: NAVIGATION_ITEMS,
    activeHref: page.kind === 'service' ? servicePath(page.service) : '',
  };
}

function PageContent({ page }: { page: AreaPage }) {
  switch (page.kind) {
    case 'index':
      return <IndexPage />;
    case 'screen':
      return <page.screen.Page />;
    case 'service':
      return <NoScreenPage service={page.service} />;
    case 'not-found':
      return <NotFoundPage />;
  }
}

/**
 * The AWS area, at `/aws` and below, as the AWS console: an `AppLayout` with the side navigation of the services
 * and breadcrumbs from EmuForge. A `console` screen (`screens.ts`) brings its own title, crumb and side navigation,
 * and its help, which the layout's tools region shows as the help panel; a page that gives no help has no panel and
 * no toggle for one (requirement R5 of issue 56). Its root element carries Cloudscape's mode and scopes Cloudscape's
 * base. It names its content target to Studio and moves focus to it after a route change. The content target holds
 * the emulator line, the local-emulator notice when the page names its resources, then the page (requirement R4.8),
 * so what is read first after a move is that this is a local emulator and not AWS. A page names its resources with
 * `useShowsResources` (R5); the area's own pages name none and carry neither the notice nor the (i) control.
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

  // What the page shows of the emulator, as it names it; the notice's open state outlives the page (R5.3).
  const [resources, setResources] = useState<PageResources | null>(null);

  // The help panel of a screen that gives help (issue 56, R5.6): open for the visit it was opened on, so a route
  // change closes it. Opened by the screen ("Info"), it takes focus and gives it back to the opener when closed;
  // opened by its toggle, Cloudscape moves focus to it and back to the toggle.
  const Help = page.kind === 'screen' ? page.screen.help : undefined;
  const hasHelp = Help !== undefined;
  const layout = useRef<AppLayoutProps.Ref>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [help, setHelp] = useState({ visit: routeChanges, open: false, asked: 0 });
  const helpOpen = hasHelp && help.open && help.visit === routeChanges;
  const openHelp = useCallback(
    (from?: HTMLElement | null) => {
      if (!hasHelp) {
        return;
      }
      const active = document.activeElement;
      opener.current = from ?? (active instanceof HTMLElement && active !== document.body ? active : null);
      setHelp((current) => ({ visit: routeChanges, open: true, asked: current.asked + 1 }));
    },
    [hasHelp, routeChanges],
  );
  const handleToolsChange = useCallback(
    ({ detail }: { detail: AppLayoutProps.ChangeDetail }) => {
      const open = detail.open;
      if (open) {
        opener.current = null;
      }
      setHelp((current) => ({ ...current, visit: routeChanges, open }));
    },
    [routeChanges],
  );
  useEffect(() => {
    if (help.asked > 0) {
      layout.current?.focusToolsClose();
    }
  }, [help.asked]);
  useEffect(() => {
    if (!helpOpen && opener.current !== null) {
      if (opener.current.isConnected) {
        opener.current.focus();
      }
      opener.current = null;
    }
  }, [helpOpen]);

  return (
    <div ref={root} className={AREA_ROOT_CLASS} lang="en">
      <I18nProvider locale="en" messages={CLOUDSCAPE_MESSAGES}>
        <AreaRootContext value={root}>
          <AppLayout
            ref={layout}
            headerSelector={headerSelector}
            tools={Help === undefined ? undefined : <Help />}
            toolsHide={Help === undefined}
            toolsOpen={helpOpen}
            onToolsChange={handleToolsChange}
            ariaLabels={helpOpen ? APP_LAYOUT_LABELS_HELP_OPEN : APP_LAYOUT_LABELS}
            breadcrumbs={
              <BreadcrumbGroup items={breadcrumbs(page, pathname)} ariaLabel="Breadcrumbs" onFollow={handleFollow} />
            }
            navigation={<SideNavigation {...navigation(page)} onFollow={handleFollow} />}
            content={
              // One target per path, so a route change between two paths of the same page focuses a new element.
              <ContentTarget key={pathname} targetRef={target}>
                <SpaceBetween size="m">
                  <EmulatorLineAndNotice connection={connection} resources={resources} />
                  <PageResourcesContext value={setResources}>
                    <PageHelpContext value={openHelp}>
                      <PageContent page={page} />
                    </PageHelpContext>
                  </PageResourcesContext>
                </SpaceBetween>
              </ContentTarget>
            }
          />
        </AreaRootContext>
      </I18nProvider>
    </div>
  );
}
