import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InstanceStateValue } from './instance-state';

const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function shown(state: string) {
  const { container, unmount } = render(<InstanceStateValue state={state} />);
  const status = createWrapper(container).findStatusIndicator();
  const result = {
    text: text(container),
    type: [...(status?.getElement().classList ?? [])].map((name) => /status-([a-z-]+)_/.exec(name)?.[1]).find(Boolean),
    status: status !== null,
  };
  unmount();
  return result;
}

describe("an instance's state", () => {
  it('each state → its word as the API names it, with the status of its kind', () => {
    for (const [state, kind] of [
      ['running', 'success'],
      ['stopped', 'stopped'],
      ['terminated', 'stopped'],
      ['pending', 'in-progress'],
      ['stopping', 'in-progress'],
      ['shutting-down', 'in-progress'],
    ] as const) {
      const result = shown(state);
      expect(result.text, state).toBe(state);
      expect(result.status, state).toBe(true);
      expect(result.type, state).toBe(kind);
    }
  });

  it('a state the list does not know → shown as it came, with no status', () => {
    const result = shown('hibernating');
    expect(result.text).toBe('hibernating');
    expect(result.status).toBe(false);
  });
});
