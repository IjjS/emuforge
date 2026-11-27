import { describe, expect, it } from 'vitest';

import {
  changeVolumeType,
  checkVolumeSettings,
  DEFAULT_VOLUME_SETTINGS,
  volumeRules,
  type VolumeType,
} from './volume-form';

const cases = [
  ['standard', [1, 1024], undefined, undefined],
  ['gp2', [1, 16384], undefined, undefined],
  ['gp3', [1, 65536], { range: [3000, 80000], required: false }, [125, 2000]],
  ['io1', [4, 16384], { range: [100, 64000], required: true }, undefined],
  ['io2', [4, 65536], { range: [100, 256000], required: true }, undefined],
  ['st1', [125, 16384], undefined, undefined],
  ['sc1', [125, 16384], undefined, undefined],
] as const;

function check(updates: Partial<typeof DEFAULT_VOLUME_SETTINGS>, snapshotSize?: number) {
  return checkVolumeSettings({ ...DEFAULT_VOLUME_SETTINGS, ...updates }, snapshotSize);
}

describe('volume settings', () => {
  it.each(cases)('%s uses the emulator’s size, IOPS and throughput ranges', (type, size, iops, throughput) => {
    const rules = volumeRules(type);
    expect(rules.size).toEqual(size);
    expect(rules.iops).toEqual(iops);
    expect(rules.throughput).toEqual(throughput);
  });

  it('requires a size in the chosen type’s range', () => {
    expect(check({}).errors.size).toBe('Enter a size.');
    expect(check({ type: 'standard', size: '1025' }).errors.size).toBe(
      'Enter a whole number from 1 to 1024 for standard.',
    );
  });

  it('inherits a snapshot size inside the range and requires a size when the snapshot is smaller than the minimum', () => {
    expect(check({}, 3)).toMatchObject({ errors: {}, values: { size: undefined } });
    expect(check({ type: 'sc1' }, 3).errors.size).toBe("The snapshot's 3 GiB is under sc1's minimum: enter a size.");
    expect(check({ type: 'sc1', size: '125' }, 3).errors).toEqual({});
    expect(check({ size: '2' }, 3).errors.size).toBe('Enter at least 3 GiB, the size of the snapshot.');
  });

  it.each(['', '1', '1024', '2000'])('rejects a 2000 GiB snapshot with standard even when the size is %j', (size) => {
    expect(check({ type: 'standard', size }, 2000).errors.type).toBe(
      "The snapshot's 2000 GiB is over standard's maximum: choose another volume type.",
    );
  });

  it.each(['io1', 'io2'] as const)('requires IOPS for %s', (type) => {
    expect(check({ type, size: '4' }).errors.iops).toBe('Enter the IOPS.');
  });

  it('validates the IOPS and throughput limits', () => {
    expect(check({ type: 'gp3', size: '1', iops: '2999', throughput: '2001' }).errors).toEqual({
      iops: 'The IOPS are a whole number from 3000 to 80000.',
      throughput: 'The throughput is a whole number from 125 to 2000.',
    });
  });

  it.each<VolumeType>(['gp2', 'standard', 'st1', 'sc1'])(
    'drops IOPS and throughput when the type changes to %s',
    (type) => {
      const changed = changeVolumeType({ type: 'gp3', size: '125', iops: '4000', throughput: '250' }, type);
      expect(changed).toEqual({ type, size: '125', iops: '', throughput: '' });
      expect(checkVolumeSettings(changed, undefined)).toEqual({
        errors: {},
        values: { type, size: 125, iops: undefined, throughput: undefined },
      });
    },
  );
});
