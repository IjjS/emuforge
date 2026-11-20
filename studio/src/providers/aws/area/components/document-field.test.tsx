import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentField } from './document-field';

// Test criteria, "Unit s7 — components/document-field.test.tsx" (issue 575).

function Field({
  onChange,
  errorText,
  disabled = false,
}: {
  onChange: (text: string) => void;
  errorText?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState('{"family": "web"}');
  return (
    <DocumentField
      label="Task definition JSON"
      description="What a container echoes becomes the task's log."
      errorText={errorText}
      value={text}
      onChange={(next) => {
        setText(next);
        onChange(next);
      }}
      disabled={disabled}
    />
  );
}

describe("the area's document field", () => {
  it('given a label, a description and a text → all shown, and a change of the text is reported', () => {
    const changes = vi.fn();
    const { container } = render(<Field onChange={changes} />);
    const wrapper = createWrapper(container);

    expect(screen.getByText('Task definition JSON')).toBeTruthy();
    expect(screen.getByText("What a container echoes becomes the task's log.")).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Task definition JSON' })).toBeTruthy();
    const field = wrapper.findFormField();
    expect(field?.findError()).toBeNull();
    const textarea = wrapper.findTextarea();
    expect(textarea?.findNativeTextarea().getElement().value).toBe('{"family": "web"}');

    textarea?.setTextareaValue('{"family": "api"}');
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenLastCalledWith('{"family": "api"}');
    expect(textarea?.findNativeTextarea().getElement().value).toBe('{"family": "api"}');
  });

  it("given an error text → shown as the field's error; disabled → the text cannot be changed", () => {
    const { container, rerender } = render(
      <Field onChange={vi.fn()} errorText="A task definition is a JSON object." />,
    );
    const wrapper = createWrapper(container);
    expect(wrapper.findFormField()?.findError()?.getElement().textContent).toBe('A task definition is a JSON object.');
    expect(wrapper.findTextarea()?.findNativeTextarea().getElement().getAttribute('aria-invalid')).toBe('true');

    rerender(<Field onChange={vi.fn()} disabled />);
    expect(wrapper.findFormField()?.findError()).toBeNull();
    expect(wrapper.findTextarea()?.findNativeTextarea().getElement().disabled).toBe(true);
  });
});
