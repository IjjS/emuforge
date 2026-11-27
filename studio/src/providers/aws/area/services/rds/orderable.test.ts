import { describe, expect, it } from 'vitest';

import { availableUpgradeTargets, instanceClasses, storageTypes } from './orderable';

describe('the RDS catalogue', () => {
  const gp2 = { StorageType: 'gp2', MinStorageSize: 20, MaxStorageSize: 65536 };
  const gp3 = { StorageType: 'gp3', MinStorageSize: 20, MaxStorageSize: 65536 };
  const io1 = {
    StorageType: 'io1',
    MinStorageSize: 100,
    MaxStorageSize: 65536,
    MinIopsPerDbInstance: 1000,
    MaxIopsPerDbInstance: 256000,
    MinIopsPerGib: 0.5,
    MaxIopsPerGib: 50,
  };
  it('offers each class once, with the storage types on its rows', () => {
    const rows = [
      { DBInstanceClass: 'db.first', ...gp2 },
      { DBInstanceClass: 'db.second', ...gp3 },
      { DBInstanceClass: 'db.first', ...io1 },
      { DBInstanceClass: 'db.second', ...gp2 },
    ];
    expect(instanceClasses(rows).map(({ name, storageTypes: types }) => [name, types.map(({ type }) => type)])).toEqual(
      [
        ['db.first', ['gp2', 'io1']],
        ['db.second', ['gp3', 'gp2']],
      ],
    );
  });

  it('exposes storage size and IOPS ranges only when present on the row', () => {
    const [choice] = instanceClasses([
      { DBInstanceClass: 'db.first', ...gp2 },
      { DBInstanceClass: 'db.first', ...io1 },
    ]);
    expect(choice?.storageTypes).toEqual([
      { type: 'gp2', minSize: 20, maxSize: 65536 },
      {
        type: 'io1',
        minSize: 100,
        maxSize: 65536,
        minIops: 1000,
        maxIops: 256000,
        minIopsPerGib: 0.5,
        maxIopsPerGib: 50,
      },
    ]);
  });

  it('deduplicates cluster storage types across classes', () => {
    expect(
      storageTypes([
        { DBInstanceClass: 'db.first', StorageType: 'aurora' },
        { DBInstanceClass: 'db.first', StorageType: 'aurora-iopt1' },
        { DBInstanceClass: 'db.second', StorageType: 'aurora' },
      ]),
    ).toEqual([{ type: 'aurora' }, { type: 'aurora-iopt1' }]);
  });

  it('keeps upgrade target order and leaves out versions the emulator does not list', () => {
    const major = { version: '17.9', major: true };
    const minor = { version: '16.13', major: false };
    expect(
      availableUpgradeTargets(
        [major, { version: '16.5', major: false }, minor],
        [{ version: '16.13' }, { version: '17.9' }],
      ),
    ).toEqual([major, minor]);
  });
});
