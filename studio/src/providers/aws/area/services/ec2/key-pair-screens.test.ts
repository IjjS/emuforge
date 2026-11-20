import { describe, expect, it } from 'vitest';

import { KEY_PAIR_SCREENS } from './key-pair-screens';
import { SCREENS } from './screens';

const NO_QUERY = new URLSearchParams();

function screenAt(path: string) {
  const screen = SCREENS.find((candidate) => candidate.paths.includes(path));
  expect(screen, path).toBeDefined();
  return screen as NonNullable<typeof screen>;
}

function title(path: string) {
  const value = screenAt(path).title;
  return typeof value === 'string' ? value : value({}, NO_QUERY);
}

function crumbs(path: string) {
  const value = screenAt(path).crumbs;
  return typeof value === 'function' ? value({}, NO_QUERY) : value;
}

describe("EC2's key pair screens", () => {
  it('S8 at /aws/ec2/key-pairs and S9 at /aws/ec2/key-pairs/create, each with its title and crumbs and "Key pairs" active', () => {
    for (const screen of KEY_PAIR_SCREENS) {
      expect(SCREENS).toContain(screen);
    }
    expect(title('/aws/ec2/key-pairs')).toBe('Key pairs');
    expect(crumbs('/aws/ec2/key-pairs')).toEqual([{ text: 'Key pairs' }]);
    expect(title('/aws/ec2/key-pairs/create')).toBe('Create key pair');
    expect(crumbs('/aws/ec2/key-pairs/create')).toEqual([
      { text: 'Key pairs', href: '/aws/ec2/key-pairs' },
      { text: 'Create key pair' },
    ]);
    for (const path of ['/aws/ec2/key-pairs', '/aws/ec2/key-pairs/create']) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/ec2/key-pairs');
      expect(screenAt(path).navigation.header).toEqual({ text: 'EC2', href: '/aws/ec2' });
    }
  });
});
