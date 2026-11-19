import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CollectionPreferences, {
  type CollectionPreferencesProps,
} from '@cloudscape-design/components/collection-preferences';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { useAreaModalRoot } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, type ReadFailureState } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';
import { keyOfItem, type Item, type Table as TableDescription } from '../api';
import { cellText } from '../format';
import { compareCodePoints } from '../item-json';
import { DeleteItemsDialog, keyText } from './delete-items';
import { useItemEditor } from './item-editor';
import { ItemsFilter } from './items-filter';
import {
  ANY,
  conditionsFor,
  keyLabel,
  keysOf,
  PAGE_SIZES,
  type ConditionChoice,
  type ItemsExplorer,
} from './items-explorer';

// S2's "Items" tab (issue 496, design.md task 2): one container, the request above and its result below. By default a
// scan of the table, first page, once the table is active; the developer chooses scan or query, the table or one of
// its indexes, and for a query the partition key's value and optionally one sort key condition and the order. "Run"
// starts a new exploration at page 1; the pages follow the emulator's own `LastEvaluatedKey`. Every value from the
// emulator is rendered as text.

/** A key column keeps room for a name of 24 characters (`aws-area.md`, entry 4), as the table list's name column. */
const NAME_MIN_WIDTH = '28ch';

/** Every other attribute's column keeps this floor, so the items scroll inside the table instead of narrowing. */
const VALUE_MIN_WIDTH = '16ch';

/** The result's columns: the table's partition key and sort key, then every other name on the page by code point. */
function columnNames(table: TableDescription, items: readonly Item[]): { keys: string[]; others: string[] } {
  const keys = [table.partitionKey?.name, table.sortKey?.name].filter(
    (name): name is string => name !== undefined && name !== '',
  );
  const others = new Set<string>();
  for (const item of items) {
    for (const name of Object.keys(item)) {
      if (!keys.includes(name)) {
        others.add(name);
      }
    }
  }
  return { keys, others: [...others].sort(compareCodePoints) };
}

/** A cell: the attribute's type name, then its value as text; an attribute the item lacks is an empty cell. */
function Cell({ item, name, kind }: { item: Item; name: string; kind: 'name' | 'text' }) {
  const value = item[name];
  if (value === undefined) {
    return null;
  }
  const shown = cellText(value);
  return (
    <span>
      <Box variant="span" fontSize="body-s" color="text-body-secondary">
        {shown.type}
      </Box>{' '}
      <ValueText kind={kind} value={shown.text} />
    </span>
  );
}

/** What the result's body shows, the rows aside. */
type BodyState =
  | { kind: 'rows' }
  | { kind: 'loading' }
  | { kind: 'failure'; failure: ReadFailureState }
  | { kind: 'none'; title: string; text?: ReactNode };

function bodyState(explorer: ItemsExplorer, target: string, connection: AreaConnection): BodyState {
  const { exploration, applied } = explorer;
  if (exploration.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(exploration.failure, connection, 'items') };
  }
  if (exploration.items === undefined) {
    return { kind: 'loading' };
  }
  if (exploration.items.length > 0) {
    return { kind: 'rows' };
  }
  const name = <ValueText kind="name" value={target} />;
  if (applied.filter !== undefined && applied.filter.length > 0) {
    return filteredNone(exploration, applied.read.kind, name);
  }
  if (exploration.currentPage > 1) {
    return { kind: 'none', title: 'No more items' };
  }
  return applied.read.kind === 'scan'
    ? {
        kind: 'none',
        title: 'No items',
        text: <>{name} holds no items. Create one here, or with any tool pointed at the emulator.</>,
      }
    : { kind: 'none', title: 'No matching items', text: <>No item of {name} matches this query.</> };
}

/** "None of the {read} items this page read matches the filter." (and its singular). */
function noneOfRead(read: number): string {
  return read === 1
    ? 'The 1 item this page read does not match the filter.'
    : `None of the ${String(read)} items this page read matches the filter.`;
}

/** A filtered page that matched none, by whether more remain, its position and the read's kind (design.md). */
function filteredNone(
  exploration: ItemsExplorer['exploration'],
  kind: 'scan' | 'query',
  name: ReactNode,
): BodyState {
  const read = exploration.read ?? 0;
  if (exploration.more) {
    return {
      kind: 'none',
      title: 'No matching items on this page',
      text: `${noneOfRead(read)} More items remain: go to the next page.`,
    };
  }
  if (exploration.currentPage === 1) {
    return {
      kind: 'none',
      title: 'No matching items',
      text:
        kind === 'scan' ? (
          <>No item of {name} matches the filter.</>
        ) : (
          <>No item of {name} matches this query and its filter.</>
        ),
    };
  }
  return read > 0
    ? { kind: 'none', title: 'No more matching items', text: noneOfRead(read) }
    : { kind: 'none', title: 'No more items' };
}

/** "{read} items read, {matched} match the filter." (and its singulars). */
function countLine(read: number, matched: number): string {
  const reads = read === 1 ? '1 item read' : `${String(read)} items read`;
  const matches = matched === 1 ? '1 matches' : `${String(matched)} match`;
  return `${reads}, ${matches} the filter.`;
}

function Body({ state, onRetry }: { state: BodyState; onRetry: () => void }) {
  switch (state.kind) {
    case 'rows':
    case 'loading':
      return null;
    case 'failure':
      return <ReadFailure state={state.failure} onRetry={onRetry} />;
    case 'none':
      return (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              {state.title}
            </Box>
            {state.text !== undefined && (
              <Box variant="p" color="inherit">
                {state.text}
              </Box>
            )}
          </SpaceBetween>
        </Box>
      );
  }
}

/** The select's options: the table, then each index by kind. */
function targetOptions(table: TableDescription): SelectProps.Option[] {
  return [
    { value: '', label: `${table.name} (table)` },
    ...table.indexes.map((index) => ({
      value: index.name,
      label: `${index.name} (${index.kind === 'global' ? 'global' : 'local'} index)`,
    })),
  ];
}

interface RequestProps {
  table: TableDescription;
  explorer: ItemsExplorer;
}

/** The request: scan or query, the table or an index, the query's key fields, and "Run". */
function Request({ table, explorer }: RequestProps) {
  const { fields, errors, change } = explorer;
  const run = (
    <Button formAction="submit" variant="primary">
      Run
    </Button>
  );
  // The segmented controls are named by their fields' labels, so a narrow screen's select names no label again.
  const readId = useId();
  const orderId = useId();
  const options = targetOptions(table);
  const keys = keysOf(table, fields.target);
  const sortKey = keys.sort;
  const conditions = sortKey === undefined ? [] : conditionsFor(sortKey);
  const condition = conditions.find((each) => each.value === fields.condition) ?? ANY;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    explorer.run();
  };

  const handleTarget = ({ detail }: { detail: SelectProps.ChangeDetail }) => {
    const target = detail.selectedOption.value ?? '';
    const next = keysOf(table, target).sort;
    const keep = next !== undefined && conditionsFor(next).some((each) => each.value === fields.condition);
    change({ target, ...(keep ? {} : { condition: 'any' }) });
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Read items">
      <SpaceBetween size="m">
        <SpaceBetween direction="horizontal" size="m" alignItems="end">
          <FormField label={<span id={readId}>Read</span>}>
            <SegmentedControl
              ariaLabelledby={readId}
              selectedId={fields.kind}
              options={[
                { id: 'scan', text: 'Scan' },
                { id: 'query', text: 'Query' },
              ]}
              onChange={({ detail }) => {
                change({ kind: detail.selectedId === 'query' ? 'query' : 'scan' });
              }}
            />
          </FormField>
          <FormField label="Table or index">
            <Select
              selectedOption={options.find((option) => option.value === fields.target) ?? options[0] ?? null}
              options={options}
              onChange={handleTarget}
            />
          </FormField>
        </SpaceBetween>
        {fields.kind === 'query' && (
          <SpaceBetween direction="horizontal" size="m" alignItems="start">
            <FormField label={keyLabel(keys.partition)} errorText={errors.partition}>
              <Input
                value={fields.partition}
                onChange={({ detail }) => {
                  change({ partition: detail.value });
                }}
              />
            </FormField>
            {sortKey !== undefined && (
              <FormField label="Sort key condition">
                <Select
                  selectedOption={condition}
                  options={conditions}
                  onChange={({ detail }) => {
                    change({ condition: (detail.selectedOption.value ?? 'any') as ConditionChoice });
                  }}
                />
              </FormField>
            )}
            {sortKey !== undefined && condition.value !== 'any' && (
              <FormField label={keyLabel(sortKey)} errorText={errors.sort}>
                <Input
                  value={fields.sort[0]}
                  onChange={({ detail }) => {
                    change({ sort: [detail.value, fields.sort[1]] });
                  }}
                />
              </FormField>
            )}
            {sortKey !== undefined && condition.value === 'between' && (
              <FormField label={`${keyLabel(sortKey)}, upper bound`} errorText={errors.upper}>
                <Input
                  value={fields.sort[1]}
                  onChange={({ detail }) => {
                    change({ sort: [fields.sort[0], detail.value] });
                  }}
                />
              </FormField>
            )}
            <FormField label={<span id={orderId}>Order</span>}>
              <SegmentedControl
                ariaLabelledby={orderId}
                selectedId={fields.descending ? 'descending' : 'ascending'}
                options={[
                  { id: 'ascending', text: 'Ascending' },
                  { id: 'descending', text: 'Descending' },
                ]}
                onChange={({ detail }) => {
                  change({ descending: detail.selectedId === 'descending' });
                }}
              />
            </FormField>
          </SpaceBetween>
        )}
        <ItemsFilter
          conditions={fields.conditions}
          errors={errors.conditions}
          onAdd={explorer.addCondition}
          onChange={explorer.changeCondition}
          onRemove={explorer.removeCondition}
        />
        <Box>{run}</Box>
      </SpaceBetween>
    </form>
  );
}

export interface ItemsTabProps {
  table: TableDescription;
  explorer: ItemsExplorer;
  connection: AreaConnection;
  /** The keys of the selected items, as `keyText` writes them; the page keeps them across its tabs. */
  selection: readonly string[];
  onSelectionChange: (selection: readonly string[]) => void;
}

/** "Items": the request, and the page of items it read. */
export function ItemsTab({ table, explorer, connection, selection, onSelectionChange }: ItemsTabProps) {
  const modalRoot = useAreaModalRoot();
  const { exploration, applied, unreadable } = explorer;
  const editor = useItemEditor(table, connection.engineOrigin);
  const [deleting, setDeleting] = useState<Item[]>();

  if (unreadable !== undefined) {
    return (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="in-progress">{unreadable}</StatusIndicator>
        </Box>
      </Container>
    );
  }

  const target = applied.index ?? table.name;
  const items = exploration.items ?? [];
  const state = bodyState(explorer, target, connection);
  const filtered = applied.filter?.length ?? 0;
  const count =
    filtered > 0 && state.kind === 'rows' && exploration.items !== undefined
      ? countLine(exploration.read ?? exploration.items.length, exploration.items.length)
      : undefined;
  const { keys, others } = columnNames(table, items);
  const tableKeys = keysOf(table, '');
  const trackBy = (item: Item) => keyText(item, tableKeys);
  // The selected items of the page shown, in the page's order: a selection is of the page it was made on.
  const selected = items.filter((item) => selection.includes(trackBy(item)));
  const columns: TableProps.ColumnDefinition<Item>[] = [
    ...keys.map((name, position) => ({
      id: `key-${String(position)}`,
      header: <ValueText kind="name" value={name} />,
      isRowHeader: position === 0,
      minWidth: NAME_MIN_WIDTH,
      cell: (item: Item) =>
        position === 0 ? (
          <Link
            onFollow={(event) => {
              event.preventDefault();
              editor.open(item);
            }}
          >
            <Cell item={item} name={name} kind="name" />
          </Link>
        ) : (
          <Cell item={item} name={name} kind="name" />
        ),
    })),
    ...others.map((name, position) => ({
      id: `attribute-${String(position)}`,
      header: <ValueText kind="name" value={name} />,
      minWidth: VALUE_MIN_WIDTH,
      cell: (item: Item) => <Cell item={item} name={name} kind="text" />,
    })),
  ];

  const handlePreferences = ({ detail }: { detail: CollectionPreferencesProps.Preferences }) => {
    explorer.setPageSize(detail.pageSize ?? explorer.pageSize);
  };

  return (
    <>
      <Table<Item>
        variant="container"
        items={items}
        selectionType="multi"
        stickyColumns={{ first: 1 }}
        trackBy={trackBy}
        selectedItems={selected}
        onSelectionChange={({ detail }) => {
          onSelectionChange(detail.selectedItems.map(trackBy));
        }}
        ariaLabels={{
          tableLabel: 'Items',
          allItemsSelectionLabel: () => 'Select every item of the page',
          itemSelectionLabel: (_, item) => `Select ${trackBy(item)}`,
          selectionGroupLabel: 'Item selection',
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Reading items"
        empty={<Body state={state} onRetry={exploration.refresh} />}
        header={
          <Header
            variant="h2"
            {...(count === undefined ? {} : { description: count })}
            counter={exploration.items === undefined ? undefined : `(${String(exploration.items.length)})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  disabled={selected.length === 0}
                  disabledReason="Select items first"
                  onClick={() => {
                    setDeleting(selected.map((item) => keyOfItem(item, tableKeys)));
                  }}
                >
                  Delete
                </Button>
                <Button onClick={editor.create}>Create item</Button>
              </SpaceBetween>
            }
          >
            {applied.read.kind === 'scan' ? 'Scan of ' : 'Query of '}
            <ValueText kind="name" value={target} />
            {filtered > 0 && `, filtered by ${String(filtered)} ${filtered === 1 ? 'condition' : 'conditions'}`}
          </Header>
        }
        filter={<Request table={table} explorer={explorer} />}
        pagination={
          <Pagination
            currentPageIndex={exploration.currentPage}
            pagesCount={exploration.pagesCount}
            openEnd={exploration.openEnd}
            disabled={exploration.loading}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={({ detail }) => {
              exploration.goToPage(detail.currentPageIndex);
            }}
          />
        }
        preferences={
          <CollectionPreferences
            {...modalRoot}
            title="Preferences"
            confirmLabel="Confirm"
            cancelLabel="Cancel"
            closeAriaLabel="Close modal"
            preferences={{ pageSize: explorer.pageSize }}
            pageSizePreference={{
              title: 'Items per page',
              options: PAGE_SIZES.map((size) => ({ value: size, label: `${String(size)} items` })),
            }}
            onConfirm={handlePreferences}
          />
        }
      />
      {editor.dialog}
      <DeleteItemsDialog
        table={table.name}
        keys={tableKeys}
        items={deleting}
        engineOrigin={connection.engineOrigin}
        onDeleted={() => {
          onSelectionChange([]);
        }}
        onClose={() => {
          setDeleting(undefined);
        }}
      />
    </>
  );
}
