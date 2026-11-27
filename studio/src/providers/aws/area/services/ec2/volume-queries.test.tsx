import { describe, expect, it } from 'vitest';

import { volumeInstanceChoices, volumeSnapshotChoices } from './volume-queries';

const endpoint = 'http://127.0.0.1:9999';

describe('volume form choices', () => {
  it('describes snapshots and reads again on each opening', () => {
    const source = volumeSnapshotChoices(endpoint);
    expect(source.readAgainOnOpen).toBe(true);
    expect(
      source.optionOf({ id: 'snap-1', size: 3, state: 'completed', volumeId: 'vol-1', description: 'Base image' }),
    ).toEqual({
      value: 'snap-1',
      label: 'snap-1',
      description: '3 GiB · completed · vol-1 · Base image',
    });
  });

  it('describes instances by name or ID, state and type and reads again on each opening', () => {
    const source = volumeInstanceChoices(endpoint, 'us-east-1b');
    expect(source.key).not.toEqual(volumeInstanceChoices(endpoint, 'us-east-1c').key);
    expect(source.readAgainOnOpen).toBe(true);
    expect(source.optionOf({ id: 'i-1', name: 'Worker', state: 'running', type: 't3.micro', devices: [] })).toEqual({
      value: 'i-1',
      label: 'Worker',
      labelTag: 'i-1',
      description: 'running · t3.micro',
    });
    expect(source.optionOf({ id: 'i-2', state: 'stopped', type: 't3.nano', devices: [] })).toEqual({
      value: 'i-2',
      label: 'i-2',
      description: 'stopped · t3.nano',
    });
  });
});
