import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TagsTable } from './tags-table';

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('"Tags"', () => {
  it('a row each with "Key" and "Value"; a value that holds markup is shown as text', () => {
    const { container } = render(
      <TagsTable
        tags={[
          { key: 'env', value: 'dev' },
          { key: 'html', value: '<b>bold</b><img src=x onerror=alert(1)>' },
        ]}
      />,
    );
    const table = createWrapper(container).findTable();
    expect((table?.findColumnHeaders() ?? []).map((header) => text(header.getElement()))).toEqual(['Key', 'Value']);
    expect((table?.findRows() ?? []).map((row) => [...row.getElement().querySelectorAll('td, th')].map(text))).toEqual([
      ['env', 'dev'],
      ['html', '<b>bold</b><img src=x onerror=alert(1)>'],
    ]);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('none → "No tags"', () => {
    render(<TagsTable tags={[]} />);
    expect(screen.getByText('No tags')).toBeInTheDocument();
  });
});
