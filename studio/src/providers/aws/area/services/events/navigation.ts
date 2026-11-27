import type { ScreenNavigation } from '../../screens';
import { EVENTS_PATH } from './format';

export function eventsNavigation(activeHref: string): ScreenNavigation {
  return {
    header: { text: 'EventBridge', href: EVENTS_PATH },
    activeHref,
  };
}
