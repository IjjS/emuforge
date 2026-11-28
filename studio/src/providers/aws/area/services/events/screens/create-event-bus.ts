import type { ServiceScreen } from '../../../screens';
import { CREATE_EVENT_BUS_PATH, CREATE_EVENT_BUS_TITLE, EVENT_BUSES_PATH, EVENT_BUSES_TITLE } from '../format';
import { eventsNavigation } from '../navigation';
import { CreateEventBusPage } from '../pages/create-event-bus-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [CREATE_EVENT_BUS_PATH],
    title: CREATE_EVENT_BUS_TITLE,
    crumbs: [{ text: EVENT_BUSES_TITLE, href: EVENT_BUSES_PATH }, { text: CREATE_EVENT_BUS_TITLE }],
    navigation: eventsNavigation(EVENT_BUSES_PATH),
    Page: CreateEventBusPage,
  },
];
