import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyValue } from './copy-value';

const ARN = 'arn:aws:lambda:us-east-1:000000000000:function:p467-copy_Function-1';

function open(value: string | null = ARN) {
  return render(
    <div data-testid="field">
      <CopyValue label="Function ARN" value={value} none="-" />
    </div>,
  );
}

function button(): HTMLElement {
  return screen.getByRole('button', { name: 'Copy Function ARN' });
}

/** The value's own element: the area's address element. */
function valueElement(): HTMLElement {
  return screen.getByTestId('field').querySelector('.aws-area-value-address') as HTMLElement;
}

/** Text drawn between two nodes in document order, `from` and `to` themselves left out. */
function textBetween(from: Node, to: Node): string {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const after = from.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
    const before = to.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING;
    if (after && before && !from.contains(node)) {
      text += node.textContent ?? '';
    }
  }
  return text.trim();
}

function clipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CopyValue, a value with its copy control', () => {
  it('the label "Function ARN": the button "Copy Function ARN" directly before the value, shown as an address', () => {
    open();

    expect(valueElement().textContent).toBe(ARN);
    expect(button().compareDocumentPosition(valueElement()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(textBetween(button(), valueElement())).toBe('');
    expect(screen.getByTestId('field').textContent).toBe(ARN);
  });

  it('pressed with a clipboard that takes the text: the value on it character for character, "Function ARN copied"', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    clipboard(writeText);
    open();

    fireEvent.click(button());

    expect(await screen.findByText('Function ARN copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(ARN);
    expect(screen.queryByText('Function ARN could not be copied')).toBeNull();
  });

  it('pressed with a clipboard that refuses: "Function ARN could not be copied", and nothing else changes', async () => {
    clipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    open();

    fireEvent.click(button());

    expect(await screen.findByText('Function ARN could not be copied')).toBeInTheDocument();
    expect(screen.queryByText('Function ARN copied')).toBeNull();
    expect(valueElement().textContent).toBe(ARN);
    expect(button()).toBeInTheDocument();
  });

  it('the popover with the result: rendered inside the element that holds the control, not under document.body', async () => {
    clipboard(() => Promise.resolve());
    open();

    fireEvent.click(button());

    const result = await screen.findByText('Function ARN copied');
    expect(screen.getByTestId('field')).toContainElement(result);
  });

  it('no value: "-" and no control', () => {
    open(null);

    expect(screen.getByTestId('field').textContent).toBe('-');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
