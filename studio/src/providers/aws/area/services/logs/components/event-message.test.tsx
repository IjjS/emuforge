import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { EventMessage } from './event-message';

it('preserves literal multiline text, HTML-like text and a URL in a preformatted block', () => {
  const message = 'First line\n<b>두 번째 줄</b> https://example.test/path';
  const { container } = render(<EventMessage message={message} />);

  const block = container.querySelector('pre');
  expect(block?.textContent).toBe(message);
  expect(block).toHaveStyle({ whiteSpace: 'pre-wrap' });
  expect(container.querySelector('b')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});
