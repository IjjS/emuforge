import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import { CreateLogStreamDialog } from './create-log-stream-dialog';
import { DeleteLogStreamDialog } from './delete-log-stream-dialog';
import { StreamSection } from './stream-section';

type Dialog = { kind: 'create' } | { kind: 'delete'; name: string };

export function GroupStreams({ connection, group }: { connection: AreaConnection; group: string }) {
  const flash = usePageFlash();
  const refresh = useRef<() => void>(null);
  const [selectedName, setSelectedName] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>();
  const [createUnavailable, setCreateUnavailable] = useState(false);
  const [deleteUnavailable, setDeleteUnavailable] = useState(false);
  const endpoint = connection.engineOrigin;

  const dismiss = () => setDialog(undefined);
  const finish = (name: string, verb: 'created' | 'deleted') => {
    flash.show([
      {
        type: 'success',
        content: (
          <>
            Log stream <ValueText kind="name" value={name} /> {verb}.
          </>
        ),
      },
    ]);
    dismiss();
    setSelectedName(undefined);
    refresh.current?.();
  };

  return (
    <>
      <StreamSection
        connection={connection}
        group={group}
        selection={{ name: selectedName, onChange: setSelectedName }}
        refreshRef={refresh}
        actions={(selected) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              disabled={endpoint === undefined || selected === undefined}
              disabledReason={endpoint === undefined ? 'Waiting for the engine address.' : 'Select a log stream.'}
              onClick={() => {
                if (selected !== undefined) setDialog({ kind: 'delete', name: selected });
              }}
            >
              Delete log stream
            </Button>
            <Button variant="primary" disabled={endpoint === undefined} onClick={() => setDialog({ kind: 'create' })}>
              Create log stream
            </Button>
          </SpaceBetween>
        )}
      />
      {endpoint !== undefined && dialog?.kind === 'create' && (
        <CreateLogStreamDialog
          endpoint={endpoint}
          group={group}
          unavailable={createUnavailable}
          onUnavailable={() => setCreateUnavailable(true)}
          onCreated={(name) => finish(name, 'created')}
          onDismiss={dismiss}
        />
      )}
      {endpoint !== undefined && dialog?.kind === 'delete' && (
        <DeleteLogStreamDialog
          endpoint={endpoint}
          group={group}
          name={dialog.name}
          unavailable={deleteUnavailable}
          onUnavailable={() => setDeleteUnavailable(true)}
          onDeleted={(name) => finish(name, 'deleted')}
          onDismiss={dismiss}
        />
      )}
    </>
  );
}
