import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { useTokenListing } from '../../../../components/use-token-listing';
import { ValueText } from '../../../../components/value-text';
import { LABEL_OPERATIONS, listKeyTags, tagKey, untagKey, type KeyTag } from '../../labels-api';
import { LabelActionError } from './label-action-error';
import {
  ConfirmLabelRemoval,
  LabelDialog,
  LabelListEmpty,
  LabelPagination,
  LabelRowActions,
  UnavailableActions,
} from './label-controls';
import { useLabelAction } from './use-label-action';

type TagEdit = { kind: 'add' } | { kind: 'edit' | 'remove'; tag: KeyTag };

export function Tags({ connection, keyId }: { connection: AreaConnection; keyId: string }) {
  const [edit, setEdit] = useState<TagEdit>();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [generation, setGeneration] = useState(0);
  const listing = useTokenListing({
    key: ['kms', 'tags', keyId, generation],
    endpoint: connection.engineOrigin,
    operation: LABEL_OPERATIONS.listTags,
    read: (origin, marker, signal) => listKeyTags(origin, keyId, marker, signal),
  });
  const action = useLabelAction(connection, () => setGeneration((current) => current + 1));

  const handleOpen = (next: TagEdit) => {
    setName(next.kind === 'add' ? '' : next.tag.name);
    setValue(next.kind === 'add' ? '' : next.tag.value);
    action.clearFailure();
    setEdit(next);
  };
  const handleClose = () => setEdit(undefined);

  return (
    <SpaceBetween size="s">
      <UnavailableActions operations={action.unavailable} />
      <Table
        trackBy="name"
        items={listing.items ?? []}
        wrapLines
        loading={listing.loading}
        loadingText="Loading tags…"
        empty={<LabelListEmpty listing={listing} connection={connection} name="tags" onRetry={listing.refresh} />}
        header={
          <Header
            variant="h2"
            actions={
              <Button disabled={action.disabled(LABEL_OPERATIONS.tag)} onClick={() => handleOpen({ kind: 'add' })}>
                Add tag
              </Button>
            }
          >
            Tags
          </Header>
        }
        pagination={<LabelPagination listing={listing} label="Tag pages" />}
        columnDefinitions={[
          {
            id: 'name',
            header: 'Tag name',
            minWidth: '24ch',
            isRowHeader: true,
            cell: (tag) => <ValueText kind="name" value={tag.name} />,
          },
          {
            id: 'value',
            header: 'Value',
            cell: (tag) => <ValueText kind="text" value={tag.value} none="–" />,
          },
          {
            id: 'actions',
            header: 'Actions',
            minWidth: 180,
            cell: (tag) => (
              <LabelRowActions>
                <Button
                  ariaLabel={`Edit tag ${tag.name}`}
                  wrapText={false}
                  disabled={action.disabled(LABEL_OPERATIONS.tag)}
                  onClick={() => handleOpen({ kind: 'edit', tag })}
                >
                  Edit
                </Button>
                <Button
                  ariaLabel={`Remove tag ${tag.name}`}
                  wrapText={false}
                  disabled={action.disabled(LABEL_OPERATIONS.untag)}
                  onClick={() => handleOpen({ kind: 'remove', tag })}
                >
                  Remove
                </Button>
              </LabelRowActions>
            ),
          },
        ]}
      />
      {(edit?.kind === 'add' || edit?.kind === 'edit') && (
        <LabelDialog
          title={edit.kind === 'add' ? 'Add tag' : 'Edit tag'}
          submit={edit.kind === 'add' ? 'Add tag' : 'Save tag'}
          disabled={name === '' || action.disabled(LABEL_OPERATIONS.tag)}
          pending={action.pending}
          onDismiss={handleClose}
          onSubmit={() => {
            void action.run(
              LABEL_OPERATIONS.tag,
              (origin, signal) => tagKey(origin, keyId, { name, value }, signal),
              edit.kind === 'add' ? 'Tag added.' : 'Tag updated.',
              handleClose,
            );
          }}
        >
          <LabelActionError failure={action.failure} />
          <FormField label="Tag name">
            <Input
              value={name}
              readOnly={edit.kind === 'edit'}
              disabled={action.pending}
              onChange={({ detail }) => setName(detail.value)}
            />
          </FormField>
          <FormField label="Value" description="Optional">
            <Input value={value} disabled={action.pending} onChange={({ detail }) => setValue(detail.value)} />
          </FormField>
        </LabelDialog>
      )}
      {edit?.kind === 'remove' && (
        <ConfirmLabelRemoval
          title="Remove tag"
          body={
            <>
              Remove <ValueText kind="name" value={edit.tag.name} /> from this key.
            </>
          }
          word="remove"
          pending={action.pending}
          onDismiss={handleClose}
          onConfirm={() => {
            void action.run(
              LABEL_OPERATIONS.untag,
              (origin, signal) => untagKey(origin, keyId, edit.tag.name, signal),
              'Tag removed.',
              handleClose,
              false,
            );
          }}
        />
      )}
    </SpaceBetween>
  );
}
