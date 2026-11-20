import { describe, expect, it } from 'vitest';

import { GROUP_SCREENS } from './group-screens';

const NO_QUERY = new URLSearchParams();

function screenAt(path: string) {
  const screen = GROUP_SCREENS.find((candidate) => candidate.paths.includes(path));
  expect(screen, path).toBeDefined();
  return screen as NonNullable<typeof screen>;
}

function title(path: string, params: Record<string, string> = {}) {
  const value = screenAt(path).title;
  return typeof value === 'string' ? value : value(params, NO_QUERY);
}

function crumbs(path: string, params: Record<string, string> = {}) {
  const value = screenAt(path).crumbs;
  return typeof value === 'function' ? value(params, NO_QUERY) : value;
}

describe("EC2's security group screens", () => {
  it('S4 at /aws/ec2/security-groups, S6 at its group path, with titles, crumbs and "Security groups" active', () => {
    const list = '/aws/ec2/security-groups';
    expect(title(list)).toBe('Security groups');
    expect(crumbs(list)).toEqual([{ text: 'Security groups' }]);

    const group = '/aws/ec2/security-groups/group/{id}';
    expect(title(group, { id: 'sg-0abc' })).toBe('sg-0abc');
    expect(crumbs(group, { id: 'sg-0abc' })).toEqual([
      { text: 'Security groups', href: '/aws/ec2/security-groups' },
      { text: 'sg-0abc' },
    ]);
    for (const path of [list, group]) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/ec2/security-groups');
      expect(screenAt(path).navigation.header).toEqual({ text: 'EC2', href: '/aws/ec2' });
      expect(screenAt(path).navigation.items.map((item) => (item.type === 'link' ? item.text : ''))).toEqual([
        'Instances',
        'Security groups',
        'Key pairs',
      ]);
    }
  });

  it('S5 at …/security-groups/create and S7 at …/group/{id}/add-rule, with their crumbs and "Security groups" active', () => {
    const create = '/aws/ec2/security-groups/create';
    expect(title(create)).toBe('Create security group');
    expect(crumbs(create)).toEqual([
      { text: 'Security groups', href: '/aws/ec2/security-groups' },
      { text: 'Create security group' },
    ]);

    const addRule = '/aws/ec2/security-groups/group/{id}/add-rule';
    expect(title(addRule, { id: 'sg-0abc' })).toBe('Add rule');
    expect(crumbs(addRule, { id: 'sg-0abc' })).toEqual([
      { text: 'Security groups', href: '/aws/ec2/security-groups' },
      { text: 'sg-0abc', href: '/aws/ec2/security-groups/group/sg-0abc' },
      { text: 'Add rule' },
    ]);
    for (const path of [create, addRule]) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/ec2/security-groups');
    }
  });
});
