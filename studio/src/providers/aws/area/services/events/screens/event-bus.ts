import type { ServiceScreen } from '../../../screens';
import { busFromParams, EVENT_BUS_PATH, EVENT_BUSES_PATH, EVENT_BUSES_TITLE } from '../format';
import { eventsNavigation } from '../navigation';
import { EventBusPage } from '../pages/event-bus-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [EVENT_BUS_PATH],
    title: busFromParams,
    crumbs: (params) => [{ text: EVENT_BUSES_TITLE, href: EVENT_BUSES_PATH }, { text: busFromParams(params) }],
    navigation: eventsNavigation(EVENT_BUSES_PATH),
    Page: EventBusPage,
  },
];
