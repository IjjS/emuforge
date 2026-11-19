import { describe, expect, it } from 'vitest';

import { SCREENS } from './screens';

const ARN = 'arn:aws:sns:us-east-1:000000000000:orders';
const NO_QUERY = new URLSearchParams();

function screenAt(path: string) {
  const screen = SCREENS.find((candidate) => candidate.paths.includes(path));
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

describe("SNS's screens", () => {
  it("are registered at the requirement's routes, with their titles, crumbs and the navigation", () => {
    expect(SCREENS.map((screen) => screen.paths)).toEqual([
      ['/aws/sns', '/aws/sns/topics'],
      ['/aws/sns/topics/create'],
      ['/aws/sns/topics/topic/{arn}'],
      ['/aws/sns/topics/topic/{arn}/subscribe'],
    ]);

    expect(title('/aws/sns')).toBe('Topics');
    expect(crumbs('/aws/sns')).toEqual([{ text: 'Topics' }]);

    expect(title('/aws/sns/topics/create')).toBe('Create topic');
    expect(crumbs('/aws/sns/topics/create')).toEqual([
      { text: 'Topics', href: '/aws/sns/topics' },
      { text: 'Create topic' },
    ]);

    expect(title('/aws/sns/topics/topic/{arn}', { arn: ARN })).toBe('orders');
    expect(crumbs('/aws/sns/topics/topic/{arn}', { arn: ARN })).toEqual([
      { text: 'Topics', href: '/aws/sns/topics' },
      { text: 'orders' },
    ]);

    expect(title('/aws/sns/topics/topic/{arn}/subscribe', { arn: ARN })).toBe('Create subscription');
    expect(crumbs('/aws/sns/topics/topic/{arn}/subscribe', { arn: ARN })).toEqual([
      { text: 'Topics', href: '/aws/sns/topics' },
      { text: 'orders', href: `/aws/sns/topics/topic/${encodeURIComponent(ARN)}` },
      { text: 'Create subscription' },
    ]);

    for (const screen of SCREENS) {
      expect(screen.navigation.header).toEqual({ text: 'SNS', href: '/aws/sns' });
      expect(screen.navigation.items).toEqual([{ type: 'link', text: 'Topics', href: '/aws/sns/topics' }]);
    }
  });
});
