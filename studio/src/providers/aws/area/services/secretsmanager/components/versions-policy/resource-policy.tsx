import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import { AreaModal } from '../../../../components/area-modal';
import type { AreaConnection } from '../../../../components/emulator-line';
import { useResourcePolicy } from '../../queries';
import {
  DELETE_RESOURCE_POLICY,
  deleteResourcePolicy,
  PUT_RESOURCE_POLICY,
  VALIDATE_RESOURCE_POLICY,
} from '../../versions-policy-api';
import { LifecycleFeedback } from '../lifecycle/lifecycle-feedback';
import type { LifecycleAction } from '../lifecycle/use-lifecycle-action';
import { PolicyEditor } from './policy-editor';
import { SectionReadFailure } from './section-read-failure';

export function ResourcePolicy({
  action,
  connection,
  endpoint,
  name,
  open,
  scheduled,
  onOpen,
  onSaved,
}: {
  action: LifecycleAction;
  connection: AreaConnection;
  endpoint: string;
  name: string;
  open: boolean;
  scheduled: boolean;
  onOpen: (open: boolean) => void;
  onSaved: (origin: string, message: string) => void;
}) {
  const policy = useResourcePolicy(endpoint, name, open);
  const [edit, setEdit] = useState<{ kind: 'edit'; document: string } | { kind: 'remove' }>();
  const pending = action.pending !== undefined;
  const ready = !policy.loading && policy.failure === undefined;

  const handleClose = () => {
    if (!pending) setEdit(undefined);
  };

  const handleRemove = () =>
    void action.run(
      DELETE_RESOURCE_POLICY,
      (endpoint, signal) => deleteResourcePolicy(endpoint, name, signal),
      (_, origin) => {
        setEdit(undefined);
        onSaved(origin, 'Resource policy removed.');
      },
    );

  return (
    <ExpandableSection
      variant="container"
      headerText="Resource policy"
      headingTagOverride="h2"
      expanded={open}
      onChange={({ detail }) => onOpen(detail.expanded)}
      headerActions={
        open &&
        !scheduled &&
        ready && (
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              disabled={action.disabled(PUT_RESOURCE_POLICY) || action.disabled(VALIDATE_RESOURCE_POLICY)}
              onClick={() => {
                action.clearFailure();
                setEdit({ kind: 'edit', document: policy.document ?? '' });
              }}
            >
              Edit resource policy
            </Button>
            {policy.document !== undefined && (
              <Button
                disabled={action.disabled(DELETE_RESOURCE_POLICY)}
                onClick={() => {
                  action.clearFailure();
                  setEdit({ kind: 'remove' });
                }}
              >
                Remove resource policy
              </Button>
            )}
          </SpaceBetween>
        )
      }
    >
      {open && (
        <>
          {policy.failure !== undefined ? (
            <SectionReadFailure
              failure={policy.failure}
              connection={connection}
              resource="resource policy"
              onRetry={policy.refresh}
            />
          ) : policy.loading ? (
            <StatusIndicator type="loading">Loading resource policy</StatusIndicator>
          ) : policy.document === undefined ? (
            <Box color="text-body-secondary">This secret has no resource policy.</Box>
          ) : (
            <Box variant="code" nativeAttributes={{ style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}>
              {policy.document}
            </Box>
          )}
          {edit?.kind === 'edit' && (
            <PolicyEditor
              action={action}
              connection={connection}
              name={name}
              initial={edit.document}
              onClose={handleClose}
              onSaved={(origin) => {
                setEdit(undefined);
                onSaved(origin, 'Resource policy saved.');
              }}
            />
          )}
          {edit?.kind === 'remove' && (
            <AreaModal
              visible
              header="Remove resource policy"
              closeAriaLabel="Close dialog"
              onDismiss={handleClose}
              footer={
                <Box float="right">
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button variant="link" onClick={handleClose} disabled={pending}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      loading={pending}
                      disabled={pending || action.disabled(DELETE_RESOURCE_POLICY)}
                      onClick={handleRemove}
                    >
                      Remove resource policy
                    </Button>
                  </SpaceBetween>
                </Box>
              }
            >
              <SpaceBetween size="m">
                <Box>Remove the resource policy from {name} in your local emulator?</Box>
                <LifecycleFeedback action={action} connection={connection} what="Removing the resource policy" />
              </SpaceBetween>
            </AreaModal>
          )}
        </>
      )}
    </ExpandableSection>
  );
}
