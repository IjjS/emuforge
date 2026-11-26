import type { ServiceScreen } from '../../../screens';
import { LOG_STREAMS_PATH } from '../format';
import { logsNavigation } from '../navigation';
import { LogStreamsPage } from '../pages/log-streams-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [LOG_STREAMS_PATH],
    title: 'Log streams',
    crumbs: [{ text: 'Log streams' }],
    navigation: logsNavigation(LOG_STREAMS_PATH),
    Page: LogStreamsPage,
  },
];
