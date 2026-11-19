import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import type { Delivery } from '../api';
import { DeliveryStatus, deliveryView, type DeliveryView } from './delivery-status';

const CONNECTED: AreaConnection = {
  result: {
    kind: 'connected',
    checkedAt: 0,
    emulator: { port: 9309, endpoint: 'https://127.0.0.1:9309' },
  },
  engineOrigin: 'http://127.0.0.1:8309',
};

function shown(view: DeliveryView): { text: string; type: string | undefined } {
  const { container } = render(<DeliveryStatus view={view} connection={CONNECTED} />);
  const indicator = createWrapper(container).findStatusIndicator()?.getElement();
  const type = [...(indicator?.classList ?? [])].map((name) => /status-([a-z-]+)_/.exec(name)?.[1]).find(Boolean);
  return { text: (container.textContent ?? '').replace(/\s+/g, ' ').trim(), type };
}

const read = (delivery: Delivery): DeliveryView => ({ kind: 'read', delivery });

describe('a row’s "Delivery"', () => {
  const cases: [string, DeliveryView, string, string | undefined][] = [
    ['allowed', read({ kind: 'allowed' }), 'Allowed', 'success'],
    ['no permission', read({ kind: 'none' }), 'No permission', 'warning'],
    ['cannot tell', read({ kind: 'unknown', reason: 'Studio cannot read it' }), 'Cannot tell', 'info'],
    ['a queue not found', read({ kind: 'queue-not-found' }), 'Queue not found', 'error'],
    ['a function not found', read({ kind: 'function-not-found' }), 'Function not found', 'error'],
    ['while it is read', { kind: 'checking' }, 'Checking', 'loading'],
    [
      'a failed read',
      {
        kind: 'failed',
        failure: { kind: 'other', operation: 'GetQueueAttributes', code: 'InternalError', message: 'x' },
      },
      'The delivery could not be read',
      'error',
    ],
    [
      'a failed read, not implemented',
      { kind: 'failed', failure: { kind: 'not-implemented', operation: 'GetPolicy' } },
      'Not implemented by the emulator',
      'error',
    ],
    ['a row of another protocol', { kind: 'other-protocol' }, '-', undefined],
  ];
  for (const [what, view, text, type] of cases) {
    it(`${what} → "${text}"`, () => {
      expect(shown(view)).toEqual({ text, type });
    });
  }
});

describe('the view of a delivery read', () => {
  const refresh = () => undefined;
  const failure: RequestFailure = { kind: 'engine-did-not-answer', operation: 'GetPolicy' };
  it('in flight → checking; failed → failed; an answer → read', () => {
    expect(deliveryView({ value: undefined, failure: undefined, loading: true, refresh })).toEqual({
      kind: 'checking',
    });
    expect(deliveryView({ value: { kind: 'none' }, failure: undefined, loading: true, refresh })).toEqual({
      kind: 'checking',
    });
    expect(deliveryView({ value: undefined, failure, loading: false, refresh })).toEqual({ kind: 'failed', failure });
    expect(deliveryView({ value: { kind: 'allowed' }, failure: undefined, loading: false, refresh })).toEqual(
      read({ kind: 'allowed' }),
    );
  });
});

describe('"Cannot tell"', () => {
  for (const reason of ['Studio cannot read it', 'it has a Deny statement, which Studio does not evaluate']) {
    it(`keeps its text and reaches the reason "${reason}" in a popover`, async () => {
      const { container } = render(<DeliveryStatus view={read({ kind: 'unknown', reason })} connection={CONNECTED} />);
      expect((container.textContent ?? '').trim()).toBe('Cannot tell');
      const popover = createWrapper(container).findPopover();
      expect(popover).not.toBeNull();
      popover?.findTrigger().click();
      await waitFor(() => {
        expect((popover?.findContent()?.getElement().textContent ?? '').trim()).toBe(
          `Studio cannot tell whether this topic may deliver: ${reason}.`,
        );
      });
    });
  }

  it('another delivery has no popover', () => {
    const { container } = render(<DeliveryStatus view={read({ kind: 'none' })} connection={CONNECTED} />);
    expect(createWrapper(container).findPopover()).toBeNull();
  });
});
