import type { ServiceScreen } from '../../../screens';
import { EVENT_BUSES_PATH, EVENT_BUSES_TITLE, SEND_EVENTS_PATH } from '../format';
import { eventsNavigation } from '../navigation';
import { SendEventsPage } from '../pages/send-events-page';

const title = 'Send events';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [SEND_EVENTS_PATH],
    title,
    crumbs: [{ text: EVENT_BUSES_TITLE, href: EVENT_BUSES_PATH }, { text: title }],
    navigation: eventsNavigation(EVENT_BUSES_PATH),
    Page: SendEventsPage,
  },
];
