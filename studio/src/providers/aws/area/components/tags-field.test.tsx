import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';

import { checkTagRows, type TagRow, type TagRowError } from '../lib/tag-rows';
import { TagsField, type TagsFieldRef } from './tags-field';

function TestForm({ onChange }: { onChange: (rows: TagRow[]) => void }) {
  const tags = useRef<TagsFieldRef>(null);
  const [rows, setRows] = useState<TagRow[]>([]);
  const [errors, setErrors] = useState<(TagRowError | undefined)[]>();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const check = checkTagRows(rows);
        setErrors(check.errors);
        if (check.firstInvalid !== undefined) tags.current?.focusKey(check.firstInvalid);
      }}
    >
      <TagsField
        ref={tags}
        rows={rows}
        errors={errors}
        onChange={(next) => {
          setRows(next);
          onChange(next);
        }}
      />
      <button type="submit">Create</button>
    </form>
  );
}

it('starts with the optional tags heading, Add tag and no rows', () => {
  render(<TestForm onChange={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Tags - optional' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('adds and removes a row without constraint text and hands the form the changed rows', () => {
  const onChange = vi.fn();
  const { container } = render(<TestForm onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  expect(screen.getByRole('textbox', { name: 'Key' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Value - optional' })).toBeInTheDocument();
  const fields = createWrapper(container).findAttributeEditor()?.findRows()[0];
  expect(fields?.findField(1)?.findConstraint()).toBeNull();
  expect(fields?.findField(2)?.findConstraint()).toBeNull();
  expect(onChange).toHaveBeenLastCalledWith([{ key: '', value: '' }]);

  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(onChange).toHaveBeenLastCalledWith([]);
});

it('shows a failing row message at its key and focuses that key when the form checks', () => {
  render(<TestForm onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Value - optional' }), { target: { value: 'dev' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));

  const key = screen.getByRole('textbox', { name: 'Key' });
  expect(key).toHaveAccessibleDescription('Enter a key.');
  expect(key).toHaveFocus();
});
