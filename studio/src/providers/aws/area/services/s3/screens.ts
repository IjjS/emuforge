import type { ScreenCrumbs, ScreenNavigation, ServiceScreen } from '../../screens';
import {
  bucketPath,
  bucketPropertiesPath,
  BUCKETS_PATH,
  CREATE_BUCKET_PATH,
  keyName,
  keyPrefix,
  objectsPath,
  prefixParts,
  S3_PATH,
} from './format';
import { BucketListHelp, BucketListPage } from './pages/bucket-list-page';
import { BucketPage } from './pages/bucket-page';
import { CreateBucketPage } from './pages/create-bucket-page';
import { DeleteBucketPage } from './pages/delete-bucket-page';
import { EmptyBucketPage } from './pages/empty-bucket-page';
import { CREATE_TITLE, EDIT_TITLE, NotificationPage } from './pages/notification-page';
import { ObjectPage } from './pages/object-page';
import { UploadPage } from './pages/upload-page';
import { VERSIONING_TITLE, VersioningPage } from './pages/versioning-page';
import { withAbandonedUploads } from './components/upload-abandoned-flash';

/** S3's own side navigation, "General purpose buckets" current on every screen of a general purpose bucket. */
const NAVIGATION: ScreenNavigation = {
  header: { text: 'Amazon S3', href: S3_PATH },
  items: [
    {
      type: 'section',
      text: 'Buckets',
      items: [{ type: 'link', text: 'General purpose buckets', href: BUCKETS_PATH }],
    },
  ],
  activeHref: BUCKETS_PATH,
};

/** The crumb "Buckets", to the bucket list. */
const BUCKETS_CRUMB = { text: 'Buckets', href: BUCKETS_PATH };

/**
 * The crumbs of a bucket's page: "Buckets", the bucket's name, then each part of the folder the address's `?prefix=`
 * names (issue 480, task 1), each but the last a link to the tab "Objects" at its prefix; at the root the name is last.
 */
function bucketCrumbs(name: string, query: URLSearchParams): ScreenCrumbs {
  const parts = prefixParts(query.get('prefix') ?? '');
  if (parts.length === 0) {
    return [BUCKETS_CRUMB, { text: name }];
  }
  const last = parts[parts.length - 1] as (typeof parts)[number];
  return [
    BUCKETS_CRUMB,
    { text: name, href: objectsPath(name) },
    ...parts.slice(0, -1).map((part) => ({ text: part.text, href: objectsPath(name, part.prefix) })),
    { text: last.text },
  ];
}

/**
 * The crumbs of an object's page (issue 480, task 2): "Buckets", the bucket's name, each part of the folder the key is
 * in, every one a link to the tab "Objects" at its prefix, then the key's name, not a link.
 */
function objectCrumbs(name: string, query: URLSearchParams): ScreenCrumbs {
  const key = query.get('key') ?? '';
  return [
    BUCKETS_CRUMB,
    { text: name, href: objectsPath(name) },
    ...prefixParts(keyPrefix(key)).map((part) => ({ text: part.text, href: objectsPath(name, part.prefix) })),
    { text: keyName(key) },
  ];
}

/**
 * The crumbs of "Upload" (issue 480, task 3): "Buckets", the bucket's name, each part of the folder the files go to,
 * every one a link to the tab "Objects" at its prefix, then "Upload".
 */
function uploadCrumbs(name: string, query: URLSearchParams): ScreenCrumbs {
  return [
    BUCKETS_CRUMB,
    { text: name, href: objectsPath(name) },
    ...prefixParts(query.get('prefix') ?? '').map((part) => ({
      text: part.text,
      href: objectsPath(name, part.prefix),
    })),
    { text: 'Upload' },
  ];
}

/** S3's screens as written, before each page is made to show the uploads "Upload" could not abort. */
const OWN_SCREENS: readonly ServiceScreen[] = [
  // The general purpose bucket list (issue 56): at the service's route and at its own, neither redirecting.
  {
    paths: [S3_PATH, BUCKETS_PATH],
    title: 'Buckets',
    crumbs: [{ text: 'Buckets' }],
    navigation: NAVIGATION,
    help: BucketListHelp,
    Page: BucketListPage,
  },
  // S1, a bucket's page (issue 256, R0, R4; issue 480): its tab "Objects" at the bucket's route and at the tab's own,
  // its tab "Properties" at its own, none redirecting. Its title is the bucket's name; its crumbs end at the name, or
  // at the folder the Objects tab shows; it gives no help.
  {
    paths: [`${BUCKETS_PATH}/{name}`, `${BUCKETS_PATH}/{name}/objects`, `${BUCKETS_PATH}/{name}/properties`],
    leadsTo: [`${S3_PATH}/bucket/{name}/property`],
    title: ({ name }) => name ?? '',
    crumbs: ({ name }, query) => bucketCrumbs(name ?? '', query),
    navigation: NAVIGATION,
    Page: BucketPage,
  },
  {
    paths: [`${S3_PATH}/bucket/{name}/property/versioning/edit`],
    title: VERSIONING_TITLE,
    crumbs: ({ name }) => [
      BUCKETS_CRUMB,
      { text: name ?? '', href: bucketPropertiesPath(name ?? '') },
      { text: VERSIONING_TITLE },
    ],
    navigation: NAVIGATION,
    Page: VersioningPage,
  },
  ...[
    { path: 'create', title: CREATE_TITLE },
    { path: '{id}/edit', title: EDIT_TITLE },
  ].map(({ path, title }): ServiceScreen => ({
    paths: [`${S3_PATH}/bucket/{name}/property/event-notification/${path}`],
    title,
    crumbs: ({ name }) => [
      BUCKETS_CRUMB,
      { text: name ?? '', href: bucketPropertiesPath(name ?? '') },
      { text: title },
    ],
    navigation: NAVIGATION,
    Page: NotificationPage,
  })),
  // An object's page (issue 480, task 2): its key in the query, `?key=`; its title the key's name.
  {
    paths: [`${BUCKETS_PATH}/{name}/object`],
    title: (_, query) => keyName(query.get('key') ?? ''),
    crumbs: ({ name }, query) => objectCrumbs(name ?? '', query),
    navigation: NAVIGATION,
    Page: ObjectPage,
  },
  // "Upload" into a folder of a bucket (issue 480, task 3): the folder in the query, `?prefix=`.
  {
    paths: [`${S3_PATH}/bucket/{name}/upload`],
    title: 'Upload',
    crumbs: ({ name }, query) => uploadCrumbs(name ?? '', query),
    navigation: NAVIGATION,
    Page: UploadPage,
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

/**
 * S3's screens, which the area collects (issue 386, R3.1). Each page shows, in the area's flash, a multipart upload the
 * Upload page left unfinished because its abort failed, also once the Upload page is gone (issue 480, task 3).
 */
export const SCREENS: readonly ServiceScreen[] = OWN_SCREENS.map((screen) => ({
  ...screen,
  Page: withAbandonedUploads(screen.Page),
}));
