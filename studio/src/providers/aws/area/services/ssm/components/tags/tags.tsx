import type { Tag } from '@aws-sdk/client-ssm';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useState } from 'react';

import { AreaModal } from '../../../../components/area-modal';
import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../../components/failure-states';
import { ValueText } from '../../../../components/value-text';
import { useParameterTags, useParameterTagWrite, useUnsupportedOperation } from '../../queries';
import { ADD_TAGS, addParameterTag, REMOVE_TAGS, removeParameterTag } from '../../resource-api';

interface TagsProps {
  connection: AreaConnection;
  name: string;
}

type TagAction = { mode: 'add' } | { mode: 'edit' | 'remove'; tag: Tag };

export function ParameterTags(props: TagsProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ExpandableSection
      variant="container"
      headerText="Tags"
      expanded={expanded}
      onChange={({ detail }) => setExpanded(detail.expanded)}
    >
      {expanded && <TagsTable {...props} />}
    </ExpandableSection>
  );
}

function TagsTable({ connection, name }: TagsProps) {
  const { items, loading, failure, retry } = useParameterTags(connection, name);
  const add = useUnsupportedOperation(connection, ADD_TAGS);
  const remove = useUnsupportedOperation(connection, REMOVE_TAGS);
  const [action, setAction] = useState<TagAction>();
  const failures = [failure?.kind === 'not-implemented' ? failure : undefined, add.failure, remove.failure];

  return (
    <SpaceBetween size="m">
      {failures.map((unsupported) =>
        unsupported ? (
          <Alert key={unsupported.operation} header="Not implemented by the emulator">
            The emulator answered 501 Not Implemented for {unsupported.operation}.
          </Alert>
        ) : null,
      )}
      <Table<Tag>
        ariaLabels={{ tableLabel: 'Parameter tags' }}
        trackBy="Key"
        items={items ?? []}
        loading={loading && items === undefined}
        loadingText="Loading tags…"
        header={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={retry} disabled={loading || failure?.kind === 'not-implemented'}>
              Refresh tags
            </Button>
            <Button onClick={() => setAction({ mode: 'add' })} disabled={add.failure !== undefined}>
              Add tag
            </Button>
          </SpaceBetween>
        }
        columnDefinitions={[
          { id: 'key', header: 'Key', isRowHeader: true, cell: ({ Key }) => <ValueText kind="name" value={Key} /> },
          { id: 'value', header: 'Value', cell: ({ Value }) => <ValueText kind="text" value={Value} none="—" /> },
          {
            id: 'actions',
            header: 'Actions',
            cell: (tag) => (
              <SpaceBetween size="xs" direction="horizontal">
                <Button
                  ariaLabel={`Edit tag ${tag.Key ?? ''}`}
                  disabled={add.failure !== undefined}
                  onClick={() => setAction({ mode: 'edit', tag })}
                >
                  Edit
                </Button>
                <Button
                  ariaLabel={`Remove tag ${tag.Key ?? ''}`}
                  disabled={remove.failure !== undefined}
                  onClick={() => setAction({ mode: 'remove', tag })}
                >
                  Remove
                </Button>
              </SpaceBetween>
            ),
          },
        ]}
        empty={
          failure ? (
            failure.kind !== 'not-implemented' && (
              <ReadFailure state={readFailureState(failure, connection, 'tag list')} onRetry={retry} />
            )
          ) : (
            <Box textAlign="center">No tags</Box>
          )
        }
      />
      {action && <TagDialog connection={connection} name={name} action={action} onClose={() => setAction(undefined)} />}
    </SpaceBetween>
  );
}

function TagDialog({ connection, name, action, onClose }: TagsProps & { action: TagAction; onClose: () => void }) {
  const removing = action.mode === 'remove';
  const title = removing ? 'Remove tag' : action.mode === 'edit' ? 'Edit tag' : 'Add tag';
  const submit = action.mode === 'edit' ? 'Save tag' : title;
  const [key, setKey] = useState(action.mode === 'add' ? '' : (action.tag.Key ?? ''));
  const [value, setValue] = useState(action.mode === 'add' ? '' : (action.tag.Value ?? ''));
  const write = useParameterTagWrite(connection, name, removing ? REMOVE_TAGS : ADD_TAGS);
  const feedback = write.failure && actionFailureItem(write.failure, title, connection.engineOrigin);
  const handleDismiss = () => {
    if (!write.pending) onClose();
  };

  return (
    <AreaModal
      visible
      header={title}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween size="xs" direction="horizontal">
            <Button variant="link" onClick={handleDismiss} disabled={write.pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={write.pending}
              disabled={write.disabled || key.trim() === ''}
              onClick={() =>
                void write.run(
                  (endpoint, signal) =>
                    removing
                      ? removeParameterTag(endpoint, name, key, signal)
                      : addParameterTag(endpoint, name, { Key: key, Value: value }, signal),
                  `Tag ${key} ${removing ? 'removed from' : 'saved for'} ${name}.`,
                  onClose,
                )
              }
            >
              {submit}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {removing ? (
          <Box>
            Remove <ValueText kind="name" value={key} /> from <ValueText kind="name" value={name} />?
          </Box>
        ) : (
          <>
            <FormField label="Key">
              <Input
                value={key}
                onChange={({ detail }) => setKey(detail.value)}
                disabled={write.pending || action.mode === 'edit'}
              />
            </FormField>
            <FormField label="Value">
              <Input value={value} onChange={({ detail }) => setValue(detail.value)} disabled={write.pending} />
            </FormField>
          </>
        )}
        {feedback && (
          <Alert type="error" header={feedback.header}>
            {feedback.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
