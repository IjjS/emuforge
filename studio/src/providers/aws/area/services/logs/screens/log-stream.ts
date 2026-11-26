import type { ServiceScreen } from '../../../screens';
import { LOG_GROUPS_PATH, LOG_GROUPS_TITLE, LOG_STREAM_PATH, logGroupPath, nameFromSegment } from '../format';
import { logsNavigation } from '../navigation';
import { LogStreamPage } from '../pages/log-stream-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [LOG_STREAM_PATH],
    title: ({ stream }) => nameFromSegment(stream ?? ''),
    crumbs: ({ group, stream }) => {
      const name = nameFromSegment(group ?? '');
      return [
        { text: LOG_GROUPS_TITLE, href: LOG_GROUPS_PATH },
        { text: name, href: logGroupPath(name) },
        { text: nameFromSegment(stream ?? '') },
      ];
    },
    navigation: logsNavigation(LOG_GROUPS_PATH),
    Page: LogStreamPage,
  },
];
