import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import type { ComponentType } from 'react';

import type { AreaConnection } from './components/emulator-line';
import { BucketListHelp, BucketListPage } from './services/s3/pages/bucket-list-page';
import { BUCKETS_PATH, DIRECTORY_BUCKETS_PATH, S3_PATH } from './services/s3/format';

/** A screen's own side navigation, which replaces the area's services list on the screen's paths (requirement R5.1). */
export interface ScreenNavigation {
  /** The navigation's header: the service's name and the address it leads to. */
  header: { text: string; href: string };
  /** The navigation's sections and links, in visible order. */
  items: readonly SideNavigationProps.Item[];
  /** The link shown current on every path of the screen. */
  activeHref: string;
}

/** What the area's layout hands a screen's page: the connection Studio hands the area, as it last read it. */
export interface ScreenPageProps {
  connection: AreaConnection;
}

/**
 * A `console` screen of the area (requirement R5): what the area's layout shows around it. The screen's page renders
 * its own `h1`, which is `title`; the layout reports `title` to Studio's frame and names the content target by the
 * `h1`, gives the crumbs `EmuForge > AWS > <service's crumb> > <crumb>`, the screen's navigation, and the help panel
 * when the screen gives help.
 */
export interface AreaScreen {
  /** The route of the service the screen belongs to, as `services.ts` gives it (`/s3`). */
  service: string;
  /** The paths of the area the screen is shown at, each matched exactly (`/aws/s3`, `/aws/s3/buckets`). */
  paths: readonly string[];
  /** The page's title: its `h1`, the title reported to Studio's frame, the name of the content target. */
  title: string;
  /** The last crumb, the current page, which is not a link. */
  crumb: string;
  navigation: ScreenNavigation;
  /** The help panel's content (a Cloudscape `HelpPanel`); a screen without it shows no help toggle. */
  help?: ComponentType;
  /** The page. */
  Page: ComponentType<ScreenPageProps>;
}

/**
 * The area's `console` screens. A path that no screen lists shows the area's own page for it, as before: the index,
 * the "no screen yet" page of its service, or the area's "Page not found".
 */
export const SCREENS: readonly AreaScreen[] = [
  // S3's general purpose bucket list (issue 56): at the service's route and at its own, neither redirecting.
  {
    service: '/s3',
    paths: [S3_PATH, BUCKETS_PATH],
    title: 'Buckets',
    crumb: 'Buckets',
    navigation: {
      header: { text: 'Amazon S3', href: S3_PATH },
      items: [
        {
          type: 'section',
          text: 'Buckets',
          items: [
            { type: 'link', text: 'General purpose buckets', href: BUCKETS_PATH },
            { type: 'link', text: 'Directory buckets', href: DIRECTORY_BUCKETS_PATH },
          ],
        },
      ],
      activeHref: BUCKETS_PATH,
    },
    help: BucketListHelp,
    Page: BucketListPage,
  },
];
