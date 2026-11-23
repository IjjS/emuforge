import type { ScreenNavigation, ServiceScreen } from '../../screens';
import { CreateSecretPage } from './pages/create-page';
import { SecretPage } from './pages/secret-page';
import { SecretsPage } from './pages/secrets-page';
import { SECRET_CREATE_PATH, SECRET_DETAIL_PATH, SECRETS_MANAGER_PATH, SECRETS_PATH, secretName } from './paths';

const NAVIGATION: ScreenNavigation = {
  header: { text: 'Secrets Manager', href: SECRETS_MANAGER_PATH },
  items: [{ type: 'link', text: 'Secrets', href: SECRETS_PATH }],
  activeHref: SECRETS_PATH,
};

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [SECRETS_MANAGER_PATH, SECRETS_PATH],
    title: 'Secrets',
    crumbs: [{ text: 'Secrets' }],
    navigation: NAVIGATION,
    Page: SecretsPage,
  },
  {
    paths: [SECRET_CREATE_PATH],
    title: 'Store a secret',
    crumbs: [{ text: 'Secrets', href: SECRETS_PATH }, { text: 'Store a secret' }],
    navigation: NAVIGATION,
    Page: CreateSecretPage,
  },
  {
    paths: [SECRET_DETAIL_PATH],
    title: (_, query) => secretName(query) || 'Secret details',
    crumbs: (_, query) => [{ text: 'Secrets', href: SECRETS_PATH }, { text: secretName(query) || 'Secret details' }],
    navigation: NAVIGATION,
    Page: SecretPage,
  },
];
