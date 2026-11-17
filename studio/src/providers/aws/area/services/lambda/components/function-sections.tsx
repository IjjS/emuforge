import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { ValueText } from '../../../components/value-text';
import type { FunctionUrl, LambdaFunction } from '../api';
import type { FunctionStatus } from './function-status';
import { architecturesText, lastModifiedText, NONE, runtimeText } from '../format';

// The sections of a function's page (issue 84, requirement R5.3, R5.5): "Function overview" and, under the tab
// "Code", "Runtime settings", in the console's words (`studio/references/console/lambda/function-detail.yaml`).
// Every value is the emulator's, rendered as text, each as the kind of value it is (issue 467, requirement R6): it
// breaks the area's one way. The ARN and the URL carry a copy control (issue 467, R5).

/** The status line of a function's page (R5.2): Cloudscape's status indicator, then the reason as free text. */
export function FunctionStatusLine({ status }: { status: FunctionStatus }) {
  return (
    <>
      <StatusIndicator type={status.type}>
        <ValueText kind="fixed" value={status.text} />
      </StatusIndicator>
      {status.reason !== undefined && (
        <>
          {' '}
          <ValueText kind="text" value={status.reason} />
        </>
      )}
    </>
  );
}

/** The narrowest column of "Function overview", in pixels, as Cloudscape's `minColumnWidth` takes it. */
const OVERVIEW_MIN_COLUMN_WIDTH = 300;

const FUNCTION_ARN = 'Function ARN';
const FUNCTION_URL = 'Function URL';

/**
 * "Function URL" (R5.3): the URL as text with its copy control, never a link; "-" for none; the reading's failure as a
 * status, without a control.
 */
function urlValue(url: FunctionUrl): ReactNode {
  switch (url.kind) {
    case 'url':
      return <CopyValue label={FUNCTION_URL} value={url.url} kind="address" none={NONE} />;
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
        // One column where two would leave an address less than a line of its parts (issue 467, R6): at 390 wide.
        minColumnWidth={OVERVIEW_MIN_COLUMN_WIDTH}
        items={[
          { label: 'Description', value: <ValueText kind="text" value={fn.description} none={NONE} /> },
          { label: 'Last modified', value: <ValueText kind="fixed" value={lastModifiedText(fn.lastModified)} /> },
          {
            label: FUNCTION_ARN,
            value: <CopyValue label={FUNCTION_ARN} value={fn.arn} kind="address" none={NONE} />,
          },
          { label: FUNCTION_URL, value: urlValue(fn.url) },
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
          { label: 'Runtime', value: <ValueText kind="fixed" value={runtimeText(fn.runtime)} /> },
          { label: 'Handler', value: <ValueText kind="name" value={fn.handler} none={NONE} /> },
          { label: 'Architecture', value: <ValueText kind="fixed" value={architecturesText(fn.architectures)} /> },
        ]}
      />
    </Container>
  );
}
