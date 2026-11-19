import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { documentErrorText, NOT_JSON_TEXT } from '../document-text';
import { DocumentEditor } from './document-editor';

// Test criteria, "Unit s1 — providers/aws/area/services/iam/components/document-editor.test.tsx" (issue 535).

function Editor({ onChange, disabled = false }: { onChange: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState('{}');
  return (
    <DocumentEditor
      label="Policy document"
      description="Saving creates a new version and makes it the default."
      errorText={documentErrorText(text)}
      value={text}
      onChange={(next) => {
        setText(next);
        onChange(next);
      }}
      disabled={disabled}
    />
  );
}

describe('the document editor', () => {
  it('shows its label, description and error text, and reports each change of its text', () => {
    const changes = vi.fn();
    const { container } = render(<Editor onChange={changes} />);
    const wrapper = createWrapper(container);

    expect(screen.getByText('Policy document')).toBeTruthy();
    expect(screen.getByText('Saving creates a new version and makes it the default.')).toBeTruthy();
    const field = wrapper.findFormField();
    expect(field?.findError()).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Policy document' })).toBeTruthy();

    const textarea = wrapper.findTextarea();
    textarea?.setTextareaValue('{"a": ');
    expect(changes).toHaveBeenLastCalledWith('{"a": ');
    expect(field?.findError()?.getElement().textContent).toBe(NOT_JSON_TEXT);

    textarea?.setTextareaValue('{"a": 1}');
    expect(changes).toHaveBeenLastCalledWith('{"a": 1}');
    expect(changes).toHaveBeenCalledTimes(2);
    expect(field?.findError()).toBeNull();
    expect(textarea?.findNativeTextarea().getElement().value).toBe('{"a": 1}');
  });

  it('cannot be changed while a save is in flight', () => {
    const { container } = render(<Editor onChange={vi.fn()} disabled />);
    expect(createWrapper(container).findTextarea()?.findNativeTextarea().getElement().disabled).toBe(true);
  });

  it('checks that a document is one JSON value', () => {
    expect(documentErrorText('{"Version": "2012-10-17"}')).toBeUndefined();
    expect(documentErrorText('')).toBe('Enter the policy as one JSON value.');
    expect(documentErrorText('{} {}')).toBe(NOT_JSON_TEXT);
  });
});
