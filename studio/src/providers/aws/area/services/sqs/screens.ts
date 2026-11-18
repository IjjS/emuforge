import type { ScreenNavigation, ServiceScreen } from '../../screens';
import { QUEUES_PATH, SQS_PATH } from './format';
import { QUEUES_TITLE, QueueListPage } from './pages/queue-list-page';
import { QueuePage } from './pages/queue-page';

/** SQS's side navigation on its screens (issue 481, requirement "Screens, routes, layer"): "SQS" and "Queues". */
const NAVIGATION: ScreenNavigation = {
  header: { text: 'SQS', href: SQS_PATH },
  items: [{ type: 'link', text: QUEUES_TITLE, href: QUEUES_PATH }],
  activeHref: QUEUES_PATH,
};

/** SQS's screens, which the area collects (issue 386, R3.1). */
export const SCREENS: readonly ServiceScreen[] = [
  // S1, the queue list (issue 481, task 1): at the service's route and at its own, neither redirecting.
  {
    paths: [SQS_PATH, QUEUES_PATH],
    title: QUEUES_TITLE,
    crumbs: [{ text: QUEUES_TITLE }],
    navigation: NAVIGATION,
    Page: QueueListPage,
  },
  // S2, a queue's page (issue 481, tasks 2 to 5): its name one segment below `queue/`, decoded once by the area.
  {
    paths: [`${QUEUES_PATH}/queue/{name}`],
    title: ({ name }) => name ?? '',
    crumbs: ({ name }) => [{ text: QUEUES_TITLE, href: QUEUES_PATH }, { text: name ?? '' }],
    navigation: NAVIGATION,
    Page: QueuePage,
  },
];
