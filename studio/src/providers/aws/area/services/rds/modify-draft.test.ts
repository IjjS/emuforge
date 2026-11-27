import { describe, expect, it } from 'vitest';

import {
  afterParent,
  afterSubnetGroup,
  canSave,
  changes,
  draftField,
  editField,
  sameSecurityGroups,
  versionChange,
} from './modify-draft';

describe('a modify draft', () => {
  const classField = draftField<string | undefined>('db.start');
  const version = draftField('16.4');
  const upgraded = editField(version, '17.9');
  const classMessage = 'Choose a class for 17.9';
  const identifier = draftField('instance');

  it('sends no changes when nothing changed', () => {
    expect(changes({ identifier, classField })).toEqual({});
    expect(canSave({ identifier, classField }, [], ['classField'])).toBe(false);
  });

  it('sends only the changed field until it goes back to its starting value', () => {
    const renamed = editField(identifier, 'renamed');
    expect(changes({ identifier: renamed, classField })).toEqual({ identifier: 'renamed' });
    expect(changes({ identifier: editField(renamed, 'instance'), classField })).toEqual({});
  });

  it('keeps an unlisted starting class with its missing marker and omits it from a save', () => {
    const reconciled = afterParent(classField, version, ['db.other'], classMessage);
    expect(reconciled).toMatchObject({ value: 'db.start', missing: true });
    expect(changes({ classField: reconciled })).toEqual({});
  });

  it('keeps the starting class if the new version has it, omitting class from changes', () => {
    const reconciled = afterParent(classField, upgraded, ['db.start'], classMessage);
    expect(reconciled).toMatchObject({ value: 'db.start', missing: false });
    expect(changes({ version: upgraded, classField: reconciled })).toEqual({ version: '17.9' });
  });

  it.each([
    [classField, 'version', classMessage],
    [draftField<string | undefined>('gp3'), 'class', 'Choose a storage type for db.other'],
    [draftField<string | undefined>('aurora'), 'version', 'Choose a storage type for 17.9'],
  ])('clears a child that the new %s list lacks and holds the save', (child, key, message) => {
    const parent = key === 'class' ? editField(draftField('db.start'), 'db.other') : upgraded;
    const reconciled = afterParent(child, parent, [], message);
    expect(reconciled).toMatchObject({ value: undefined, cleared: message });
    expect(canSave({ child: reconciled, parent }, [], ['child', 'parent'])).toBe(false);
  });

  it('clears a class the developer chose if the new version lacks it', () => {
    const chosen = editField(classField, 'db.chosen');
    expect(afterParent(chosen, upgraded, ['db.start'], classMessage)).toMatchObject({
      value: undefined,
      cleared: classMessage,
    });
  });

  it('restores a cleared class when the starting version returns', () => {
    const cleared = afterParent(classField, upgraded, ['db.other'], classMessage);
    const restored = afterParent(cleared, version, ['db.start'], classMessage);
    expect(restored.value).toBe('db.start');
    expect(restored.cleared).toBeUndefined();
    expect(changes({ version, classField: restored })).toEqual({});
  });

  it('keeps another chosen class if the starting version holds it', () => {
    const chosen = editField(classField, 'db.other');
    const reconciled = afterParent(chosen, version, ['db.start', 'db.other'], classMessage);
    expect(reconciled.value).toBe('db.other');
    expect(changes({ version, classField: reconciled })).toEqual({ classField: 'db.other' });
  });

  it('flags a major upgrade only', () => {
    expect(versionChange({ version: '17.9', major: true })).toEqual({
      EngineVersion: '17.9',
      AllowMajorVersionUpgrade: true,
    });
    expect(versionChange({ version: '16.13', major: false })).toEqual({ EngineVersion: '16.13' });
    expect(versionChange(undefined)).toEqual({});
  });

  it('prunes security groups by their own VPC and requires at least one after a subnet group change', () => {
    const oldGroup = { id: 'sg-old', vpcId: 'vpc-old' };
    const newGroup = { id: 'sg-new', vpcId: 'vpc-new' };
    const subnetGroup = editField(draftField('old'), 'new');
    const groups = draftField<readonly (typeof oldGroup)[]>([oldGroup, newGroup]);
    expect(afterSubnetGroup(groups, subnetGroup, 'vpc-new').value).toEqual([newGroup]);
    const cleared = afterSubnetGroup(groups, subnetGroup, 'vpc-empty');
    expect(cleared).toMatchObject({ value: [], cleared: 'Choose security groups of vpc-empty' });
    expect(canSave({ subnetGroup, groups: cleared }, [], [])).toBe(false);
  });

  it('restores partially pruned starting groups when the subnet group returns to its start', () => {
    const groupA = { id: 'sg-a', vpcId: 'vpc-a' };
    const groupB = { id: 'sg-b', vpcId: 'vpc-b' };
    const groups = draftField<readonly (typeof groupA)[]>([groupA, groupB], sameSecurityGroups);
    const subnetA = draftField('subnet-group-a');
    const subnetB = editField(subnetA, 'subnet-group-b');
    const pruned = afterSubnetGroup(groups, subnetB, 'vpc-b');
    expect(pruned.value).toEqual([groupB]);
    expect(pruned.cleared).toBeUndefined();

    const refreshed = afterSubnetGroup(pruned, subnetB, 'vpc-b');
    const restoredSubnet = editField(subnetB, subnetA.start);
    const restored = afterSubnetGroup(refreshed, restoredSubnet, 'vpc-a');
    const draft = { subnetGroup: restoredSubnet, groups: restored, identifier: editField(identifier, 'renamed') };
    expect(restored.value).toEqual([groupA, groupB]);
    expect(canSave(draft, [], [])).toBe(true);
    expect(changes(draft)).toEqual({ identifier: 'renamed' });
  });

  it.each([false, true])(
    'restores the starting selection after a replacement in another VPC (rename: %s)',
    (rename) => {
      const groupA = { id: 'sg-a', vpcId: 'vpc-a' };
      const groupB = { id: 'sg-b', vpcId: 'vpc-b' };
      const groups = draftField<readonly (typeof groupA)[]>([groupA], sameSecurityGroups);
      const subnetA = draftField('subnet-group-a');
      const subnetB = editField(subnetA, 'subnet-group-b');
      const pruned = afterSubnetGroup(groups, subnetB, 'vpc-b');
      expect(pruned).toMatchObject({ value: [], cleared: 'Choose security groups of vpc-b' });

      const replaced = editField(pruned, [groupB]);
      expect(replaced.value).toEqual([groupB]);
      expect(replaced.cleared).toBeUndefined();
      const restoredSubnet = editField(subnetB, subnetA.start);
      const restored = afterSubnetGroup(replaced, restoredSubnet, 'vpc-a');
      const draft = {
        subnetGroup: restoredSubnet,
        groups: restored,
        identifier: rename ? editField(identifier, 'renamed') : identifier,
      };
      expect(restored.value).toEqual([groupA]);
      expect(restored.cleared).toBeUndefined();
      expect(canSave(draft, undefined, [])).toBe(rename);
      expect(changes(draft)).toEqual(rename ? { identifier: 'renamed' } : {});
    },
  );

  it('keeps an explicit replacement that belongs to the restored subnet group’s VPC', () => {
    const starting = { id: 'sg-outside', vpcId: 'vpc-outside' };
    const replacement = { id: 'sg-replacement', vpcId: 'vpc-shared' };
    const groups = draftField<readonly (typeof starting)[]>([starting], sameSecurityGroups);
    const subnetA = draftField('subnet-group-a');
    const subnetB = editField(subnetA, 'subnet-group-b');
    const pruned = afterSubnetGroup(groups, subnetB, 'vpc-shared');
    const waiting = afterSubnetGroup(editField(pruned, [replacement]), subnetA, undefined);
    const draft = { subnetGroup: subnetA, groups: waiting, identifier: editField(identifier, 'renamed') };
    expect(waiting.value).toEqual([starting]);
    expect(waiting.cleared).toBeUndefined();
    expect(canSave(draft, undefined, [])).toBe(true);
    expect(changes(draft)).toEqual({ identifier: 'renamed' });

    const restored = afterSubnetGroup(waiting, subnetA, 'vpc-shared');
    const refreshed = afterSubnetGroup(restored, subnetA, 'vpc-shared');

    expect(refreshed.value).toEqual([starting, replacement]);
    expect(refreshed.cleared).toBeUndefined();
    expect(changes({ subnetGroup: subnetA, groups: refreshed })).toEqual({ groups: [starting, replacement] });
  });

  it('compares security group selections by id independently of read metadata and list order', () => {
    const groups = draftField([{ id: 'sg-one' }, { id: 'sg-two' }], sameSecurityGroups);
    expect(changes({ groups: editField(groups, [{ id: 'sg-two', name: 'two' }, { id: 'sg-one' }]) })).toEqual({});
  });

  it('allows changes independent of rows when a rows read is pending or failed', () => {
    const renamed = editField(identifier, 'renamed');
    const independent = { identifier: renamed, classField, version };
    expect(canSave(independent, undefined, ['classField', 'version'])).toBe(true);
    expect(changes(independent)).toEqual({ identifier: 'renamed' });
    const changedClass = { ...independent, classField: editField(classField, 'db.other') };
    expect(canSave(changedClass, undefined, ['classField', 'version'])).toBe(false);
    expect(canSave(changedClass, [], ['classField', 'version'])).toBe(true);
  });
});
