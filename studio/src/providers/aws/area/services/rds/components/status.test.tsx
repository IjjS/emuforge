import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusValue } from './status';

const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function shown(status: string) {
  const { container, unmount } = render(<StatusValue status={status} />);
  const indicator = createWrapper(container).findStatusIndicator();
  const result = {
    text: text(container),
    type: [...(indicator?.getElement().classList ?? [])]
      .map((name) => /status-([a-z-]+)_/.exec(name)?.[1])
      .find(Boolean),
    status: indicator !== null,
  };
  unmount();
  return result;
}

describe('a status', () => {
  it('each status → its word as the API names it, with the status of its kind', () => {
    for (const [status, kind] of [
      ['available', 'success'],
      ['stopped', 'stopped'],
      ['creating', 'in-progress'],
      ['starting', 'in-progress'],
      ['stopping', 'in-progress'],
      ['rebooting', 'in-progress'],
      ['modifying', 'in-progress'],
      ['deleting', 'in-progress'],
    ] as const) {
      const result = shown(status);
      expect(result.text, status).toBe(status);
      expect(result.status, status).toBe(true);
      expect(result.type, status).toBe(kind);
    }
  });

  it('an unknown status → shown as it came, as text, with no status', () => {
    const result = shown('storage-full');
    expect(result.text).toBe('storage-full');
    expect(result.status).toBe(false);
  });
});
