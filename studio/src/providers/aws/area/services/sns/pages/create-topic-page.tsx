import Header from '@cloudscape-design/components/header';

import type { ScreenPageProps } from '../../../screens';

// S2, "Create topic" (issue 536, design task 4). A stand-in: unit s4 builds it.

/** The page's title, its `h1` and its crumb. */
export const CREATE_TOPIC_TITLE = 'Create topic';

export function CreateTopicPage(props: ScreenPageProps) {
  void props;
  return <Header variant="h1">{CREATE_TOPIC_TITLE}</Header>;
}
