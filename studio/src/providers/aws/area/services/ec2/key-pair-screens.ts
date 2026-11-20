import type { ServiceScreen } from '../../screens';
import { CREATE_KEY_PAIR_PATH, CREATE_KEY_PAIR_TITLE, KEY_PAIRS_PATH, KEY_PAIRS_TITLE } from './format';
import { KEY_PAIRS_NAVIGATION } from './navigation';
import { CreateKeyPairPage } from './pages/create-key-pair-page';
import { KeyPairListPage } from './pages/key-pair-list-page';

/** EC2's screens of S8 and S9, the key pairs (issue 553, task 5), which `screens.ts` collects. */
export const KEY_PAIR_SCREENS: readonly ServiceScreen[] = [
  // S8: the key pairs.
  {
    paths: [KEY_PAIRS_PATH],
    title: KEY_PAIRS_TITLE,
    crumbs: [{ text: KEY_PAIRS_TITLE }],
    navigation: KEY_PAIRS_NAVIGATION,
    Page: KeyPairListPage,
  },
  // S9: "Create key pair".
  {
    paths: [CREATE_KEY_PAIR_PATH],
    title: CREATE_KEY_PAIR_TITLE,
    crumbs: [{ text: KEY_PAIRS_TITLE, href: KEY_PAIRS_PATH }, { text: CREATE_KEY_PAIR_TITLE }],
    navigation: KEY_PAIRS_NAVIGATION,
    Page: CreateKeyPairPage,
  },
];
