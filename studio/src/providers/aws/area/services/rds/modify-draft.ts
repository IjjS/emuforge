import type { SecurityGroupChoice } from '../../components/security-group-choices';
import type { UpgradeTarget } from './choices-api';

export const NOT_IN_LIST = "Not in the emulator's list";

export interface DraftField<T> {
  start: T;
  value: T;
  cleared?: string | undefined;
  missing?: boolean;
  equal?: (left: T, right: T) => boolean;
}

export function draftField<T>(start: T, equal?: DraftField<T>['equal']): DraftField<T> {
  return { start, value: start, ...(equal === undefined ? {} : { equal }) };
}

export function editField<T>(field: DraftField<T>, value: T): DraftField<T> {
  return { ...field, value, cleared: undefined, missing: false };
}

export function changed<T>(field: DraftField<T>): boolean {
  return !(field.equal ?? Object.is)(field.start, field.value);
}

type Draft<T> = { [K in keyof T]: DraftField<T[K]> };

export function changes<T>(draft: Draft<T>): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(draft) as (keyof T)[]) {
    const field = draft[key];
    if (field.cleared === undefined && changed(field)) result[key] = field.value;
  }
  return result;
}

/** An unseen list leaves the draft alone until it is known which children belong. */
export function afterParent<T, P>(
  child: DraftField<T | undefined>,
  parent: DraftField<P>,
  list: readonly T[] | undefined,
  message: string,
  ancestorChanged = false,
): DraftField<T | undefined> {
  if (list === undefined) return child;

  const parentChanged = ancestorChanged || changed(parent);
  const value = !parentChanged && child.cleared !== undefined ? child.start : child.value;
  if (value !== undefined && list.includes(value)) return editField(child, value);
  if (!parentChanged && Object.is(value, child.start)) {
    return { ...editField(child, value), missing: value !== undefined };
  }
  // A fixed, unset value remains valid across a parent change. A previously cleared choice still needs replacing.
  if (value === undefined && child.start === undefined && child.cleared === undefined) return child;
  return { ...editField(child, undefined), cleared: message };
}

export function sameSecurityGroups(
  left: readonly SecurityGroupChoice[],
  right: readonly SecurityGroupChoice[],
): boolean {
  return left.length === right.length && left.every(({ id }) => right.some((group) => group.id === id));
}

interface SecurityGroupDraft<Group> extends DraftField<readonly Group[]> {
  // An empty list records that the subnet change required a replacement without displacing a starting group.
  removedBySubnetGroup?: readonly string[];
}

export function afterSubnetGroup<P, Group extends SecurityGroupChoice>(
  groups: SecurityGroupDraft<Group>,
  subnetGroup: DraftField<P>,
  vpcId: string | undefined,
): SecurityGroupDraft<Group> {
  const subnetChanged = changed(subnetGroup);
  const startingIds = new Set(groups.start.map(({ id }) => id));
  if (!subnetChanged && groups.removedBySubnetGroup !== undefined) {
    const replacements = groups.value.filter(({ id }) => !startingIds.has(id));
    if (vpcId === undefined && replacements.length > 0) return groups;
    const restored = [...groups.start, ...replacements.filter((group) => group.vpcId === vpcId)];
    return editField(draftField(groups.start, groups.equal), restored);
  }
  if (vpcId === undefined || (!subnetChanged && !changed(groups))) return groups;

  const remaining = groups.value.filter(
    (group) => group.vpcId === vpcId || (!subnetChanged && startingIds.has(group.id)),
  );
  const field = {
    ...editField(groups, remaining),
    cleared: remaining.length === 0 ? `Choose security groups of ${vpcId}` : undefined,
  };
  if (!subnetChanged) return field;

  const displaced = groups.value.filter((group) => group.vpcId !== vpcId && startingIds.has(group.id));
  if (displaced.length === 0 && remaining.length > 0) return field;
  return {
    ...field,
    removedBySubnetGroup: [...new Set([...(groups.removedBySubnetGroup ?? []), ...displaced.map(({ id }) => id)])],
  };
}

export function versionChange(target: UpgradeTarget | undefined): {
  EngineVersion?: string;
  AllowMajorVersionUpgrade?: true;
} {
  if (target === undefined) return {};
  return { EngineVersion: target.version, ...(target.major ? { AllowMajorVersionUpgrade: true } : {}) };
}

export function canSave<T>(
  draft: Draft<T>,
  rows: readonly unknown[] | undefined,
  rowFields: readonly (keyof T)[],
): boolean {
  const fields = Object.values(draft) as DraftField<unknown>[];
  return (
    fields.some((field) => changed(field)) &&
    fields.every((field) => field.cleared === undefined) &&
    (rows !== undefined || rowFields.every((key) => !changed(draft[key])))
  );
}
