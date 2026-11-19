import Box from '@cloudscape-design/components/box';
import AttributeEditor, { type AttributeEditorProps } from '@cloudscape-design/components/attribute-editor';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState } from 'react';

import '../../../styles/emulator-line.css';
import {
  COMPARISONS,
  takesNoValue,
  TYPE_LABELS,
  typeFor,
  typesOf,
  type Comparison,
  type Condition,
  type ConditionErrors,
  type ValueType,
} from '../filter';

// The filter of S2's "Items" (issue 512, design.md flow 2 to 4): a row per condition, each an attribute's name, a
// comparison and, for most comparisons, a type and a value. Rows are added and removed here and applied by the
// request's "Run"; nothing here reads or sends. The rows are Cloudscape's `AttributeEditor`, so their columns line up,
// "Remove" stays in its row on a wide screen and a narrow one draws a line between rows.

const FILTER_DESCRIPTION =
  'Keeps the items every condition matches. The emulator reads a page of items first and filters it after, so a page can show fewer items than it read.';

const FILTER_HELP =
  'A name is one top-level attribute, written exactly. A condition matches only values of its type: the Number 10 is not the String “10”. An index filters only the attributes it holds.';

const COMPARISON_OPTIONS: readonly SelectProps.Option[] = COMPARISONS.map(({ value, label }) => ({ value, label }));

const BOOLEAN_OPTIONS: readonly SelectProps.Option[] = [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
];

export interface ItemsFilterProps {
  conditions: readonly Condition[];
  /** The messages of the rows, by position. */
  errors: readonly (ConditionErrors | undefined)[] | undefined;
  /** "Run" applied a filter of at least one condition. */
  applied: boolean;
  onAdd: () => void;
  onChange: (position: number, change: Partial<Condition>) => void;
  onRemove: (position: number) => void;
}

/** What is to be focused after the next render: a row's "Attribute name", or "Add condition". */
type Focus = { kind: 'row'; position: number } | { kind: 'add' };

/** The columns line up on a wide screen with "Remove" at the row's end; a narrow one stacks them, a line between rows. */
const GRID: readonly AttributeEditorProps.GridLayout[] = [
  { breakpoint: 's', rows: [[3, 3, 2, 3, 3]], removeButton: { width: 'auto' } },
  {
    breakpoint: 'xxs',
    rows: [
      [1, 1],
      [1, 1, 1],
    ],
    removeButton: { ownRow: true },
  },
  { rows: [[1], [1], [1], [1], [1]], removeButton: { ownRow: true } },
];

/** A cell of a field the row's comparison or type does not use. */
function NotUsed() {
  return <Box color="text-status-inactive">Not used</Box>;
}

/** The filter's rows, "Add condition", and the announcement of a removed row. */
export function ItemsFilter({ conditions, errors, applied, onAdd, onChange, onRemove }: ItemsFilterProps) {
  const names = useRef(new Map<number, InputProps.Ref>());
  const editor = useRef<AttributeEditorProps.Ref>(null);
  // Set by an add or a remove, and taken by the render that follows it.
  const focus = useRef<Focus>(undefined);
  const [said, setSaid] = useState({ text: '', id: 0 });

  useEffect(() => {
    const target = focus.current;
    if (target === undefined) {
      return;
    }
    focus.current = undefined;
    if (target.kind === 'add') {
      editor.current?.focusAddButton();
    } else {
      names.current.get(target.position)?.focus();
    }
  });

  const handleAdd = () => {
    onAdd();
    focus.current = { kind: 'row', position: conditions.length };
  };

  const handleRemove = (position: number) => {
    onRemove(position);
    const left = conditions.length - 1;
    focus.current =
      position < left
        ? { kind: 'row', position }
        : position > 0
          ? { kind: 'row', position: position - 1 }
          : { kind: 'add' };
    setSaid((current) => ({ text: `Condition ${String(position + 1)} removed.`, id: current.id + 1 }));
  };

  const handleComparison = (position: number, condition: Condition, comparison: Comparison) => {
    const types = typesOf(comparison);
    onChange(position, {
      comparison,
      ...(types.length > 0 && !types.includes(condition.type) ? { type: 'S' as const } : {}),
    });
  };

  /** A text field of row `position`, named with the row's position. */
  const textField = (condition: Condition, position: number, field: 'value' | 'upper', label: string) => {
    const type = typeFor(condition.comparison, condition.type);
    return (
      <Input
        value={condition[field]}
        ariaLabel={`${label}, condition ${String(position + 1)}`}
        {...(type === 'B' ? { placeholder: 'Base64 text' } : {})}
        onChange={({ detail }) => {
          onChange(position, { [field]: detail.value });
        }}
      />
    );
  };

  // A select is named by its field's label and then its own name, so it adds only the row's position.
  const rowName = (position: number) => `condition ${String(position + 1)}`;

  const definition: AttributeEditorProps.FieldDefinition<Condition>[] = [
    {
      label: 'Attribute name',
      control: (condition, position) => (
        <Input
          ref={(ref) => {
            if (ref === null) {
              names.current.delete(position);
            } else {
              names.current.set(position, ref);
            }
          }}
          value={condition.name}
          ariaLabel={`Attribute name, condition ${String(position + 1)}`}
          onChange={({ detail }) => {
            onChange(position, { name: detail.value });
          }}
        />
      ),
      errorText: (_, position) => errors?.[position]?.name,
    },
    {
      label: 'Comparison',
      control: (condition, position) => (
        <Select
          selectedOption={COMPARISON_OPTIONS.find((option) => option.value === condition.comparison) ?? null}
          options={[...COMPARISON_OPTIONS]}
          ariaLabel={rowName(position)}
          onChange={({ detail }) => {
            handleComparison(position, condition, (detail.selectedOption.value ?? '=') as Comparison);
          }}
        />
      ),
    },
    {
      label: 'Type',
      control: (condition, position) => {
        if (takesNoValue(condition.comparison)) {
          return <NotUsed />;
        }
        const type = typeFor(condition.comparison, condition.type);
        const options = typesOf(condition.comparison).map((each) => ({ value: each, label: TYPE_LABELS[each] }));
        return (
          <Select
            selectedOption={options.find((option) => option.value === type) ?? null}
            options={options}
            ariaLabel={rowName(position)}
            onChange={({ detail }) => {
              onChange(position, { type: (detail.selectedOption.value ?? 'S') as ValueType });
            }}
          />
        );
      },
    },
    {
      label: 'Value',
      control: (condition, position) => {
        const type = typeFor(condition.comparison, condition.type);
        if (takesNoValue(condition.comparison) || type === 'NULL') {
          return <NotUsed />;
        }
        if (type === 'BOOL') {
          return (
            <Select
              selectedOption={BOOLEAN_OPTIONS[condition.bool ? 0 : 1] ?? null}
              options={[...BOOLEAN_OPTIONS]}
              ariaLabel={rowName(position)}
              onChange={({ detail }) => {
                onChange(position, { bool: detail.selectedOption.value === 'true' });
              }}
            />
          );
        }
        return textField(condition, position, 'value', 'Value');
      },
      errorText: (_, position) => errors?.[position]?.value,
    },
    {
      label: 'Upper bound',
      control: (condition, position) =>
        condition.comparison === 'between' ? textField(condition, position, 'upper', 'Upper bound') : <NotUsed />,
      errorText: (_, position) => errors?.[position]?.upper,
    },
  ];

  return (
    <SpaceBetween size="s">
      <Header variant="h3" description={FILTER_DESCRIPTION}>
        Filter
      </Header>
      <Box variant="small" color="text-body-secondary">
        {FILTER_HELP}
      </Box>
      <div role="group" aria-label="Filter">
        <AttributeEditor<Condition>
          ref={editor}
          items={conditions}
          definition={definition}
          gridLayout={GRID}
          addButtonText="Add condition"
          empty={applied ? 'No conditions. Run to show every item read.' : 'No conditions. Every item read is shown.'}
          onAddButtonClick={handleAdd}
          customRowActions={({ itemIndex, ref }) => (
            <Button
              ref={ref}
              formAction="none"
              ariaLabel={`Remove condition ${String(itemIndex + 1)}`}
              onClick={() => {
                handleRemove(itemIndex);
              }}
            >
              Remove
            </Button>
          )}
        />
      </div>
      <div className="aws-area-announcer" aria-live="polite" aria-atomic="true">
        {said.text !== '' && <span key={said.id}>{said.text}</span>}
      </div>
    </SpaceBetween>
  );
}
