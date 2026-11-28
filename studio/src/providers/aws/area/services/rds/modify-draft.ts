import type { SecurityGroupChoice } from '../../components/security-group-choices';
import type { UpgradeTarget } from './choices-api';

export const NOT_IN_LIST = "Not in the emulator's list";

export interface DraftField<T> {
  start: T;
  value: T;
  cleared?: string | undefined;
  clearedByParent?: boolean | undefined;
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

export function afterParent<T, P>(
  child: DraftField<T | undefined>,
  parent: DraftField<P>,
  list: readonly T[] | undefined,
  message: string,
  ancestorChanged = false,
): DraftField<T | undefined> {
  const parentChanged = ancestorChanged || changed(parent);
  const { start, value } = child;
  const eligible = value === undefined ? start === undefined && child.cleared === undefined : list?.includes(value);
  // A replacement can survive a revert once the restored list confirms it belongs.
  if (!parentChanged && child.clearedByParent === true && (child.cleared !== undefined || eligible === false)) {
    return {
      ...editField(child, start),
      clearedByParent: undefined,
      missing: start !== undefined && list !== undefined && !list.includes(start),
    };
  }
  if (list === undefined) return child;

  if (eligible || (!parentChanged && Object.is(value, start))) {
    return {
      ...editField(child, value),
      clearedByParent: parentChanged ? child.clearedByParent : undefined,
      missing: !eligible && value !== undefined,
    };
  }
  return { ...editField(child, undefined), cleared: message, clearedByParent: parentChanged || undefined };
}

export function sameSecurityGroups(
  left: readonly SecurityGroupChoice[],
  right: readonly SecurityGroupChoice[],
): boolean {
  return left.length === right.length && left.every(({ id }) => right.some((group) => group.id === id));
}

interface SecurityGroupDraft<Group> extends DraftField<readonly Group[]> {
  subnetGroupRemoval?: {
    // An empty list records that a replacement was required without displacing a starting group.
    ids: readonly string[];
    pendingReplacements?: readonly Group[];
  };
}

export function editSecurityGroups<Group extends SecurityGroupChoice>(
  groups: SecurityGroupDraft<Group>,
  value: readonly Group[],
): SecurityGroupDraft<Group> {
  const { subnetGroupRemoval: removal, ...current } = groups;
  const field = editField(current, value);
  if (removal === undefined || removal.pendingReplacements !== undefined) return field;

  // Choosing a displaced group again makes its later removal an explicit edit.
  const selectedIds = new Set(value.map(({ id }) => id));
  return { ...field, subnetGroupRemoval: { ids: removal.ids.filter((id) => !selectedIds.has(id)) } };
}

export function afterSubnetGroup<P, Group extends SecurityGroupChoice>(
  groups: SecurityGroupDraft<Group>,
  subnetGroup: DraftField<P>,
  vpcId: string | undefined,
): SecurityGroupDraft<Group> {
  const subnetChanged = changed(subnetGroup);
  const startingIds = new Set(groups.start.map(({ id }) => id));
  const removal = groups.subnetGroupRemoval;
  if (!subnetChanged && removal !== undefined) {
    const replacements = removal.pendingReplacements ?? groups.value.filter(({ id }) => !startingIds.has(id));
    const selectedIds = new Set([...groups.value.map(({ id }) => id), ...removal.ids]);
    const restored = groups.start.filter(({ id }) => selectedIds.has(id));
    const starting = editField(draftField(groups.start, groups.equal), restored);
    if (vpcId === undefined) {
      return replacements.length === 0
        ? starting
        : { ...starting, subnetGroupRemoval: { ids: removal.ids, pendingReplacements: replacements } };
    }
    return editField(starting, [...starting.value, ...replacements.filter((group) => group.vpcId === vpcId)]);
  }
  if (vpcId === undefined || (!subnetChanged && !changed(groups))) return groups;

  const remaining = groups.value.filter(
    (group) => group.vpcId === vpcId || (!subnetChanged && startingIds.has(group.id)),
  );
  const field = {
    ...editField(draftField(groups.start, groups.equal), remaining),
    cleared: remaining.length === 0 ? `Choose security groups of ${vpcId}` : undefined,
  };
  if (!subnetChanged) return field;

  const displaced = groups.value.filter((group) => group.vpcId !== vpcId && startingIds.has(group.id));
  if (removal === undefined && displaced.length === 0 && remaining.length > 0) return field;
  return {
    ...field,
    subnetGroupRemoval: { ids: [...new Set([...(removal?.ids ?? []), ...displaced.map(({ id }) => id)])] },
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
