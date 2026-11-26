import type { ServiceScreen } from '../../screens';
import { STACKS_TITLE, StacksPage } from './pages/stacks-page';

const SERVICE_PATH = '/aws/cloudformation';
const STACKS_PATH = '/aws/cloudformation/stacks';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [SERVICE_PATH, STACKS_PATH],
    title: STACKS_TITLE,
    crumbs: [{ text: STACKS_TITLE }],
    navigation: {
      header: { text: 'CloudFormation', href: SERVICE_PATH },
      activeHref: STACKS_PATH,
    },
    Page: StacksPage,
  },
];
