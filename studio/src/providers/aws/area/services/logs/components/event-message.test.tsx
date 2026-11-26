import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';

import { EventMessage } from './event-message';

it('preserves literal multiline text, HTML-like text and a URL in a preformatted block', () => {
  const message = 'First line\n<b>두 번째 줄</b> https://example.test/path';
  const { container } = render(<EventMessage message={message} />);

  const block = createWrapper(container).findBox('pre')?.getElement();
  expect(block?.textContent).toBe(message);
  expect(block).toHaveStyle({ whiteSpace: 'pre-wrap' });
  expect(createWrapper(container).findBox('pre')?.find('b') ?? null).toBeNull();
  expect(createWrapper(container).findBox('pre')?.find('a') ?? null).toBeNull();
});
