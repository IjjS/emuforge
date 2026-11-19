import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { NEW_CONDITION, type Condition } from '../filter';
import { ItemsFilter } from './items-filter';

// The filter's rows of S2's "Items" (issue 512, test-criteria.md "Unit s1 — .../dynamodb/components/items-filter.test.tsx"),
// rendered with the state the explorer keeps for them.

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function Host({ start = [], applied = false }: { start?: Condition[]; applied?: boolean }) {
  const [conditions, setConditions] = useState<readonly Condition[]>(start);
  return (
    <ItemsFilter
      conditions={conditions}
      errors={undefined}
      applied={applied}
      onAdd={() => {
        setConditions((current) => [...current, NEW_CONDITION]);
      }}
      onChange={(position, change) => {
        setConditions((current) => current.map((each, at) => (at === position ? { ...each, ...change } : each)));
      }}
      onRemove={(position) => {
        setConditions((current) => current.filter((_, at) => at !== position));
      }}
    />
  );
}

const PAGE = createWrapper(document.body);

function add() {
  fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
}

function input(label: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: label });
}

function typeInto(label: string, value: string) {
  fireEvent.change(input(label), { target: { value } });
}

/**
 * The select named `label` ("Comparison, condition 1"): its trigger is named by its field's label, the row's position
 * and the option shown ("Comparison condition 1 Equal to").
 */
function select(label: string) {
  const name = `${label.replace(', ', ' ')} `;
  const trigger = screen
    .queryAllByRole('button')
    .find((each) => each.getAttribute('aria-haspopup') === 'listbox' && named(each).startsWith(name));
  return PAGE.findAllSelects().find((each) => each.findTrigger().getElement() === trigger);
}

/** An element's name from its `aria-labelledby`. */
function named(element: Element): string {
  return (element.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => text(document.getElementById(id) ?? document.createElement('i')))
    .join(' ');
}

function selected(label: string): string | undefined {
  const found = select(label);
  return found === undefined ? undefined : text(found.findTrigger().getElement());
}

function choose(label: string, value: string) {
  const found = select(label);
  expect(found, `the select "${label}"`).toBeDefined();
  found?.openDropdown();
  found?.selectOptionByValue(value);
}

function optionsOf(label: string): string[] {
  const found = select(label);
  found?.openDropdown();
  const options = (found?.findDropdown().findOptions() ?? []).map((option) => text(option.getElement()));
  found?.closeDropdown();
  return options;
}

function announced(): string {
  return [...document.querySelectorAll('.aws-area-announcer')].map(text).join(' ');
}

describe('the filter', () => {
  it('no condition: "Filter", its description, its help and "No conditions. Every item read is shown."', () => {
    render(<Host />);

    expect(screen.getByRole('heading', { name: 'Filter' })).toBeInTheDocument();
    const shown = text(document.body);
    expect(shown).toContain(
      'Keeps the items every condition matches. The emulator reads a page of items first and filters it after, so a page can show fewer items than it read.',
    );
    expect(shown).toContain(
      'A name is one top-level attribute, written exactly. A condition matches only values of its type: the Number 10 is not the String “10”. An index filters only the attributes it holds.',
    );
    expect(shown).toContain('No conditions. Every item read is shown.');
    expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument();
  });

  it('no condition while a filter is applied: "No conditions. Run to show every item read."', () => {
    render(<Host applied />);

    expect(text(document.body)).toContain('No conditions. Run to show every item read.');
    expect(text(document.body)).not.toContain('Every item read is shown.');
  });

  it('"Exists" or "Does not exist": the type, value and upper bound cells say "Not used"; each row keeps its own "Remove"', () => {
    render(<Host />);
    add();
    add();
    choose('Comparison, condition 2', 'exists');

    const row = screen.getByRole('button', { name: 'Remove condition 2' }).closest('[role="group"]');
    expect(row).not.toBeNull();
    expect(text(row as Element)).toContain('Not used');
    expect(row?.contains(input('Attribute name, condition 2'))).toBe(true);
    expect(row?.contains(input('Attribute name, condition 1'))).toBe(false);
  });

  it('"Add condition": a row with its fields at start, named with the row\'s position, focus on its name', () => {
    render(<Host />);

    add();

    expect(input('Attribute name, condition 1').value).toBe('');
    expect(selected('Comparison, condition 1')).toBe('Equal to');
    expect(selected('Type, condition 1')).toBe('String');
    expect(input('Value, condition 1').value).toBe('');
    expect(screen.getByRole('button', { name: 'Remove condition 1' })).toBeInTheDocument();
    expect(document.activeElement).toBe(input('Attribute name, condition 1'));
    expect(text(document.body)).not.toContain('No conditions.');

    add();
    expect(document.activeElement).toBe(input('Attribute name, condition 2'));
  });

  it('"Exists" and "Does not exist": neither type nor value; back to "Equal to": the type and value the row had', () => {
    render(<Host />);
    add();
    choose('Type, condition 1', 'N');
    typeInto('Value, condition 1', '10');

    for (const comparison of ['exists', 'not_exists']) {
      choose('Comparison, condition 1', comparison);
      expect(select('Type, condition 1')).toBeUndefined();
      expect(screen.queryByRole('textbox', { name: 'Value, condition 1' })).toBeNull();
    }
    choose('Comparison, condition 1', '=');
    expect(selected('Type, condition 1')).toBe('Number');
    expect(input('Value, condition 1').value).toBe('10');

    add();
    choose('Comparison, condition 2', 'exists');
    choose('Comparison, condition 2', '<');
    expect(selected('Type, condition 2')).toBe('String');
    expect(input('Value, condition 2').value).toBe('');
  });

  it('"Boolean": a choice of "true" at start and "false"; "Null": no value; "Between": "Value" and "Upper bound"', () => {
    render(<Host />);
    add();

    choose('Type, condition 1', 'BOOL');
    expect(selected('Value, condition 1')).toBe('true');
    expect(optionsOf('Value, condition 1')).toEqual(['true', 'false']);
    choose('Value, condition 1', 'false');
    expect(selected('Value, condition 1')).toBe('false');

    choose('Type, condition 1', 'NULL');
    expect(select('Value, condition 1')).toBeUndefined();
    expect(screen.queryByRole('textbox', { name: 'Value, condition 1' })).toBeNull();

    choose('Comparison, condition 1', 'between');
    expect(input('Value, condition 1')).toBeInTheDocument();
    expect(input('Upper bound, condition 1')).toBeInTheDocument();
    const labels = PAGE.findAllFormFields().map((each) => text(each.findLabel()?.getElement() ?? document.body));
    expect(labels).toEqual(['Attribute name', 'Comparison', 'Type', 'Value', 'Upper bound']);

    choose('Comparison, condition 1', '=');
    const row = screen.getByRole('button', { name: 'Remove condition 1' }).closest('[role="group"]');
    // "Between" set the type to String; "Equal to" keeps it, with a value and no upper bound.
    expect(text(row as Element).match(/Not used/g)).toHaveLength(1);
    expect(selected('Type, condition 1')).toBe('String');
    expect(input('Value, condition 1')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Upper bound, condition 1' })).toBeNull();
  });

  it('a comparison whose types lack the row\'s type sets "String"; "Type" lists only its types; a value stays through String, Number and Binary', () => {
    render(<Host />);
    add();

    choose('Type, condition 1', 'BOOL');
    choose('Comparison, condition 1', '<');
    expect(selected('Type, condition 1')).toBe('String');
    expect(optionsOf('Type, condition 1')).toEqual(['String', 'Number', 'Binary']);
    choose('Comparison, condition 1', 'begins_with');
    expect(optionsOf('Type, condition 1')).toEqual(['String', 'Binary']);
    choose('Comparison, condition 1', '=');
    expect(optionsOf('Type, condition 1')).toEqual(['String', 'Number', 'Binary', 'Boolean', 'Null']);

    typeInto('Value, condition 1', 'AQI=');
    for (const type of ['N', 'B', 'S']) {
      choose('Type, condition 1', type);
      expect(input('Value, condition 1').value).toBe('AQI=');
    }
  });

  it('"Remove": that row gone, the others as they were, announced once, focus on the next, else the previous, else "Add condition"', () => {
    render(<Host />);
    add();
    add();
    add();
    typeInto('Attribute name, condition 1', 'a');
    typeInto('Attribute name, condition 2', 'b');
    typeInto('Attribute name, condition 3', 'c');
    choose('Comparison, condition 3', 'exists');

    fireEvent.click(screen.getByRole('button', { name: 'Remove condition 2' }));

    expect(input('Attribute name, condition 1').value).toBe('a');
    expect(input('Attribute name, condition 2').value).toBe('c');
    expect(selected('Comparison, condition 2')).toBe('Exists');
    expect(screen.queryByRole('textbox', { name: 'Attribute name, condition 3' })).toBeNull();
    expect(announced()).toBe('Condition 2 removed.');
    expect(document.activeElement).toBe(input('Attribute name, condition 2'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove condition 2' }));
    expect(announced()).toBe('Condition 2 removed.');
    expect(document.activeElement).toBe(input('Attribute name, condition 1'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove condition 1' }));
    expect(announced()).toBe('Condition 1 removed.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add condition' }));
    expect(text(document.body)).toContain('No conditions. Every item read is shown.');
  });
});
