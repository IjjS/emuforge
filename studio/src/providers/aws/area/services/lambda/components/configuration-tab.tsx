import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { ValueText } from '../../../components/value-text';
import type { EnvironmentVariable, LambdaFunction } from '../api';
import { memoryText, NONE, timeoutText } from '../format';

// The tab "Configuration" of a function's page (issue 516, design "Task 1", "Task 5"): "General configuration" and
// "Environment variables", each value as the emulator reports it, rendered as text. "Edit" of each section is added in
// its place by task 5.

export interface ConfigurationTabProps {
  /** The function as the page's last read gave it. */
  fn: LambdaFunction;
  /** The function's name, as its page's address names it. */
  name: string;
  connection: AreaConnection;
  /** False while the function is being created or updated: an action that changes it is unavailable. */
  ready: boolean;
}

const EXECUTION_ROLE = 'Execution role';

/** "General configuration": "Description", "Memory", "Timeout", "Execution role" with its copy control. */
function GeneralConfiguration({ fn }: { fn: LambdaFunction }) {
  return (
    <Container header={<Header variant="h2">General configuration</Header>}>
      <KeyValuePairs
        columns={2}
        items={[
          { label: 'Description', value: <ValueText kind="text" value={fn.description} none={NONE} /> },
          { label: 'Memory', value: <ValueText kind="fixed" value={memoryText(fn.memorySize)} /> },
          { label: 'Timeout', value: <ValueText kind="fixed" value={timeoutText(fn.timeout)} /> },
          {
            label: EXECUTION_ROLE,
            value: <CopyValue label={EXECUTION_ROLE} value={fn.role} kind="address" none={NONE} />,
          },
        ]}
      />
    </Container>
  );
}

/** "Environment variables": each key and value as text, in the order the emulator reported them. */
function EnvironmentVariables({ fn, name }: { fn: LambdaFunction; name: string }) {
  return (
    <Table<EnvironmentVariable>
      header={<Header variant="h2">Environment variables</Header>}
      variant="container"
      items={fn.environment}
      trackBy="key"
      columnDefinitions={[
        { id: 'key', header: 'Key', cell: (variable) => <ValueText kind="name" value={variable.key} /> },
        {
          id: 'value',
          header: 'Value',
          cell: (variable) => <ValueText kind="text" value={variable.value} none={NONE} />,
        },
      ]}
      empty={
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              No environment variables
            </Box>
            <Box variant="p" color="inherit">
              <ValueText kind="name" value={name} /> has no environment variables.
            </Box>
          </SpaceBetween>
        </Box>
      }
    />
  );
}

/** "Configuration": "General configuration", then "Environment variables". */
export function ConfigurationTab({ fn, name }: ConfigurationTabProps) {
  return (
    <SpaceBetween size="l">
      <GeneralConfiguration fn={fn} />
      <EnvironmentVariables fn={fn} name={name} />
    </SpaceBetween>
  );
}
