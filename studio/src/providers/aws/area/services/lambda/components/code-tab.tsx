import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';

import type { AreaConnection } from '../../../components/emulator-line';
import { ValueText } from '../../../components/value-text';
import type { LambdaFunction } from '../api';
import { codeSizeText, NONE, valueText } from '../format';
import { RuntimeSettings } from './function-sections';

// The tab "Code" of a function's page (issue 516, design "Task 1", "Task 3"): the package as the emulator reports it,
// and "Runtime settings". The code itself is not shown: the API gives it only as a signed address, which Studio
// neither fetches nor shows. The upload and "Edit" of "Runtime settings" are added in their places by task 3 and 5.

export interface CodeTabProps {
  /** The function as the page's last read gave it. */
  fn: LambdaFunction;
  /** The function's name, as its page's address names it. */
  name: string;
  connection: AreaConnection;
  /** False while the function is being created or updated: an action that changes it is unavailable. */
  ready: boolean;
}

/** "Package": "Package type", "Code size", "SHA-256", each as the emulator reports it. */
function Package({ fn }: { fn: LambdaFunction }) {
  return (
    <Container header={<Header variant="h2">Package</Header>}>
      <KeyValuePairs
        columns={3}
        items={[
          { label: 'Package type', value: <ValueText kind="fixed" value={valueText(fn.packageType)} /> },
          { label: 'Code size', value: <ValueText kind="fixed" value={codeSizeText(fn.codeSize)} /> },
          { label: 'SHA-256', value: <ValueText kind="name" value={fn.codeSha256} none={NONE} /> },
        ]}
      />
    </Container>
  );
}

/** "Code": "Package", then "Runtime settings". */
export function CodeTab({ fn }: CodeTabProps) {
  return (
    <SpaceBetween size="l">
      <Package fn={fn} />
      <RuntimeSettings fn={fn} />
    </SpaceBetween>
  );
}
