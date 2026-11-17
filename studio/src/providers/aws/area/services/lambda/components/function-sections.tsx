import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ReactNode } from 'react';

import './function-sections.css';
import type { FunctionUrl, LambdaFunction } from '../api';
import type { FunctionStatus } from './function-status';
import { architecturesText, lastModifiedText, NONE, runtimeText, valueText } from '../format';

// The sections of a function's page (issue 84, requirement R5.3, R5.5): "Function overview" and, under the tab
// "Code", "Runtime settings", in the console's words (`studio/references/console/lambda/function-detail.yaml`).
// Every value is the emulator's, rendered as text; a value without a space (an ARN, a URL, a name of 64 characters)
// breaks inside its column rather than widening the page (R11).

/** A value as text that breaks anywhere when it must. */
function Value({ children }: { children: ReactNode }) {
  return <span className="aws-lambda-value">{children}</span>;
}

/** The status line of a function's page (R5.2): Cloudscape's status indicator, then the reason as text. */
export function FunctionStatusLine({ status }: { status: FunctionStatus }) {
  return (
    <Value>
      <StatusIndicator type={status.type}>{status.text}</StatusIndicator>
      {status.reason !== undefined && <> {status.reason}</>}
    </Value>
  );
}

/** "Function URL" (R5.3): the URL as text, never a link; "-" for none; the reading's failure as a status. */
function urlValue(url: FunctionUrl): ReactNode {
  switch (url.kind) {
    case 'url':
      return <Value>{url.url}</Value>;
    case 'none':
      return NONE;
    case 'not-implemented':
      return <StatusIndicator type="info">Not implemented by the emulator</StatusIndicator>;
    case 'not-read':
      return <StatusIndicator type="warning">Not read</StatusIndicator>;
  }
}

/** "Function overview": "Description", "Last modified", "Function ARN", "Function URL" (R5.3). */
export function FunctionOverview({ fn }: { fn: LambdaFunction }) {
  return (
    <Container header={<Header variant="h2">Function overview</Header>}>
      <KeyValuePairs
        columns={2}
        items={[
          { label: 'Description', value: <Value>{valueText(fn.description)}</Value> },
          { label: 'Last modified', value: lastModifiedText(fn.lastModified) },
          { label: 'Function ARN', value: <Value>{valueText(fn.arn)}</Value> },
          { label: 'Function URL', value: urlValue(fn.url) },
        ]}
      />
    </Container>
  );
}

/** "Runtime settings", read-only: "Runtime", "Handler", "Architecture" (R5.5). */
export function RuntimeSettings({ fn }: { fn: LambdaFunction }) {
  return (
    <Container header={<Header variant="h2">Runtime settings</Header>}>
      <KeyValuePairs
        columns={3}
        items={[
          { label: 'Runtime', value: <Value>{runtimeText(fn.runtime)}</Value> },
          { label: 'Handler', value: <Value>{valueText(fn.handler)}</Value> },
          { label: 'Architecture', value: architecturesText(fn.architectures) },
        ]}
      />
    </Container>
  );
}
