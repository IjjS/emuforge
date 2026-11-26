import type { ScreenNavigation, ServiceScreen } from '../../screens';
import { CreateKeyPage, KEY_CREATE_PATH, KEY_CREATE_TITLE } from './pages/create';
import { KeyPage } from './pages/key';
import { KeysPage } from './pages/keys';
import { KEY_LIST_PATH, KEY_PATH, KEYS_PATH, KEYS_TITLE } from './paths';

const navigation: ScreenNavigation = {
  header: { text: 'KMS', href: KEYS_PATH },
  activeHref: KEY_LIST_PATH,
};

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [KEYS_PATH, KEY_LIST_PATH],
    title: KEYS_TITLE,
    crumbs: [{ text: KEYS_TITLE }],
    navigation,
    Page: KeysPage,
  },
  {
    paths: [KEY_CREATE_PATH],
    title: KEY_CREATE_TITLE,
    crumbs: [{ text: KEYS_TITLE, href: KEYS_PATH }, { text: KEY_CREATE_TITLE }],
    navigation,
    Page: CreateKeyPage,
  },
  {
    paths: [KEY_PATH],
    title: ({ keyid }) => keyid ?? 'Key details',
    crumbs: ({ keyid }) => [{ text: KEYS_TITLE, href: KEYS_PATH }, { text: keyid ?? 'Key details' }],
    navigation,
    Page: KeyPage,
  },
];
