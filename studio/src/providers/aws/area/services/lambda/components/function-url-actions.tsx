import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState } from 'react';

import { reportedServiceCode } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem, Code } from '../../../components/failure-states';
import { usePageFlash, type FlashResult } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import type { FunctionUrl } from '../api';
import { NOT_READY } from '../configuration-form';
import type { FunctionChange } from '../queries';

const CREATE = 'Create function URL';
const DELETE = 'Delete function URL';

export interface FunctionUrlChanges {
  create: FunctionChange<void>;
  remove: FunctionChange<void>;
  onDeleteSettled: () => void;
}

interface FunctionUrlActionsProps {
  url: FunctionUrl;
  name: string;
  engineOrigin: string | undefined;
  ready: boolean;
  changes: FunctionUrlChanges;
}

export function FunctionUrlActions({ url, name, engineOrigin, ready, changes }: FunctionUrlActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const submitting = useRef(false);
  const flash = usePageFlash();
  const { create, remove } = changes;
  if (url.kind !== 'none' && url.kind !== 'url') {
    return null;
  }

  const exists = url.kind === 'url';
  const action = exists ? DELETE : CREATE;
  const change = exists ? remove : create;
  const unsupported = change.error?.kind === 'not-implemented';
  const pending = create.isPending || remove.isPending;
  const available = ready && !unsupported && !pending;

  const handleDismiss = () => {
    if (!submitting.current) {
      setConfirming(false);
    }
  };

  const handleChange = () => {
    if (!available || submitting.current) {
      return;
    }
    submitting.current = true;

    const showResult = (result: FlashResult) => {
      submitting.current = false;
      setConfirming(false);
      flash.show(result);
      if (exists) {
        changes.onDeleteSettled();
      }
    };
    change.mutate(undefined, {
      onSuccess: () => {
        showResult([{ type: 'success', content: exists ? 'Function URL deleted.' : 'Function URL created.' }]);
      },
      onError: (failure) => {
        const item = actionFailureItem(failure, action, engineOrigin);
        const code =
          failure.kind === 'other' || failure.kind === 'not-implemented' ? undefined : reportedServiceCode(failure);
        showResult([
          code === undefined
            ? item
            : {
                ...item,
                content: (
                  <>
                    <Code>{code}</Code>. {item.content}
                  </>
                ),
              },
        ]);
      },
    });
  };

  return (
    <>
      <Container
        disableContentPaddings
        header={
          <Header
            variant="h2"
            actions={
              <Button
                disabled={!available && !pending}
                disabledReason={unsupported ? 'Not implemented by the emulator' : ready ? undefined : NOT_READY}
                loading={pending}
                loadingText={remove.isPending ? 'Deleting function URL' : 'Creating function URL'}
                onClick={exists ? () => setConfirming(true) : handleChange}
              >
                {action}
              </Button>
            }
          >
            Function URL
          </Header>
        }
      />
      <AreaModal
        visible={confirming && (exists || remove.isPending)}
        header={DELETE}
        closeAriaLabel="Close modal"
        hideDismissButton={remove.isPending}
        onDismiss={handleDismiss}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" disabled={remove.isPending} onClick={handleDismiss}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!exists || (!available && !remove.isPending)}
                loading={remove.isPending}
                loadingText="Deleting function URL"
                onClick={handleChange}
              >
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Box variant="p">
          Delete the function URL for <ValueText kind="name" value={name} />? The function itself will remain.
        </Box>
      </AreaModal>
    </>
  );
}
