import type { ServiceScreen } from '../../../screens';
import { EVENT_BUSES_PATH, EVENT_BUSES_TITLE, EVENTS_PATH } from '../format';
import { eventsNavigation } from '../navigation';
import { EventBusListPage } from '../pages/event-bus-list-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [EVENT_BUSES_PATH, EVENTS_PATH],
    title: EVENT_BUSES_TITLE,
    crumbs: [{ text: EVENT_BUSES_TITLE }],
    navigation: eventsNavigation(EVENT_BUSES_PATH),
    Page: EventBusListPage,
  },
];
