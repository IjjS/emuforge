import { useCallback, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import type { ItemsRequest, Keys, SortCondition, Table as TableDescription, TableKey } from '../api';
import { checkConditions, NEW_CONDITION, takesNoValue, typeFor, type Condition, type ConditionErrors } from '../filter';
import { base64ToBytes } from '../item-json';
import { useItemExploration, type ItemExploration } from '../queries';

// The state of S2's "Items" tab (issue 496, design.md task 2): the request's fields, the checks "Run" makes of them
// before anything is sent, the read it applied and the page of items that read gives. The page keeps it while it shows
// the table, so it stays across the tabs and a "Refresh" of the header.

/** The items per page at the start of every visit; stored nowhere. */
const START_PAGE_SIZE = 25;

/** The choices of "Items per page". */
export const PAGE_SIZES = [25, 50, 100] as const;

/** A table's key attribute types by the names the screen gives them. */
const TYPE_NAMES: Readonly<Record<string, string>> = { S: 'String', N: 'Number', B: 'Binary' };

/** A key's field label: "{name} ({type name})". */
export function keyLabel(key: TableKey): string {
  const type = key.type === undefined ? undefined : (TYPE_NAMES[key.type] ?? key.type);
  return type === undefined ? key.name : `${key.name} (${type})`;
}

/** The sort key conditions; "Any" is none. */
export type ConditionChoice = SortCondition | 'any';

/** One choice of "Sort key condition". */
export interface ConditionOption {
  value: ConditionChoice;
  label: string;
}

/** "Any": no sort key condition, at start. */
export const ANY: ConditionOption = { value: 'any', label: 'Any' };

const CONDITIONS: readonly ConditionOption[] = [
  ANY,
  { value: '=', label: 'Equal to' },
  { value: '<', label: 'Less than' },
  { value: '<=', label: 'Less than or equal to' },
  { value: '>', label: 'Greater than' },
  { value: '>=', label: 'Greater than or equal to' },
  { value: 'between', label: 'Between' },
  { value: 'begins_with', label: 'Begins with' },
];

/** "Begins with" is offered on a String or Binary sort key only: the emulator refuses it on a Number. */
export function conditionsFor(sort: TableKey): readonly ConditionOption[] {
  return sort.type === 'S' || sort.type === 'B'
    ? CONDITIONS
    : CONDITIONS.filter((condition) => condition.value !== 'begins_with');
}

/** What the request's fields hold. */
export interface Fields {
  kind: 'scan' | 'query';
  /** The index's name; `''` for the table itself. */
  target: string;
  partition: string;
  condition: ConditionChoice;
  sort: readonly [string, string];
  descending: boolean;
  /** The filter's rows, as written. */
  conditions: readonly Condition[];
}

const START_FIELDS: Fields = {
  kind: 'scan',
  target: '',
  partition: '',
  condition: 'any',
  sort: ['', ''],
  descending: false,
  conditions: [],
};

/** The messages under the query's value fields, each while its check fails. */
export interface FieldErrors {
  partition?: string;
  sort?: string;
  upper?: string;
  /** The messages of the filter's rows, by position. */
  conditions?: readonly (ConditionErrors | undefined)[];
}

/** What "Run" applied: the read, of the table (`index` absent) or an index, and its filter (absent for none). */
export interface Applied {
  index?: string;
  read: ItemsRequest['read'];
  filter?: readonly Condition[];
}

/** The keys of the table, or of its index `target` (the table's when it has no such index any more). */
export function keysOf(table: TableDescription, target: string): Keys {
  const index = target === '' ? undefined : table.indexes.find((each) => each.name === target);
  const partition = (index === undefined ? table.partitionKey : index.partitionKey) ?? { name: '' };
  const sort = index === undefined ? table.sortKey : index.sortKey;
  return sort === undefined ? { partition } : { partition, sort };
}

/** The message for a key value typed as text, or `undefined` when it may be sent. */
function valueError(key: TableKey, value: string): string | undefined {
  if (value === '') {
    return `Enter a value for ${key.name}.`;
  }
  if (key.type === 'B' && base64ToBytes(value) === undefined) {
    return 'Enter the value in base64.';
  }
  return undefined;
}

/** The read the fields ask for, or the messages of the checks that fail. */
function readOf(table: TableDescription, fields: Fields): { applied: Applied } | { errors: FieldErrors } {
  const read = keyReadOf(table, fields);
  const conditionErrors = checkConditions(fields.conditions);
  if (conditionErrors.length > 0) {
    return { errors: { ...('errors' in read ? read.errors : {}), conditions: conditionErrors } };
  }
  if ('errors' in read) {
    return read;
  }
  return fields.conditions.length === 0 ? read : { applied: { ...read.applied, filter: fields.conditions } };
}

/** The read the key fields ask for, its filter aside, or the messages of their checks that fail. */
function keyReadOf(table: TableDescription, fields: Fields): { applied: Applied } | { errors: FieldErrors } {
  const index = fields.target === '' ? {} : { index: fields.target };
  if (fields.kind === 'scan') {
    return { applied: { ...index, read: { kind: 'scan' } } };
  }
  const keys = keysOf(table, fields.target);
  const errors: FieldErrors = {};
  const partitionError = valueError(keys.partition, fields.partition);
  if (partitionError !== undefined) {
    errors.partition = partitionError;
  }
  const sortKey = keys.sort;
  const condition = sortKey === undefined ? 'any' : fields.condition;
  if (sortKey !== undefined && condition !== 'any') {
    const sortError = valueError(sortKey, fields.sort[0]);
    if (sortError !== undefined) {
      errors.sort = sortError;
    }
    if (condition === 'between') {
      const upperError = valueError(sortKey, fields.sort[1]);
      if (upperError !== undefined) {
        errors.upper = upperError;
      }
    }
  }
  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  const sort =
    sortKey === undefined || condition === 'any'
      ? {}
      : {
          sort: {
            key: sortKey,
            condition,
            values: condition === 'between' ? ([fields.sort[0], fields.sort[1]] as const) : ([fields.sort[0]] as const),
          },
        };
  return {
    applied: {
      ...index,
      read: {
        kind: 'query',
        partition: { key: keys.partition, value: fields.partition },
        ...sort,
        descending: fields.descending,
      },
    },
  };
}

/**
 * What of `fields` a "Run" would apply, as text: the read, the target, the query's fields it uses and each condition's
 * name, comparison and the type and values it uses. A field the request does not use changes nothing of it.
 */
function requestText(table: TableDescription, fields: Fields): string {
  const conditions = fields.conditions.map((condition) => {
    if (takesNoValue(condition.comparison)) {
      return [condition.name, condition.comparison];
    }
    const type = typeFor(condition.comparison, condition.type);
    const value = type === 'BOOL' ? condition.bool : type === 'NULL' ? null : condition.value;
    return [
      condition.name,
      condition.comparison,
      type,
      value,
      ...(condition.comparison === 'between' && type !== 'BOOL' && type !== 'NULL' ? [condition.upper] : []),
    ];
  });
  if (fields.kind === 'scan') {
    return JSON.stringify(['scan', fields.target, conditions]);
  }
  const sortKey = keysOf(table, fields.target).sort;
  const condition = sortKey === undefined ? 'any' : fields.condition;
  const sort = condition === 'any' ? [] : condition === 'between' ? [...fields.sort] : [fields.sort[0]];
  return JSON.stringify(['query', fields.target, fields.partition, condition, sort, fields.descending, conditions]);
}

/** The table is being created or deleted: its items are not read. */
function notReadable(status: string | undefined): string | undefined {
  if (status === 'CREATING') {
    return 'The table is being created. Its items can be read once it is active.';
  }
  if (status === 'DELETING') {
    return 'The table is being deleted.';
  }
  return undefined;
}

/** The "Items" tab's state, kept by the page while it shows the table, across its tabs. */
export interface ItemsExplorer {
  fields: Fields;
  errors: FieldErrors;
  applied: Applied;
  pageSize: number;
  /** The sentence shown in place of the tab while the table is being created or deleted. */
  unreadable: string | undefined;
  exploration: ItemExploration;
  /** A field of the request differs from what "Run" applied last. */
  changed: boolean;
  change: (fields: Partial<Fields>) => void;
  /** Adds a filter row at the end, as `NEW_CONDITION`. */
  addCondition: () => void;
  /** Changes the filter row at `position`. */
  changeCondition: (position: number, change: Partial<Condition>) => void;
  /** Removes the filter row at `position`, and its messages. */
  removeCondition: (position: number) => void;
  run: () => void;
  setPageSize: (size: number) => void;
}

/** The "Items" tab's state for `table`; its page of items is read once the table can be read. */
export function useItemsExplorer(table: TableDescription, connection: AreaConnection): ItemsExplorer {
  const [fields, setFields] = useState<Fields>(START_FIELDS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [applied, setApplied] = useState<Applied>({ read: { kind: 'scan' } });
  const [pageSize, setPageSize] = useState(START_PAGE_SIZE);
  const [runs, setRuns] = useState(0);
  const [appliedText, setAppliedText] = useState(() => requestText(table, START_FIELDS));
  const unreadable = notReadable(table.status);
  const request: ItemsRequest | undefined =
    unreadable === undefined ? { table: table.name, ...applied, pageSize } : undefined;
  const exploration = useItemExploration({
    endpoint: connection.engineOrigin,
    request,
    run: runs,
    connected: connection.result?.kind === 'connected',
  });

  const change = useCallback((next: Partial<Fields>) => {
    setFields((current) => ({ ...current, ...next }));
  }, []);

  const addCondition = useCallback(() => {
    setFields((current) => ({ ...current, conditions: [...current.conditions, NEW_CONDITION] }));
  }, []);

  const changeCondition = useCallback((position: number, next: Partial<Condition>) => {
    setFields((current) => ({
      ...current,
      conditions: current.conditions.map((each, at) => (at === position ? { ...each, ...next } : each)),
    }));
  }, []);

  const removeCondition = useCallback((position: number) => {
    setFields((current) => ({ ...current, conditions: current.conditions.filter((_, at) => at !== position) }));
    setErrors((current) =>
      current.conditions === undefined
        ? current
        : { ...current, conditions: current.conditions.filter((_, at) => at !== position) },
    );
  }, []);

  const run = () => {
    const read = readOf(table, fields);
    if ('errors' in read) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    setApplied(read.applied);
    setAppliedText(requestText(table, fields));
    setRuns((current) => current + 1);
  };

  return {
    fields,
    errors,
    applied,
    pageSize,
    unreadable,
    exploration,
    changed: requestText(table, fields) !== appliedText,
    change,
    addCondition,
    changeCondition,
    removeCondition,
    run,
    setPageSize,
  };
}
