import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { ValueText } from '../../../components/value-text';
import type { LambdaFunction } from '../api';
import { NOT_READY } from '../configuration-form';
import { architecturesText, codeSizeText, NONE, runtimeText, valueText } from '../format';
import { EditRuntimeDialog } from './edit-runtime-dialog';
import { UploadCode } from './upload-code';

// The tab "Code" of a function's page (issue 516, design "Task 1", "Task 3", "Task 5"): the package as the emulator
// reports it with "Upload a .zip file", and "Runtime settings" with its "Edit". The code itself is not shown: the API
// gives it only as a signed address, which Studio neither fetches nor shows. Every value shown is the last read's,
// never a form's.

export interface CodeTabProps {
  /** The function as the page's last read gave it. */
  fn: LambdaFunction;
  /** The function's name, as its page's address names it. */
  name: string;
  connection: AreaConnection;
  /** False while the function is being created or updated: an action that changes it is unavailable. */
  ready: boolean;
}

/** "Package": "Package type", "Code size", "SHA-256", each as the emulator reports it, then the upload. */
function Package({ fn, name, connection, ready }: CodeTabProps) {
  return (
    <Container header={<Header variant="h2">Package</Header>}>
      <SpaceBetween size="l">
        <KeyValuePairs
          columns={3}
          items={[
            { label: 'Package type', value: <ValueText kind="fixed" value={valueText(fn.packageType)} /> },
            { label: 'Code size', value: <ValueText kind="fixed" value={codeSizeText(fn.codeSize)} /> },
            { label: 'SHA-256', value: <ValueText kind="name" value={fn.codeSha256} none={NONE} /> },
          ]}
        />
        <UploadCode name={name} engineOrigin={connection.engineOrigin} ready={ready} />
      </SpaceBetween>
    </Container>
  );
}

/** "Runtime settings": "Runtime", "Handler", "Architecture", and "Edit" for the runtime and the handler. */
function RuntimeSettings({ fn, name, connection, ready }: CodeTabProps) {
  const [editing, setEditing] = useState(false);
  const edit = useRef<ButtonProps.Ref>(null);
  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <Button
              ref={edit}
              ariaLabel="Edit runtime settings"
              disabled={!ready}
              disabledReason={NOT_READY}
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </Button>
          }
        >
          Runtime settings
        </Header>
      }
    >
      <KeyValuePairs
        columns={3}
        items={[
          { label: 'Runtime', value: <ValueText kind="fixed" value={runtimeText(fn.runtime)} /> },
          { label: 'Handler', value: <ValueText kind="name" value={fn.handler} none={NONE} /> },
          { label: 'Architecture', value: <ValueText kind="fixed" value={architecturesText(fn.architectures)} /> },
        ]}
      />
      {editing && (
        <EditRuntimeDialog
          fn={fn}
          name={name}
          engineOrigin={connection.engineOrigin}
          ready={ready}
          onClose={() => {
            setEditing(false);
            edit.current?.focus();
          }}
        />
      )}
    </Container>
  );
}

/** "Code": "Package", then "Runtime settings". */
export function CodeTab(props: CodeTabProps) {
  return (
    <SpaceBetween size="l">
      <Package {...props} />
      <RuntimeSettings {...props} />
    </SpaceBetween>
  );
}
