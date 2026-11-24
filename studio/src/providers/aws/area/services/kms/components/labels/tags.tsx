import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useLayoutEffect, useRef, useState } from 'react';

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
  LabelReadAnnouncement,
  LabelRowActions,
  UnavailableActions,
} from './label-controls';
import { useLabelAction } from './use-label-action';

type TagEdit = { kind: 'add' } | { kind: 'edit' | 'remove'; tag: KeyTag };

const COMPACT_TABLE_WIDTH = 480;
const OVERFLOW_HINT = 'Scroll sideways to see more of the table.';

export function Tags({
  connection,
  keyId,
  writesEnabled,
}: {
  connection: AreaConnection;
  keyId: string;
  writesEnabled: boolean;
}) {
  const [edit, setEdit] = useState<TagEdit>();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [generation, setGeneration] = useState(0);
  const tableSection = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const listing = useTokenListing({
    key: ['kms', 'tags', keyId, generation],
    endpoint: connection.engineOrigin,
    operation: LABEL_OPERATIONS.listTags,
    read: (origin, marker, signal) => listKeyTags(origin, keyId, marker, signal),
  });
  const action = useLabelAction(connection, writesEnabled, () => setGeneration((current) => current + 1));
  const hasRows = (listing.items?.length ?? 0) > 0;
  const showOverflowHint = hasRows && overflows;

  useLayoutEffect(() => {
    const table = tableSection.current?.querySelector('table');
    const scrollPane = table?.parentElement;
    if (!table || !scrollPane) return;

    const measure = () => {
      const width = scrollPane.clientWidth;
      setCompact(width > 0 && width <= COMPACT_TABLE_WIDTH);
      setOverflows(scrollPane.scrollWidth > width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    observer.observe(scrollPane);
    return () => observer.disconnect();
  }, [compact, hasRows]);

  const handleOpen = (next: TagEdit) => {
    setName(next.kind === 'add' ? '' : next.tag.name);
    setValue(next.kind === 'add' ? '' : next.tag.value);
    action.clearFailure();
    setEdit(next);
  };
  const handleClose = () => setEdit(undefined);
  const valueColumn: TableProps.ColumnDefinition<KeyTag> = {
    id: 'value',
    header: 'Value',
    cell: (tag) => <ValueText kind="text" value={tag.value} none="–" />,
  };
  const actionsColumn: TableProps.ColumnDefinition<KeyTag> = {
    id: 'actions',
    header: 'Actions',
    minWidth: compact ? 112 : 216,
    cell: (tag) => (
      <LabelRowActions>
        <Button
          ariaLabel={`Edit tag ${tag.name}`}
          {...(compact ? { variant: 'icon', iconName: 'edit' } : { wrapText: false })}
          disabled={action.disabled(LABEL_OPERATIONS.tag)}
          onClick={() => handleOpen({ kind: 'edit', tag })}
        >
          {compact ? undefined : 'Edit'}
        </Button>
        <Button
          ariaLabel={`Remove tag ${tag.name}`}
          {...(compact ? { variant: 'icon', iconName: 'remove' } : { wrapText: false })}
          disabled={action.disabled(LABEL_OPERATIONS.untag)}
          onClick={() => handleOpen({ kind: 'remove', tag })}
        >
          {compact ? undefined : 'Remove'}
        </Button>
      </LabelRowActions>
    ),
  };

  return (
    <SpaceBetween size="s">
      <UnavailableActions operations={action.unavailable} />
      <div ref={tableSection}>
        <LabelReadAnnouncement failure={listing.failure} connection={connection} name="tags" />
        <Table
          trackBy="name"
          ariaLabels={{ tableLabel: showOverflowHint ? `Tags. ${OVERFLOW_HINT}` : 'Tags' }}
          items={listing.items ?? []}
          wrapLines
          loading={listing.loading}
          loadingText="Loading tags…"
          empty={<LabelListEmpty listing={listing} connection={connection} name="tags" onRetry={listing.refresh} />}
          header={
            <Header
              variant="h2"
              description={showOverflowHint ? OVERFLOW_HINT : undefined}
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
              ...(compact ? { width: '24ch' } : {}),
              isRowHeader: true,
              cell: (tag) => <ValueText kind="name" value={tag.name} />,
            },
            ...(compact ? [actionsColumn, valueColumn] : [valueColumn, actionsColumn]),
          ]}
        />
      </div>
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
          disabled={action.disabled(LABEL_OPERATIONS.untag)}
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
