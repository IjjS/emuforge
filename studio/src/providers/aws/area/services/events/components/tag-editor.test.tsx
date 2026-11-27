import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

import { MAX_TAGS, validateTags, type Tag } from '../../../components/tags';
import { TagEditor } from './tag-editor';

function editor(container: HTMLElement) {
  const wrapper = createWrapper(container).findAttributeEditor();
  if (!wrapper) throw new Error('Expected the tag editor');
  return wrapper;
}

function field(container: HTMLElement, row: number, column: number) {
  const wrapper = editor(container).findRow(row)?.findField(column);
  if (!wrapper) throw new Error('Expected a tag field');
  return wrapper;
}

function input(container: HTMLElement, row: number, column: number) {
  const control = field(container, row, column).findControl()?.findInput();
  if (!control) throw new Error('Expected a tag input');
  return control.findNativeInput().getElement();
}

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
  const { container } = render(<Editor />);
  const tags = editor(container);
  tags.findAddButton().click();
  expect(change).toHaveBeenLastCalledWith([{ key: '', value: '' }]);
  expect(input(container, 1, 1)).toHaveFocus();
  fireEvent.change(input(container, 1, 1), { target: { value: 'team' } });
  fireEvent.change(input(container, 1, 2), { target: { value: 'core' } });
  expect(change).toHaveBeenLastCalledWith([{ key: 'team', value: 'core' }]);
  tags.findAddButton().click();
  expect(input(container, 2, 1)).toHaveFocus();
  tags.findRow(2)?.findRemoveButton()?.click();
  tags.findRow(1)?.findRemoveButton()?.click();
  expect(change).toHaveBeenLastCalledWith([]);
});

it('disables adding a row at fifty tags and explains the limit', () => {
  const change = vi.fn();
  const tags = Array.from({ length: MAX_TAGS }, (_, index) => ({ key: String(index), value: '' }));
  const { container } = render(<TagEditor tags={tags} onChange={change} />);
  const wrapper = editor(container);
  const add = wrapper.findAddButton().getElement();
  expect(add).toHaveAttribute('aria-disabled', 'true');
  expect(wrapper.findAdditionalInfo()?.getElement()).toHaveTextContent('You can add up to 50 tags.');
  fireEvent.click(add);
  expect(change).not.toHaveBeenCalled();
});

it('reports each tried error on its own field', () => {
  const tags = [{ key: 'aws:team', value: 'x'.repeat(257) }];
  const { container, rerender } = render(<TagEditor tags={tags} onChange={vi.fn()} />);
  expect(field(container, 1, 1).findError()).toBeNull();
  rerender(<TagEditor tags={tags} errors={validateTags(tags)} onChange={vi.fn()} />);
  expect(input(container, 1, 1)).toHaveAccessibleDescription('A tag key cannot start with aws:.');
  expect(input(container, 1, 2)).toHaveAccessibleDescription('Enter a value of up to 256 characters.');
});
