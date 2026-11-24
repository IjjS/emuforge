import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea from '@cloudscape-design/components/textarea';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';

import { reportedNotImplementedMessage, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';
import { OPERATIONS, type Instance } from '../api';
import { useInstanceContentChange, useInstanceUserData } from '../instance-content-queries';

const LABEL = 'Edit user data';
const STOP_REASON = 'Stop the instance to edit user data.';

function asJson(text: string): string {
  return JSON.stringify(text).replace(/^"\uFEFF/u, '"\\uFEFF');
}

function validUnicode(text: string): boolean {
  // In Unicode mode this range matches only unpaired surrogates.
  return !/[\uD800-\uDFFF]/u.test(text);
}

function readJson(text: string): string | undefined {
  if (text === '') return '';
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'string' && validUnicode(value)) return value;
  } catch {
    return undefined;
  }
  return undefined;
}

function UserDataDialog({
  instance,
  connection,
  onClose,
  onUnsupported,
}: {
  instance: Instance;
  connection: AreaConnection;
  onClose: () => void;
  onUnsupported: (failure: RequestFailure) => void;
}) {
  const endpoint = connection.engineOrigin;
  const { value, failure, refresh } = useInstanceUserData(endpoint, instance.id);
  const { pending, refusal, save, canDismiss } = useInstanceContentChange(endpoint, instance.id);
  useEffect(() => {
    if (failure?.kind === 'not-implemented') onUnsupported(failure);
  }, [failure, onUnsupported]);

  const [draft, setDraft] = useState<{ value: string; json: boolean }>();
  let field: ReactNode;
  let text: string | undefined;
  if (failure !== undefined) {
    field = <ReadFailure state={readFailureState(failure, connection, 'user data')} onRetry={refresh} />;
  } else if (value === undefined) {
    field = <StatusIndicator type="loading">Loading user data</StatusIndicator>;
  } else if (value.kind === 'binary') {
    field = <StatusIndicator type="warning">The existing user data cannot be edited as UTF-8 text.</StatusIndicator>;
  } else {
    const json = draft?.json ?? (value.text.startsWith('\uFEFF') || value.text.includes('\r'));
    const input = draft?.value ?? (json ? asJson(value.text) : value.text);
    const decoded = json ? readJson(input) : input;
    const error =
      decoded === undefined
        ? 'Enter a valid JSON string with valid Unicode characters.'
        : validUnicode(decoded)
          ? undefined
          : 'Enter valid Unicode text.';
    text = error === undefined && decoded !== value.text ? decoded : undefined;
    field = (
      <SpaceBetween size="s">
        <FormField
          label="User data"
          description={
            json ? (
              <>
                Use a JSON string to preserve line endings and leading BOM. Enter {'\\r\\n'} for CRLF, {'\\r'} for CR,{' '}
                {'\\n'} for LF, and {'\\uFEFF'} for BOM. Clear the field to remove user data.
              </>
            ) : (
              'Clear the field to remove user data.'
            )
          }
          errorText={error}
        >
          <Textarea
            rows={8}
            value={input}
            disabled={pending}
            onChange={({ detail }) => setDraft({ value: detail.value, json })}
          />
        </FormField>
        {!json && (
          <Button
            variant="inline-link"
            disabled={pending}
            onClick={() => setDraft({ value: asJson(input), json: true })}
          >
            Edit as JSON string
          </Button>
        )}
      </SpaceBetween>
    );
  }

  const handleClose = () => {
    if (canDismiss()) onClose();
  };
  return (
    <AreaModal
      visible
      header={LABEL}
      closeAriaLabel="Close"
      onDismiss={handleClose}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={text === undefined || endpoint === undefined || instance.state !== 'stopped'}
              loading={pending}
              onClick={() => {
                if (text === undefined) return;
                void save(
                  { kind: 'user-data', text },
                  {
                    label: LABEL,
                    result: 'User data updated.',
                    onSettled: (failure) => {
                      if (failure?.kind === 'not-implemented') onUnsupported(failure);
                      else onClose();
                    },
                  },
                );
              }}
            >
              Save changes
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {refusal !== undefined && (
          <div role="alert">
            <Alert type="error" header={refusal.header} statusIconAriaLabel="Error">
              {refusal.content}
            </Alert>
          </div>
        )}
        {field}
      </SpaceBetween>
    </AreaModal>
  );
}

export function InstanceUserDataEditor({ instance, connection }: { instance: Instance; connection: AreaConnection }) {
  const [open, setOpen] = useState(false);
  const [unsupported, setUnsupported] = useState<RequestFailure>();
  const reasonId = useId();
  const handleUnsupported = useCallback((failure: RequestFailure) => {
    setUnsupported(failure);
    setOpen(false);
  }, []);
  const showStopReason = instance.state !== 'stopped' && unsupported === undefined;
  const unavailable =
    unsupported === undefined ? undefined : `Not implemented by the emulator (${unsupported.operation}).`;
  const readUnavailable =
    unsupported?.operation === OPERATIONS.describeInstanceAttribute
      ? readFailureState(unsupported, connection, 'user data')
      : undefined;
  const detail = unsupported === undefined ? undefined : reportedNotImplementedMessage(unsupported);
  return (
    <SpaceBetween size="xxs">
      <Button
        variant="inline-link"
        disabled={showStopReason || unavailable !== undefined || connection.engineOrigin === undefined}
        disabledReason={unavailable}
        {...(showStopReason ? { ariaDescribedby: reasonId } : {})}
        onClick={() => setOpen(true)}
      >
        {LABEL}
      </Button>
      {showStopReason && (
        <Box variant="small" nativeAttributes={{ id: reasonId }}>
          {STOP_REASON}
        </Box>
      )}
      {readUnavailable !== undefined && (
        <>
          <StatusIndicator type={readUnavailable.type}>{readUnavailable.first}</StatusIndicator>
          <Box variant="small">{readUnavailable.detail}</Box>
          {detail !== undefined && <ValueText kind="text" value={detail} />}
        </>
      )}
      {open && (
        <UserDataDialog
          instance={instance}
          connection={connection}
          onClose={() => setOpen(false)}
          onUnsupported={handleUnsupported}
        />
      )}
    </SpaceBetween>
  );
}
