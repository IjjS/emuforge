import type { OrderableDBInstanceOption } from '@aws-sdk/client-rds';

import type { EngineVersionChoice, UpgradeTarget } from './choices-api';

export interface StorageTypeChoice {
  type: string;
  minSize?: number;
  maxSize?: number;
  minIops?: number;
  maxIops?: number;
  minIopsPerGib?: number;
  maxIopsPerGib?: number;
}

export interface InstanceClassChoice {
  name: string;
  storageTypes: StorageTypeChoice[];
}

export function storageTypes(rows: readonly OrderableDBInstanceOption[]): StorageTypeChoice[] {
  const types = new Map<string, StorageTypeChoice>();
  for (const row of rows) {
    const type = row.StorageType;
    if (!type || types.has(type)) continue;

    types.set(type, {
      type,
      ...(row.MinStorageSize === undefined ? {} : { minSize: row.MinStorageSize }),
      ...(row.MaxStorageSize === undefined ? {} : { maxSize: row.MaxStorageSize }),
      ...(row.MinIopsPerDbInstance === undefined ? {} : { minIops: row.MinIopsPerDbInstance }),
      ...(row.MaxIopsPerDbInstance === undefined ? {} : { maxIops: row.MaxIopsPerDbInstance }),
      ...(row.MinIopsPerGib === undefined ? {} : { minIopsPerGib: row.MinIopsPerGib }),
      ...(row.MaxIopsPerGib === undefined ? {} : { maxIopsPerGib: row.MaxIopsPerGib }),
    });
  }
  return [...types.values()];
}

export function instanceClasses(rows: readonly OrderableDBInstanceOption[]): InstanceClassChoice[] {
  const classes = new Map<string, OrderableDBInstanceOption[]>();
  for (const row of rows) {
    const name = row.DBInstanceClass;
    if (!name) continue;

    const classRows = classes.get(name);
    if (classRows === undefined) classes.set(name, [row]);
    else classRows.push(row);
  }
  return [...classes].map(([name, classRows]) => ({ name, storageTypes: storageTypes(classRows) }));
}

export function availableUpgradeTargets(
  targets: readonly UpgradeTarget[],
  versions: readonly EngineVersionChoice[],
): UpgradeTarget[] {
  const available = new Set(versions.map(({ version }) => version));
  return targets.filter(({ version }) => available.has(version));
}
