import Header from '@cloudscape-design/components/header';

import type { AreaConnection } from '../../../components/emulator-line';
import type { PublishForm, PublishResult } from '../publish-form';

// S3's "Publish" tab (issue 536, design task 3). A stand-in: unit s4 builds it.

export interface PublishTabProps {
  topicArn: string;
  fifo: boolean;
  contentBasedDeduplication: boolean;
  connection: AreaConnection;
  /** The form's text, kept by the topic's page across its tabs. */
  form: PublishForm;
  onFormChange: (form: PublishForm) => void;
  /** The last publish's outcome; `undefined` before the first. */
  result: PublishResult | undefined;
  onResultChange: (result: PublishResult | undefined) => void;
}

export function PublishTab(props: PublishTabProps) {
  void props;
  return <Header variant="h2">Publish</Header>;
}
