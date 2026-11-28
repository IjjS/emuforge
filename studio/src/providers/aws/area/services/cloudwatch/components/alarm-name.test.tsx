import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AlarmName } from './alarm-name';

afterEach(() => vi.unstubAllGlobals());

it('keeps the name as the whole text of its white-space-preserving element', () => {
  const name = ' first  second\tthird\nlast ';
  const { container } = render(<AlarmName name={name} />);
  const nameBox = container.firstElementChild;
  expect(nameBox?.textContent).toBe(name);
  expect(nameBox).toHaveStyle({ whiteSpace: 'pre-wrap' });
});

it('uses the area name element for a long word', () => {
  const name = 'x'.repeat(255);
  const { container } = render(<AlarmName name={name} />);
  expect(container.querySelector('.aws-area-value-name')?.textContent).toBe(name);
});

it.each([
  [true, 'Name copied'],
  [false, 'Name could not be copied'],
])('copies the exact name and reports %s as %s', async (allowed, result) => {
  const name = ' first  second\nthird\u2028last';
  const writeText = vi.fn(() =>
    allowed ? Promise.resolve() : Promise.reject(new DOMException('denied', 'NotAllowedError')),
  );
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { container } = render(<AlarmName name={name} copy />);
  const copy = createWrapper(container).findCopyToClipboard();
  const button = copy?.findCopyButton().getElement();
  expect(button).toHaveAccessibleName('Copy Name');
  expect(copy?.findDisplayedText()?.find('.aws-area-value-name')?.getElement().textContent).toBe(name);
  if (!button) throw new Error('Copy Name control missing');

  fireEvent.click(button);
  await waitFor(() =>
    expect(copy?.findStatusText({ popoverRenderWithPortal: false })?.getElement().textContent).toBe(result),
  );
  expect(writeText).toHaveBeenCalledExactlyOnceWith(name);
});
