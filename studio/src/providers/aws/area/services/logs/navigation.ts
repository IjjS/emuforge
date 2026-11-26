import type { ScreenNavigation } from '../../screens';
import { LOGS_PATH } from './format';

export function logsNavigation(activeHref: string): ScreenNavigation {
  return {
    header: { text: 'CloudWatch Logs', href: LOGS_PATH },
    activeHref,
  };
}
