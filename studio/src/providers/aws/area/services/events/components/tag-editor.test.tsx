import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

import { MAX_TAGS, validateTags, type Tag } from '../../../components/tags';
import { TagEditor } from './tag-editor';

it('reports added, changed and removed tag rows and focuses the new key', () => {
  const change = vi.fn();
  function Editor() {
    const [tags, setTags] = useState<Tag[]>([]);
    return (
      <TagEditor
        tags={tags}
        onChange={(next) => {
          change(next);
          setTags(next);
        }}
      />
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  expect(change).toHaveBeenLastCalledWith([{ key: '', value: '' }]);
  expect(screen.getByRole('textbox', { name: 'Key' })).toHaveFocus();
  fireEvent.change(screen.getByRole('textbox', { name: 'Key' }), { target: { value: 'team' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: 'core' } });
  expect(change).toHaveBeenLastCalledWith([{ key: 'team', value: 'core' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  const [, addedKey] = screen.getAllByRole('textbox', { name: 'Key' });
  expect(addedKey).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Remove tag' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove tag team' }));
  expect(change).toHaveBeenLastCalledWith([]);
});

it('disables adding a row at fifty tags and explains the limit', () => {
  const change = vi.fn();
  const tags = Array.from({ length: MAX_TAGS }, (_, index) => ({ key: String(index), value: '' }));
  render(<TagEditor tags={tags} onChange={change} />);
  const add = screen.getByRole('button', { name: 'Add tag' });
  expect(add).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByText('You can add up to 50 tags.')).toBeVisible();
  fireEvent.click(add);
  expect(change).not.toHaveBeenCalled();
});

it('reports each tried error on its own field', () => {
  const tags = [{ key: 'aws:team', value: 'x'.repeat(257) }];
  const { rerender } = render(<TagEditor tags={tags} onChange={vi.fn()} />);
  expect(screen.queryByText('A tag key cannot start with aws:.')).toBeNull();
  rerender(<TagEditor tags={tags} errors={validateTags(tags)} onChange={vi.fn()} />);
  expect(screen.getByRole('textbox', { name: 'Key' })).toHaveAccessibleDescription('A tag key cannot start with aws:.');
  expect(screen.getByRole('textbox', { name: 'Value' })).toHaveAccessibleDescription(
    'Enter a value of up to 256 characters.',
  );
});
