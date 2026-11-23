import type { ScreenNavigation, ServiceScreen } from '../../screens';
import { KeyPage } from './pages/key';
import { KeysPage } from './pages/keys';
import { KEY_PATH, KEYS_PATH, KEYS_TITLE } from './paths';

const navigation: ScreenNavigation = {
  header: { text: 'KMS', href: KEYS_PATH },
  items: [{ type: 'link', text: KEYS_TITLE, href: KEYS_PATH }],
  activeHref: KEYS_PATH,
};

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [KEYS_PATH],
    title: KEYS_TITLE,
    crumbs: [{ text: KEYS_TITLE }],
    navigation,
    Page: KeysPage,
  },
  {
    paths: [KEY_PATH],
    title: ({ keyId }) => keyId ?? 'Key details',
    crumbs: ({ keyId }) => [{ text: KEYS_TITLE, href: KEYS_PATH }, { text: keyId ?? 'Key details' }],
    navigation,
    Page: KeyPage,
  },
];
