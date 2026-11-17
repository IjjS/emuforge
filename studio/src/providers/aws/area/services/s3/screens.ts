import type { ScreenNavigation, ServiceScreen } from '../../screens';
import { bucketPath, BUCKETS_PATH, CREATE_BUCKET_PATH, DIRECTORY_BUCKETS_PATH, S3_PATH } from './format';
import { BucketListHelp, BucketListPage } from './pages/bucket-list-page';
import { BucketPage } from './pages/bucket-page';
import { CreateBucketPage } from './pages/create-bucket-page';
import { DeleteBucketPage } from './pages/delete-bucket-page';
import { EmptyBucketPage } from './pages/empty-bucket-page';

/** S3's own side navigation, "General purpose buckets" current on every screen of a general purpose bucket. */
const NAVIGATION: ScreenNavigation = {
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
};

/** The crumb "Buckets", to the bucket list. */
const BUCKETS_CRUMB = { text: 'Buckets', href: BUCKETS_PATH };

/** S3's screens, which the area collects (issue 386, R3.1). */
export const SCREENS: readonly ServiceScreen[] = [
  // The general purpose bucket list (issue 56): at the service's route and at its own, neither redirecting.
  {
    paths: [S3_PATH, BUCKETS_PATH],
    title: 'Buckets',
    crumbs: [{ text: 'Buckets' }],
    navigation: NAVIGATION,
    help: BucketListHelp,
    Page: BucketListPage,
  },
  // S1, a bucket's page with its tab "Properties" (issue 256, R0, R4): at the bucket's route and at the tab's own,
  // neither redirecting. Its title and last crumb are the bucket's name; it gives no help.
  {
    paths: [`${BUCKETS_PATH}/{name}`, `${BUCKETS_PATH}/{name}/properties`],
    leadsTo: [`${S3_PATH}/bucket/{name}/property`],
    title: ({ name }) => name ?? '',
    crumbs: ({ name }) => [BUCKETS_CRUMB, { text: name ?? '' }],
    navigation: NAVIGATION,
    Page: BucketPage,
  },
  // S2, "Create bucket" (issue 256, R0, R4, R6): below "Buckets", without help.
  {
    paths: [CREATE_BUCKET_PATH],
    title: 'Create bucket',
    crumbs: [BUCKETS_CRUMB, { text: 'Create bucket' }],
    navigation: NAVIGATION,
    Page: CreateBucketPage,
  },
  // S3, "Empty bucket" (issue 256, R0, R4, R8): below the bucket's crumb, which leads to its page, without help. Its
  // status ("Empty bucket: Status") is a state of the page at the same address, not a screen.
  {
    paths: [`${S3_PATH}/bucket/{name}/empty`],
    title: 'Empty bucket',
    crumbs: ({ name }) => [BUCKETS_CRUMB, { text: name ?? '', href: bucketPath(name ?? '') }, { text: 'Empty bucket' }],
    navigation: NAVIGATION,
    Page: EmptyBucketPage,
  },
  // S4, "Delete bucket" (issue 256, R0, R4, R7): below the bucket's crumb, which leads to its page, without help.
  {
    paths: [`${S3_PATH}/bucket/{name}/delete`],
    title: 'Delete bucket',
    crumbs: ({ name }) => [
      BUCKETS_CRUMB,
      { text: name ?? '', href: bucketPath(name ?? '') },
      { text: 'Delete bucket' },
    ],
    navigation: NAVIGATION,
    Page: DeleteBucketPage,
  },
];
