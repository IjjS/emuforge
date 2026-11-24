import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { FlashItem } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import type { Tag } from '../../../lib/ec2-client';
import { NONE } from '../format';
import { CREATE_TAGS, DELETE_TAGS, type InstanceContentChange } from '../instance-content-api';
import { useInstanceContentEditor, type InstanceContentWrites } from '../instance-content-queries';

type TagAction = { kind: 'add' } | { kind: 'edit'; tag: Tag } | { kind: 'delete'; tag: Tag };

const LABELS = { add: 'Add tag', edit: 'Edit tag', delete: 'Delete tag' };
const RESULTS = { add: 'Tag added.', edit: 'Tag updated.', delete: 'Tag deleted.' };

function TagFields({
  tag,
  tags,
  refusal,
  pending,
  onCancel,
  onSave,
}: {
  tag: Tag | undefined;
  tags: readonly Tag[];
  refusal: FlashItem | undefined;
  pending: boolean;
  onCancel: () => void;
  onSave: (tag: Tag) => void;
}) {
  const [key, setKey] = useState(tag?.key ?? '');
  const [value, setValue] = useState(tag?.value ?? '');
  const duplicate = tag === undefined && tags.some((existing) => existing.key === key);
  const canSave = key !== '' && !duplicate && (tag === undefined || value !== tag.value);
  return (
    <AreaModal
      visible
      header={tag === undefined ? LABELS.add : LABELS.edit}
      closeAriaLabel="Close"
      onDismiss={onCancel}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canSave} loading={pending} onClick={() => onSave({ key, value })}>
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
        <FormField
          label="Key"
          errorText={duplicate ? 'This key already exists. Use Edit tag in its row to change the value.' : undefined}
        >
          {tag === undefined ? (
            <Input value={key} disabled={pending} onChange={({ detail }) => setKey(detail.value)} />
          ) : (
            <ValueText kind="name" value={tag.key} />
          )}
        </FormField>
        <FormField label="Value" description="Leave blank to save an empty value.">
          <Input value={value} disabled={pending} onChange={({ detail }) => setValue(detail.value)} />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}

export function InstanceTagEditor({
  tags,
  endpoint,
  writes,
}: {
  tags: Tag[];
  endpoint: string | undefined;
  writes: InstanceContentWrites;
}) {
  const [action, setAction] = useState<TagAction>();
  const { pending, refusal, submit, canDismiss, clearRefusal } = useInstanceContentEditor(writes, 'tags');

  const reason = (operation: string) =>
    writes.unsupported[operation] !== undefined ? `Not implemented by the emulator (${operation}).` : undefined;
  const createReason = reason(CREATE_TAGS);
  const deleteReason = reason(DELETE_TAGS);
  const handleCancel = () => {
    if (canDismiss()) {
      clearRefusal();
      setAction(undefined);
    }
  };
  const handleSave = (change: InstanceContentChange) => {
    if (action === undefined) return;
    submit(change, {
      label: LABELS[action.kind],
      result: RESULTS[action.kind],
      onSettled: () => setAction(undefined),
    });
  };

  const columns: TableProps.ColumnDefinition<Tag>[] = [
    {
      id: 'key',
      header: 'Key',
      isRowHeader: true,
      minWidth: 210,
      cell: (tag) => (
        <SpaceBetween size="xxs">
          <ValueText kind="name" value={tag.key} />
          <SpaceBetween size="xs" direction="horizontal">
            <Button
              variant="inline-link"
              ariaLabel={`${LABELS.edit} ${tag.key}`}
              disabled={pending || endpoint === undefined || createReason !== undefined}
              disabledReason={createReason}
              onClick={() => setAction({ kind: 'edit', tag })}
            >
              {LABELS.edit}
            </Button>
            <Button
              variant="inline-link"
              ariaLabel={`${LABELS.delete} ${tag.key}`}
              disabled={pending || endpoint === undefined || deleteReason !== undefined}
              disabledReason={deleteReason}
              onClick={() => setAction({ kind: 'delete', tag })}
            >
              {LABELS.delete}
            </Button>
          </SpaceBetween>
        </SpaceBetween>
      ),
    },
    { id: 'value', header: 'Value', cell: (tag) => <ValueText kind="text" value={tag.value} none={NONE} /> },
  ];

  return (
    <>
      <Table<Tag>
        variant="container"
        header={
          <Header
            variant="h2"
            actions={
              <Button
                disabled={pending || endpoint === undefined || createReason !== undefined}
                disabledReason={createReason}
                onClick={() => setAction({ kind: 'add' })}
              >
                {LABELS.add}
              </Button>
            }
          >
            Tags
          </Header>
        }
        items={tags}
        trackBy="key"
        columnDefinitions={columns}
        wrapLines
        empty={
          <Box textAlign="center" color="inherit" variant="strong">
            No tags
          </Box>
        }
      />
      {action?.kind === 'delete' && (
        <ConfirmDialog
          visible
          header={LABELS.delete}
          body={
            <>
              Delete the tag <ValueText kind="name" value={action.tag.key} /> from this instance?
              {refusal !== undefined && (
                <Box
                  tagOverride="span"
                  display="block"
                  margin={{ top: 's' }}
                  color="text-status-error"
                  nativeAttributes={{ role: 'alert' }}
                >
                  <strong>{refusal.header}</strong> {refusal.content}
                </Box>
              )}
            </>
          }
          word="delete"
          action={LABELS.delete}
          pending={pending}
          onConfirm={() => handleSave({ kind: 'delete-tag', key: action.tag.key })}
          onDismiss={handleCancel}
        />
      )}
      {action !== undefined && action.kind !== 'delete' && (
        <TagFields
          tag={action.kind === 'edit' ? action.tag : undefined}
          tags={tags}
          refusal={refusal}
          pending={pending}
          onCancel={handleCancel}
          onSave={(tag) => handleSave({ kind: 'put-tag', tag })}
        />
      )}
    </>
  );
}
