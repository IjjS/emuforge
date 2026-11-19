import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { usePageFlash } from '../../../components/page-flash';
import { useCreateFolder } from '../queries';
import { actionFailure } from './action-failure';
import { Quoted } from './quoted';

// "Create folder" of the tab "Objects" (issue 480, task 3): asks a name, then puts the empty object `<prefix><name>/`
// unless the folder is there already (a key or a common prefix under it). The result goes to the area's flash; a
// folder that exists, a name against the rule and a failed call stay in the dialog.

/** The rule of the field, shown from the start. */
export const FOLDER_RULE = 'Can\'t contain "/".';
const NAME_MISSING = 'Enter a folder name.';

interface CreateFolderDialogProps {
  visible: boolean;
  /** The engine's address. */
  endpoint: string | undefined;
  bucket: string;
  /** The folder the tab shows, where the new one is made; `''` at the root. */
  prefix: string;
  /** The dialog closed: `created` when a folder was put. */
  onClose: (created: boolean) => void;
}

/** What is wrong with `name`, or `undefined`. */
function nameError(name: string): string | undefined {
  if (name === '') {
    return NAME_MISSING;
  }
  return name.includes('/') ? FOLDER_RULE : undefined;
}

export function CreateFolderDialog({ visible, endpoint, bucket, prefix, onClose }: CreateFolderDialogProps) {
  const flash = usePageFlash();
  const createFolder = useCreateFolder(endpoint, bucket);
  const [name, setName] = useState('');
  const [error, setError] = useState<ReactNode>();
  const [failed, setFailed] = useState<{ type: 'error' | 'info'; header: ReactNode; detail?: ReactNode }>();
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  // Each opening starts afresh.
  const [seenVisible, setSeenVisible] = useState(visible);
  if (visible !== seenVisible) {
    setSeenVisible(visible);
    if (visible) {
      setName('');
      setError(undefined);
      setFailed(undefined);
    }
  }

  const handleClose = () => {
    if (!running) {
      onClose(false);
    }
  };

  const handleCreate = () => {
    if (running || createFolder === undefined) {
      return;
    }
    const wrong = nameError(name);
    setFailed(undefined);
    if (wrong !== undefined) {
      setError(wrong);
      return;
    }
    setError(undefined);
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    createFolder(prefix, name, abort.signal).then(
      (outcome) => {
        setRunning(false);
        if (outcome === 'exists') {
          setError(<Quoted before="A folder " name={name} after=" already exists here." />);
          return;
        }
        flash.show([{ type: 'success', content: <Quoted before="Folder " name={name} after=" created." /> }]);
        onClose(true);
      },
      (reason: unknown) => {
        if (abort.signal.aborted) {
          return;
        }
        setRunning(false);
        if (reason instanceof RequestError) {
          const view = actionFailure(reason.failure, 'Creating the folder', endpoint);
          setFailed({
            type: view.type,
            header: view.header,
            ...(view.detail !== undefined && { detail: view.detail }),
          });
        }
      },
    );
  };

  return (
    <AreaModal
      visible={visible}
      header="Create folder"
      closeAriaLabel="Close"
      onDismiss={handleClose}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={running} onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={running} disabled={createFolder === undefined} onClick={handleCreate}>
              Create folder
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {failed !== undefined && (
          <Alert type={failed.type} header={failed.header}>
            {failed.detail}
          </Alert>
        )}
        <FormField label="Folder name" constraintText={FOLDER_RULE} errorText={error}>
          <Input
            value={name}
            disabled={running}
            autoFocus
            autoComplete={false}
            spellcheck={false}
            onChange={({ detail }) => {
              setName(detail.value);
            }}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter' && !detail.isComposing) {
                handleCreate();
              }
            }}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}
