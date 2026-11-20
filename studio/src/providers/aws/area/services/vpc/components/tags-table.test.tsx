import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TagsTable } from './tags-table';

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function rows(container: HTMLElement): string[][] {
  return (createWrapper(container).findTable()?.findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')].map(text),
  );
}

describe('"Tags"', () => {
  it('a row each with "Key" and "Value" in the answer\'s order', () => {
    const { container } = render(
      <TagsTable
        tags={[
          { key: 'Name', value: 'app' },
          { key: 'env', value: 'dev' },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeInTheDocument();
    const headers = (createWrapper(container).findTable()?.findColumnHeaders() ?? []).map((h) => text(h.getElement()));
    expect(headers).toEqual(['Key', 'Value']);
    expect(rows(container)).toEqual([
      ['Name', 'app'],
      ['env', 'dev'],
    ]);
  });

  it('none → "No tags"', () => {
    render(<TagsTable tags={[]} />);
    expect(screen.getByText('No tags')).toBeInTheDocument();
  });

  it('a value that holds markup is shown as text', () => {
    const { container } = render(<TagsTable tags={[{ key: 'note', value: '<b>bold</b><script>x</script>' }]} />);
    expect(rows(container)).toEqual([['note', '<b>bold</b><script>x</script>']]);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});
