import type { ScreenNavigation } from '../../screens';
import { ALARMS_PATH, CLOUDWATCH_PATH } from './paths';

export function cloudWatchNavigation(activeHref = ALARMS_PATH): ScreenNavigation {
  return {
    header: { text: 'CloudWatch', href: CLOUDWATCH_PATH },
    activeHref,
  };
}
