import type { ServiceScreen } from '../../screens';
import { BUCKETS_PATH, DIRECTORY_BUCKETS_PATH, S3_PATH } from './format';
import { BucketListHelp, BucketListPage } from './pages/bucket-list-page';

/** S3's screens, which the area collects (issue 386, R3.1). */
export const SCREENS: readonly ServiceScreen[] = [
  // The general purpose bucket list (issue 56): at the service's route and at its own, neither redirecting.
  {
    paths: [S3_PATH, BUCKETS_PATH],
    title: 'Buckets',
    crumbs: [{ text: 'Buckets' }],
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
