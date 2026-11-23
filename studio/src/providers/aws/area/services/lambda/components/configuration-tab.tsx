import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useRef, useState, type ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { ValueText } from '../../../components/value-text';
import type { EnvironmentVariable, LambdaFunction } from '../api';
import { NOT_READY } from '../configuration-form';
import { memoryText, NONE, timeoutText } from '../format';
import { EditGeneralDialog } from './edit-general-dialog';
import type { EditDialogProps } from './edit-runtime-dialog';
import { EditVariablesDialog } from './edit-variables-dialog';
import { FunctionUrlActions, type FunctionUrlChanges } from './function-url-actions';

// The tab "Configuration" of a function's page (issue 516, design "Task 1", "Task 5"): "General configuration" and
// "Environment variables", each value as the emulator reports it, rendered as text, each with its "Edit" (task 5).
// Every value shown is the last read's, never a form's.

export interface ConfigurationTabProps {
  /** The function as the page's last read gave it. */
  fn: LambdaFunction;
  /** The function's name, as its page's address names it. */
  name: string;
  connection: AreaConnection;
  /** False while the function is being created or updated: an action that changes it is unavailable. */
  ready: boolean;
  urlChanges: FunctionUrlChanges;
}

const EXECUTION_ROLE = 'Execution role';

interface SectionProps {
  fn: LambdaFunction;
  name: string;
  connection: AreaConnection;
  ready: boolean;
}

/**
 * A section's "Edit" and its dialog: unavailable while the function is not ready; the dialog is mounted while open,
 * and focus goes back to "Edit" when it closes.
 */
function useEdit(
  { fn, name, connection, ready }: SectionProps,
  section: string,
  Dialog: (props: EditDialogProps) => ReactNode,
): { button: ReactNode; dialog: ReactNode } {
  const [editing, setEditing] = useState(false);
  const edit = useRef<ButtonProps.Ref>(null);
  return {
    button: (
      <Button
        ref={edit}
        ariaLabel={`Edit ${section}`}
        disabled={!ready}
        disabledReason={NOT_READY}
        onClick={() => {
          setEditing(true);
        }}
      >
        Edit
      </Button>
    ),
    dialog: editing && (
      <Dialog
        fn={fn}
        name={name}
        engineOrigin={connection.engineOrigin}
        ready={ready}
        onClose={() => {
          setEditing(false);
          edit.current?.focus();
        }}
      />
    ),
  };
}

/** "General configuration": "Description", "Memory", "Timeout", "Execution role" with its copy control. */
function GeneralConfiguration(props: SectionProps) {
  const { fn } = props;
  const { button, dialog } = useEdit(props, 'general configuration', EditGeneralDialog);
  return (
    <Container
      header={
        <Header variant="h2" actions={button}>
          General configuration
        </Header>
      }
    >
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
      {dialog}
    </Container>
  );
}

/** "Environment variables": each key and value as text, in the order of the function read (by key). */
function EnvironmentVariables(props: SectionProps) {
  const { fn, name } = props;
  const { button, dialog } = useEdit(props, 'environment variables', EditVariablesDialog);
  return (
    <>
      <Table<EnvironmentVariable>
        header={
          <Header variant="h2" actions={button}>
            Environment variables
          </Header>
        }
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
      {dialog}
    </>
  );
}

/** "Configuration": "General configuration", "Environment variables", and "Function URL". */
export function ConfigurationTab(props: ConfigurationTabProps) {
  return (
    <SpaceBetween size="l">
      <GeneralConfiguration {...props} />
      <EnvironmentVariables {...props} />
      <FunctionUrlActions
        url={props.fn.url}
        name={props.name}
        engineOrigin={props.connection.engineOrigin}
        ready={props.ready}
        changes={props.urlChanges}
      />
    </SpaceBetween>
  );
}
