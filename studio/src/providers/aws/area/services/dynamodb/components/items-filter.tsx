import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
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
// request's "Run"; nothing here reads or sends.

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
  onAdd: () => void;
  onChange: (position: number, change: Partial<Condition>) => void;
  onRemove: (position: number) => void;
}

/** What is to be focused after the next render: a row's "Attribute name", or "Add condition". */
type Focus = { kind: 'row'; position: number } | { kind: 'add' };

/** The filter's rows, "Add condition", and the announcement of a removed row. */
export function ItemsFilter({ conditions, errors, onAdd, onChange, onRemove }: ItemsFilterProps) {
  const names = useRef(new Map<number, InputProps.Ref>());
  const add = useRef<ButtonProps.Ref>(null);
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
      add.current?.focus();
    } else {
      names.current.get(target.position)?.focus();
    }
  });

  const setFocus = (target: Focus) => {
    focus.current = target;
  };

  const handleAdd = () => {
    onAdd();
    setFocus({ kind: 'row', position: conditions.length });
  };

  const handleRemove = (position: number) => {
    onRemove(position);
    const left = conditions.length - 1;
    setFocus(
      position < left ? { kind: 'row', position } : position > 0 ? { kind: 'row', position: position - 1 } : { kind: 'add' },
    );
    setSaid((current) => ({ text: `Condition ${String(position + 1)} removed.`, id: current.id + 1 }));
  };

  const handleComparison = (position: number, condition: Condition, comparison: Comparison) => {
    const types = typesOf(comparison);
    onChange(position, {
      comparison,
      ...(types.length > 0 && !types.includes(condition.type) ? { type: 'S' as const } : {}),
    });
  };

  return (
    <SpaceBetween size="s">
      <Header variant="h3" description={FILTER_DESCRIPTION}>
        Filter
      </Header>
      <Box variant="small" color="text-body-secondary">
        {FILTER_HELP}
      </Box>
      <div role="group" aria-label="Filter">
        {conditions.length === 0 ? (
          <Box color="text-body-secondary">No conditions. Every item read is shown.</Box>
        ) : (
          <SpaceBetween size="s">
            {conditions.map((condition, position) => (
              <Row
                // Rows are only added at the end and removed whole; their fields are controlled.
                key={position}
                condition={condition}
                position={position}
                errors={errors?.[position]}
                nameRef={(ref) => {
                  if (ref === null) {
                    names.current.delete(position);
                  } else {
                    names.current.set(position, ref);
                  }
                }}
                onChange={(change) => {
                  onChange(position, change);
                }}
                onComparison={(comparison) => {
                  handleComparison(position, condition, comparison);
                }}
                onRemove={() => {
                  handleRemove(position);
                }}
              />
            ))}
          </SpaceBetween>
        )}
      </div>
      <Box>
        <Button ref={add} formAction="none" onClick={handleAdd}>
          Add condition
        </Button>
      </Box>
      <div className="aws-area-announcer" aria-live="polite" aria-atomic="true">
        {said.text !== '' && <span key={said.id}>{said.text}</span>}
      </div>
    </SpaceBetween>
  );
}

interface RowProps {
  condition: Condition;
  position: number;
  errors: ConditionErrors | undefined;
  nameRef: (ref: InputProps.Ref | null) => void;
  onChange: (change: Partial<Condition>) => void;
  onComparison: (comparison: Comparison) => void;
  onRemove: () => void;
}

/** One condition: its fields, each named with the row's position, and "Remove". */
function Row({ condition, position, errors, nameRef, onChange, onComparison, onRemove }: RowProps) {
  const n = String(position + 1);
  const named = (label: string) => `${label}, condition ${n}`;
  // A select is named by its field's label and then its own name, so it adds only the row's position.
  const rowName = `condition ${n}`;
  const noValue = takesNoValue(condition.comparison);
  const type = typeFor(condition.comparison, condition.type);
  const typeOptions = typesOf(condition.comparison).map((each) => ({ value: each, label: TYPE_LABELS[each] }));
  const comparison = COMPARISON_OPTIONS.find((option) => option.value === condition.comparison) ?? null;

  return (
    <SpaceBetween direction="horizontal" size="s" alignItems="start">
      <FormField label="Attribute name" errorText={errors?.name}>
        <Input
          ref={nameRef}
          value={condition.name}
          ariaLabel={named('Attribute name')}
          onChange={({ detail }) => {
            onChange({ name: detail.value });
          }}
        />
      </FormField>
      <FormField label="Comparison">
        <Select
          selectedOption={comparison}
          options={[...COMPARISON_OPTIONS]}
          ariaLabel={rowName}
          onChange={({ detail }) => {
            onComparison((detail.selectedOption.value ?? '=') as Comparison);
          }}
        />
      </FormField>
      {!noValue && (
        <FormField label="Type">
          <Select
            selectedOption={typeOptions.find((option) => option.value === type) ?? null}
            options={typeOptions}
            ariaLabel={rowName}
            onChange={({ detail }) => {
              onChange({ type: (detail.selectedOption.value ?? 'S') as ValueType });
            }}
          />
        </FormField>
      )}
      {!noValue && type === 'BOOL' && (
        <FormField label="Value">
          <Select
            selectedOption={BOOLEAN_OPTIONS[condition.bool ? 0 : 1] ?? null}
            options={[...BOOLEAN_OPTIONS]}
            ariaLabel={rowName}
            onChange={({ detail }) => {
              onChange({ bool: detail.selectedOption.value === 'true' });
            }}
          />
        </FormField>
      )}
      {!noValue && type !== 'BOOL' && type !== 'NULL' && (
        <FormField label="Value" errorText={errors?.value}>
          <Input
            value={condition.value}
            ariaLabel={named('Value')}
            {...(type === 'B' ? { placeholder: 'Base64 text' } : {})}
            onChange={({ detail }) => {
              onChange({ value: detail.value });
            }}
          />
        </FormField>
      )}
      {!noValue && type !== 'BOOL' && type !== 'NULL' && condition.comparison === 'between' && (
        <FormField label="Upper bound" errorText={errors?.upper}>
          <Input
            value={condition.upper}
            ariaLabel={named('Upper bound')}
            {...(type === 'B' ? { placeholder: 'Base64 text' } : {})}
            onChange={({ detail }) => {
              onChange({ upper: detail.value });
            }}
          />
        </FormField>
      )}
      <FormField label={<span aria-hidden="true">&nbsp;</span>}>
        <Button formAction="none" ariaLabel={`Remove condition ${n}`} onClick={onRemove}>
          Remove
        </Button>
      </FormField>
    </SpaceBetween>
  );
}
