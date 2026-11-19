import { describe, expect, it } from 'vitest';

import {
  EMPTY_FORM,
  ENTER_DEDUPLICATION_ID,
  ENTER_GROUP_ID,
  ENTER_MESSAGE,
  ENTER_NAME,
  ENTER_VALUE,
  firstFault,
  NAME_USED,
  publishFaults,
  type PublishForm,
} from './publish-form';

const STANDARD = { fifo: false, contentBasedDeduplication: false };
const FIFO = { fifo: true, contentBasedDeduplication: false };
const FIFO_CBD = { fifo: true, contentBasedDeduplication: true };

const form = (change: Partial<PublishForm>): PublishForm => ({ ...EMPTY_FORM, message: 'hello', ...change });

describe('publishFaults', () => {
  it('an empty message → "Enter a message."', () => {
    const faults = publishFaults(form({ message: '' }), STANDARD);
    expect(faults.message).toBe(ENTER_MESSAGE);
    expect(firstFault(faults)).toEqual({ field: 'message' });
  });

  it('a message alone → no fault', () => {
    const faults = publishFaults(form({}), STANDARD);
    expect(faults).toEqual({ attributes: [] });
    expect(firstFault(faults)).toBeUndefined();
  });

  it('an attribute row without a name or without a value → its message', () => {
    const faults = publishFaults(
      form({
        attributes: [
          { name: '', type: 'String', value: 'red' },
          { name: 'size', type: 'Number', value: '' },
          { name: 'ok', type: 'String', value: 'yes' },
        ],
      }),
      STANDARD,
    );
    expect(faults.attributes).toEqual([{ name: ENTER_NAME }, { value: ENTER_VALUE }, {}]);
    expect(firstFault(faults)).toEqual({ field: 'attribute', row: 0, part: 'name' });
  });

  it('a name used twice → "This name is already used." on the second', () => {
    const faults = publishFaults(
      form({
        attributes: [
          { name: 'color', type: 'String', value: 'red' },
          { name: 'color', type: 'String', value: 'blue' },
        ],
      }),
      STANDARD,
    );
    expect(faults.attributes).toEqual([{}, { name: NAME_USED }]);
    expect(firstFault(faults)).toEqual({ field: 'attribute', row: 1, part: 'name' });
  });

  it('a FIFO topic: no group ID → its message', () => {
    const faults = publishFaults(form({ deduplicationId: 'd1' }), FIFO);
    expect(faults.groupId).toBe(ENTER_GROUP_ID);
    expect(faults.deduplicationId).toBeUndefined();
    expect(firstFault(faults)).toEqual({ field: 'groupId' });
  });

  it('a FIFO topic: no deduplication ID with content-based deduplication off → its message, on → none', () => {
    const off = publishFaults(form({ groupId: 'g1' }), FIFO);
    expect(off.deduplicationId).toBe(ENTER_DEDUPLICATION_ID);
    expect(firstFault(off)).toEqual({ field: 'deduplicationId' });
    const on = publishFaults(form({ groupId: 'g1' }), FIFO_CBD);
    expect(on.deduplicationId).toBeUndefined();
    expect(firstFault(on)).toBeUndefined();
  });

  it('a standard topic → neither ID is asked', () => {
    const faults = publishFaults(form({ groupId: '', deduplicationId: '' }), STANDARD);
    expect(faults.groupId).toBeUndefined();
    expect(faults.deduplicationId).toBeUndefined();
  });
});
