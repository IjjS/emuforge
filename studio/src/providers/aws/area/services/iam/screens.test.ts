import { describe, expect, it } from 'vitest';

import type { ServiceScreen } from '../../screens';
import { findResourceEntry } from '../../entries';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

// Test criteria, "Unit s5 — providers/aws/area/services/iam/screens.test.ts" (issue 535).

function screenAt(path: string): ServiceScreen {
  const found = SCREENS.find((screen) => screen.paths.includes(path));
  expect(found, `a screen at ${path}`).toBeDefined();
  return found as ServiceScreen;
}

function titleOf(screen: ServiceScreen, query = ''): string {
  return typeof screen.title === 'function' ? screen.title({}, new URLSearchParams(query)) : screen.title;
}

function crumbsOf(screen: ServiceScreen, query = '') {
  return typeof screen.crumbs === 'function' ? screen.crumbs({}, new URLSearchParams(query)) : screen.crumbs;
}

const ROLE_SCREENS = ['/aws/iam', '/aws/iam/roles', '/aws/iam/roles/create', '/aws/iam/roles/details/{name}'];
const POLICY_SCREENS = ['/aws/iam/policies', '/aws/iam/policies/details', '/aws/iam/policies/create'];

describe("IAM's screens", () => {
  it('registers S4, S5 and S6 at their paths', () => {
    expect(SCREENS.map((screen) => screen.paths)).toEqual([
      ['/aws/iam', '/aws/iam/roles'],
      ['/aws/iam/roles/details/{name}'],
      ['/aws/iam/roles/create'],
      ['/aws/iam/policies'],
      ['/aws/iam/policies/details'],
      ['/aws/iam/policies/create'],
    ]);
  });

  it('gives every screen the IAM navigation header and leaves the items to the entry registry', () => {
    for (const screen of SCREENS) {
      expect(screen.navigation.items, screen.paths[0]).toBeUndefined();
      expect(screen.navigation.header).toEqual({
        text: 'Identity and Access Management (IAM)',
        href: '/aws/iam',
      });
    }
  });

  it('shows "Roles" current on S1 to S3 and "Policies" current on S4 to S6', () => {
    for (const path of ROLE_SCREENS) {
      const { activeHref } = screenAt(path).navigation;
      expect(activeHref, path).toBe('/aws/iam/roles');
      expect(findResourceEntry(ENTRIES, activeHref)?.label, path).toBe('Roles');
    }
    for (const path of POLICY_SCREENS) {
      const { activeHref } = screenAt(path).navigation;
      expect(activeHref, path).toBe('/aws/iam/policies');
      expect(findResourceEntry(ENTRIES, activeHref)?.label, path).toBe('Policies');
    }
  });

  it('titles S5 and its last crumb with the name of the address\'s ARN, and "Policy" without one', () => {
    const s5 = screenAt('/aws/iam/policies/details');
    const arn = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';
    const query = `arn=${encodeURIComponent(arn)}`;
    expect(titleOf(s5, query)).toBe('AWSLambdaBasicExecutionRole');
    expect(crumbsOf(s5, query)).toEqual([
      { text: 'Policies', href: '/aws/iam/policies' },
      { text: 'AWSLambdaBasicExecutionRole' },
    ]);
    expect(titleOf(s5, 'arn=arn%3Aaws%3Aiam%3A%3A000000000000%3Apolicy%2Fmine')).toBe('mine');
    expect(titleOf(s5)).toBe('Policy');
    expect(titleOf(s5, 'arn=')).toBe('Policy');
    expect(crumbsOf(s5)).toEqual([{ text: 'Policies', href: '/aws/iam/policies' }, { text: 'Policy' }]);
  });

  it('gives S4 and S6 the crumbs "Policies" and "Policies" > "Create policy"', () => {
    const s4 = screenAt('/aws/iam/policies');
    expect(titleOf(s4)).toBe('Policies');
    expect(crumbsOf(s4)).toEqual([{ text: 'Policies' }]);
    const s6 = screenAt('/aws/iam/policies/create');
    expect(titleOf(s6)).toBe('Create policy');
    expect(crumbsOf(s6)).toEqual([{ text: 'Policies', href: '/aws/iam/policies' }, { text: 'Create policy' }]);
  });
});
