import Header from '@cloudscape-design/components/header';

import type { AreaConnection } from '../../../components/emulator-line';

// S3's "Subscriptions" tab (issue 536, design task 1 steps 3 to 5). A stand-in: unit s2 builds it.

export interface SubscriptionsTabProps {
  topicArn: string;
  topicName: string;
  connection: AreaConnection;
  /** Reads the topic again, after a change of its subscriptions. */
  onTopicChanged: () => void;
}

export function SubscriptionsTab(props: SubscriptionsTabProps) {
  void props;
  return <Header variant="h2">Subscriptions</Header>;
}
