import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import Textarea from '@cloudscape-design/components/textarea';
import { Component, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

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

interface SectionFocusProps {
  unavailable: boolean;
  source: RefObject<HTMLElement | null>;
  heading: RefObject<HTMLElement | null>;
  dialog?: boolean;
  children: ReactNode;
}

// Snapshot the active control before React removes the editor or portaled confirmation.
class SectionFocus extends Component<SectionFocusProps> {
  getSnapshotBeforeUpdate(previous: SectionFocusProps) {
    const { dialog, source, unavailable } = this.props;
    if (previous.unavailable || !unavailable) {
      return false;
    }
    const anchor = source.current;
    const container = dialog ? anchor?.closest('[role="dialog"]') : anchor;
    return container?.contains(container.ownerDocument.activeElement) ?? false;
  }

  componentDidUpdate(_previous: SectionFocusProps, _state: unknown, hadFocus: boolean) {
    if (hadFocus) {
      this.props.heading.current?.focus();
    }
  }

  render() {
    return this.props.children;
  }
}

function EditForm({
  formRef,
  children,
  error,
  pending,
  disabled = false,
  onSave,
  onCancel,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  children: ReactNode;
  error: FlashItem | undefined;
  pending: boolean;
  disabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      ref={formRef}
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
            <Button variant="primary" formAction="submit" loading={pending} disabled={disabled}>
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
  const editButton = useRef<ButtonProps.Ref>(null);
  const heading = useRef<HTMLSpanElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const returnFocus = useRef(false);
  useLayoutEffect(() => {
    if (!editing && !pending && returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing, pending]);

  const closeEditor = () => {
    returnFocus.current = true;
    setDraft(undefined);
  };
  const handleSave = async () => {
    if (draft === undefined) {
      return;
    }
    setError(undefined);
    const result = await onSave({ name, value: draft });
    if (result.saved) {
      closeEditor();
    } else {
      setError(result.error);
    }
  };
  const edit = (
    <Button
      ref={editButton}
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
          <span ref={heading} tabIndex={-1}>
            {label}
          </span>
        </Header>
      }
    >
      <SectionFocus unavailable={unavailable} source={formRef} heading={heading}>
        {editing ? (
          <EditForm
            formRef={formRef}
            error={error}
            pending={pending}
            onSave={() => {
              void handleSave();
            }}
            onCancel={closeEditor}
          >
            <FormField
              label={label}
              constraintText={name === 'Policy' ? 'Enter the access policy as a JSON document.' : undefined}
            >
              {name === 'Policy' ? (
                <Textarea
                  value={draft}
                  rows={10}
                  resize="vertical"
                  autoFocus
                  readOnly={pending}
                  spellcheck={false}
                  onChange={({ detail }) => {
                    setDraft(detail.value);
                  }}
                />
              ) : (
                <Input
                  value={draft}
                  autoFocus
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
      </SectionFocus>
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
  const tagHeading = useRef<HTMLSpanElement>(null);
  const tagForm = useRef<HTMLFormElement>(null);
  const confirmBody = useRef<HTMLSpanElement>(null);
  const submittingRemoval = useRef(false);
  const addTagButton = useRef<ButtonProps.Ref>(null);
  const editTagButtons = useRef(new Map<string, ButtonProps.Ref>());
  const returnFocus = useRef<{ key: string | undefined } | undefined>(undefined);

  useLayoutEffect(() => {
    if (draft !== undefined || saving || returnFocus.current === undefined) {
      return;
    }
    const { key } = returnFocus.current;
    returnFocus.current = undefined;
    if (canSave) {
      const rowEdit = key === undefined ? undefined : editTagButtons.current.get(key);
      (rowEdit ?? addTagButton.current)?.focus();
    } else {
      tagHeading.current?.focus();
    }
  }, [canSave, draft, saving]);

  const closeEditor = () => {
    returnFocus.current = { key: editingKey ? undefined : draft?.key };
    setDraft(undefined);
  };
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
      closeEditor();
    } else {
      setSaveError(result.error);
    }
  };
  const handleRemove = async () => {
    if (removeKey === undefined || submittingRemoval.current) {
      return;
    }
    submittingRemoval.current = true;
    // The pending dialog disables Remove, which would blur a focused button.
    const body = confirmBody.current;
    const active = body?.ownerDocument.activeElement;
    if (active?.matches('button') && body?.closest('[role="dialog"]')?.contains(active)) {
      body.focus({ preventScroll: true });
    }
    setRemoveError(undefined);
    try {
      const result = await onRemoveTag(removeKey);
      setRemoveKey(undefined);
      if (!result.saved) {
        setRemoveError(result.error);
      }
    } finally {
      submittingRemoval.current = false;
    }
  };

  const tagEditor =
    draft !== undefined && editable && !saveUnavailable ? (
      <EditForm
        formRef={tagForm}
        error={saveError}
        pending={saving}
        disabled={draft.key === ''}
        onSave={() => {
          void handleSave();
        }}
        onCancel={closeEditor}
      >
        <FormField
          label="Key"
          constraintText={
            editingKey
              ? 'Saving an existing key replaces its value. Use Edit in the existing row to update it directly.'
              : undefined
          }
        >
          <Input
            value={draft.key}
            autoFocus={editingKey}
            readOnly={!editingKey || saving}
            onChange={({ detail }) => {
              setDraft({ ...draft, key: detail.value });
            }}
          />
        </FormField>
        <FormField label="Value">
          <Input
            value={draft.value}
            autoFocus={!editingKey}
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
                ref={addTagButton}
                disabled={!canSave || (draft !== undefined && !saveUnavailable)}
                onClick={() => {
                  handleEdit();
                }}
              >
                Add tag
              </Button>
            }
          >
            <span ref={tagHeading} tabIndex={-1}>
              Tags
            </span>
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
        wrapLines
        columnDefinitions={[
          {
            id: 'tag',
            header: 'Tag details',
            cell: (tag) => (
              <ColumnLayout columns={3} minColumnWidth={220} variant="text-grid">
                <div>
                  <Box variant="awsui-key-label">Key</Box>
                  <ValueText kind="name" value={tag.key} />
                </div>
                <div>
                  <Box variant="awsui-key-label">Value</Box>
                  <ValueText kind="text" value={tag.value} none={NONE} />
                </div>
                <SpaceBetween direction="horizontal" size="xs">
                  <Button
                    ref={(button) => {
                      if (button === null) {
                        editTagButtons.current.delete(tag.key);
                      } else {
                        editTagButtons.current.set(tag.key, button);
                      }
                    }}
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
              </ColumnLayout>
            ),
          },
        ]}
      />
      {saveUnavailable && <TopicOperationUnavailable operation={OPERATIONS.tagResource} />}
      {removeUnavailable && <TopicOperationUnavailable operation={OPERATIONS.untagResource} />}
      <WriteError error={removeError} />
      <SectionFocus unavailable={saveUnavailable} source={tagForm} heading={tagHeading}>
        {tagEditor !== undefined && (
          <Container header={<Header variant="h3">{editingKey ? 'Add tag' : 'Edit tag'}</Header>}>
            {tagEditor}
          </Container>
        )}
      </SectionFocus>
      <SectionFocus unavailable={removeUnavailable} source={confirmBody} heading={tagHeading} dialog>
        <ConfirmDialog
          visible={removeKey !== undefined && editable && !removeUnavailable}
          header="Remove tag"
          body={
            <span ref={confirmBody} tabIndex={-1}>
              Remove <ValueText kind="name" value={removeKey} /> from this topic?
            </span>
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
      </SectionFocus>
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
