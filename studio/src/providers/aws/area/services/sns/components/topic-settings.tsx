import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import Textarea from '@cloudscape-design/components/textarea';
import { useState, type ReactNode } from 'react';

import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import type { FlashItem } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import { OPERATIONS, type Topic, type TopicSetting, type TopicTag } from '../api';
import { NONE } from '../format';
import type { SnsRead } from '../queries';

export type TopicSettingsOperation =
  typeof OPERATIONS.setTopicAttributes | typeof OPERATIONS.tagResource | typeof OPERATIONS.untagResource;

type WriteResult = { saved: true } | { saved: false; error?: FlashItem };

export interface TopicSettingsProps {
  topic: Topic;
  connection: AreaConnection;
  tags: SnsRead<TopicTag[]>;
  unavailable: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  onSaveSetting: (setting: TopicSetting) => Promise<WriteResult>;
  onSaveTag: (tag: TopicTag) => Promise<WriteResult>;
  onRemoveTag: (key: string) => Promise<WriteResult>;
}

export function TopicOperationUnavailable({ operation }: { operation: string }) {
  return (
    <Alert type="info" header="Not implemented by the emulator">
      The emulator answered 501 Not Implemented for {operation}.
    </Alert>
  );
}

function WriteError({ error }: { error: FlashItem | undefined }) {
  return error === undefined ? null : (
    <Alert type="error" header={error.header}>
      {error.content}
    </Alert>
  );
}

function EditForm({
  children,
  error,
  pending,
  disabled = false,
  onSave,
  onCancel,
}: {
  children: ReactNode;
  error: FlashItem | undefined;
  pending: boolean;
  disabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && !disabled) {
          onSave();
        }
      }}
    >
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button formAction="none" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" formAction="submit" loading={pending} disabled={pending || disabled}>
              Save changes
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <WriteError error={error} />
          {children}
        </SpaceBetween>
      </Form>
    </form>
  );
}

function AttributeSetting({
  name,
  label,
  value,
  unavailable,
  pending,
  onSave,
}: {
  name: TopicSetting['name'];
  label: string;
  value: string | undefined;
  unavailable: boolean;
  pending: boolean;
  onSave: TopicSettingsProps['onSaveSetting'];
}) {
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<FlashItem>();
  const editing = draft !== undefined && !unavailable;
  const handleSave = async () => {
    if (draft === undefined) {
      return;
    }
    setError(undefined);
    const result = await onSave({ name, value: draft });
    if (result.saved) {
      setDraft(undefined);
    } else {
      setError(result.error);
    }
  };
  const edit = (
    <Button
      ariaLabel={`Edit ${label.toLowerCase()}`}
      disabled={unavailable || pending}
      onClick={() => {
        setError(undefined);
        setDraft(value ?? '');
      }}
    >
      Edit
    </Button>
  );

  return (
    <Container
      header={
        <Header variant="h2" actions={editing ? undefined : edit}>
          {label}
        </Header>
      }
    >
      <SpaceBetween size="m">
        {editing ? (
          <EditForm
            error={error}
            pending={pending}
            onSave={() => {
              void handleSave();
            }}
            onCancel={() => {
              setDraft(undefined);
            }}
          >
            <FormField label={label}>
              {name === 'Policy' ? (
                <Textarea
                  value={draft}
                  rows={10}
                  readOnly={pending}
                  spellcheck={false}
                  onChange={({ detail }) => {
                    setDraft(detail.value);
                  }}
                />
              ) : (
                <Input
                  value={draft}
                  readOnly={pending}
                  onChange={({ detail }) => {
                    setDraft(detail.value);
                  }}
                />
              )}
            </FormField>
          </EditForm>
        ) : name === 'Policy' ? (
          <Box variant="code" display="block">
            <span style={{ whiteSpace: 'pre-wrap' }}>
              <ValueText kind="text" value={value} none={NONE} />
            </span>
          </Box>
        ) : (
          <ValueText kind="text" value={value} none={NONE} />
        )}
      </SpaceBetween>
    </Container>
  );
}

function TopicTags({
  tags,
  connection,
  unavailable,
  pending,
  onSaveTag,
  onRemoveTag,
}: Omit<TopicSettingsProps, 'topic' | 'onSaveSetting'>) {
  const [draft, setDraft] = useState<TopicTag>();
  const [editingKey, setEditingKey] = useState(false);
  const [saveError, setSaveError] = useState<FlashItem>();
  const [removeKey, setRemoveKey] = useState<string>();
  const [removeError, setRemoveError] = useState<FlashItem>();
  const readUnavailable = unavailable.has(OPERATIONS.listTagsForResource) || tags.failure?.kind === 'not-implemented';
  const saveUnavailable = unavailable.has(OPERATIONS.tagResource);
  const removeUnavailable = unavailable.has(OPERATIONS.untagResource);
  const saving = pending.has(OPERATIONS.tagResource);
  const removing = pending.has(OPERATIONS.untagResource);
  const editable = tags.value !== undefined && !readUnavailable;
  const canSave = editable && !saveUnavailable && !saving;
  const canRemove = editable && !removeUnavailable && !removing;

  const handleEdit = (tag?: TopicTag) => {
    setEditingKey(tag === undefined);
    setSaveError(undefined);
    setDraft(tag ?? { key: '', value: '' });
  };
  const handleSave = async () => {
    if (draft === undefined) {
      return;
    }
    setSaveError(undefined);
    const result = await onSaveTag(draft);
    if (result.saved) {
      setDraft(undefined);
    } else {
      setSaveError(result.error);
    }
  };
  const handleRemove = async () => {
    if (removeKey === undefined) {
      return;
    }
    setRemoveError(undefined);
    const result = await onRemoveTag(removeKey);
    setRemoveKey(undefined);
    if (!result.saved) {
      setRemoveError(result.error);
    }
  };

  const tagEditor =
    draft !== undefined && editable && !saveUnavailable ? (
      <EditForm
        error={saveError}
        pending={saving}
        disabled={draft.key === ''}
        onSave={() => {
          void handleSave();
        }}
        onCancel={() => {
          setDraft(undefined);
        }}
      >
        <FormField label="Key">
          <Input
            value={draft.key}
            readOnly={!editingKey || saving}
            onChange={({ detail }) => {
              setDraft({ ...draft, key: detail.value });
            }}
          />
        </FormField>
        <FormField label="Value">
          <Input
            value={draft.value}
            readOnly={saving}
            onChange={({ detail }) => {
              setDraft({ ...draft, value: detail.value });
            }}
          />
        </FormField>
      </EditForm>
    ) : undefined;

  return (
    <SpaceBetween size="m">
      <Table
        ariaLabels={{ tableLabel: 'Tags' }}
        header={
          <Header
            variant="h2"
            actions={
              <Button
                disabled={!canSave || (draft !== undefined && !saveUnavailable)}
                onClick={() => {
                  handleEdit();
                }}
              >
                Add tag
              </Button>
            }
          >
            Tags
          </Header>
        }
        trackBy="key"
        items={editable ? (tags.value ?? []) : []}
        loading={!readUnavailable && tags.value === undefined && tags.loading}
        loadingText="Loading tags"
        empty={
          readUnavailable ? (
            <TopicOperationUnavailable operation={OPERATIONS.listTagsForResource} />
          ) : tags.failure?.kind === 'access-denied' ? (
            <Alert type="error" header="Access denied">
              {readFailureState(tags.failure, connection, 'tags').detail}
            </Alert>
          ) : tags.failure !== undefined ? (
            <ReadFailure state={readFailureState(tags.failure, connection, 'tags')} onRetry={tags.refresh} />
          ) : tags.value?.length === 0 ? (
            <Box textAlign="center">No tags</Box>
          ) : undefined
        }
        columnDefinitions={[
          {
            id: 'key',
            header: 'Key',
            minWidth: 220,
            isRowHeader: true,
            cell: (tag) => <ValueText kind="name" value={tag.key} />,
          },
          { id: 'value', header: 'Value', cell: (tag) => <ValueText kind="text" value={tag.value} none={NONE} /> },
          {
            id: 'actions',
            header: 'Actions',
            cell: (tag) => (
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  ariaLabel={`Edit tag ${tag.key}`}
                  disabled={!canSave || draft !== undefined}
                  onClick={() => {
                    handleEdit(tag);
                  }}
                >
                  Edit
                </Button>
                <Button
                  ariaLabel={`Remove tag ${tag.key}`}
                  disabled={!canRemove}
                  onClick={() => {
                    setRemoveError(undefined);
                    setRemoveKey(tag.key);
                  }}
                >
                  Remove
                </Button>
              </SpaceBetween>
            ),
          },
        ]}
      />
      {saveUnavailable && <TopicOperationUnavailable operation={OPERATIONS.tagResource} />}
      {removeUnavailable && <TopicOperationUnavailable operation={OPERATIONS.untagResource} />}
      <WriteError error={removeError} />
      {tagEditor !== undefined && (
        <Container header={<Header variant="h3">{editingKey ? 'Add tag' : 'Edit tag'}</Header>}>{tagEditor}</Container>
      )}
      <ConfirmDialog
        visible={removeKey !== undefined && editable && !removeUnavailable}
        header="Remove tag"
        body={
          <>
            Remove <ValueText kind="name" value={removeKey} /> from this topic?
          </>
        }
        word="remove"
        action="Remove"
        pending={removing}
        onConfirm={() => {
          void handleRemove();
        }}
        onDismiss={() => {
          setRemoveKey(undefined);
        }}
      />
    </SpaceBetween>
  );
}

export function TopicSettings({ topic, onSaveSetting, ...props }: TopicSettingsProps) {
  const unavailable = props.unavailable.has(OPERATIONS.setTopicAttributes);
  const pending = props.pending.has(OPERATIONS.setTopicAttributes);
  return (
    <SpaceBetween size="l">
      {unavailable && <TopicOperationUnavailable operation={OPERATIONS.setTopicAttributes} />}
      <AttributeSetting
        name="DisplayName"
        label="Display name"
        value={topic.displayName}
        unavailable={unavailable}
        pending={pending}
        onSave={onSaveSetting}
      />
      <AttributeSetting
        name="Policy"
        label="Access policy"
        value={topic.policy}
        unavailable={unavailable}
        pending={pending}
        onSave={onSaveSetting}
      />
      <TopicTags {...props} />
    </SpaceBetween>
  );
}
