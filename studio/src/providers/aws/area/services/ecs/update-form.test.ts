import { describe, expect, it } from 'vitest';

import {
  COUNT_MESSAGE,
  keepLabel,
  updateFormMessages,
  updateFormStart,
  updateRequestOf,
  type UpdateFormState,
} from './update-form';

const SERVICE = { desired: 2, definition: { family: 'web', revision: 3 } };
const REVISION = { value: 'web:5', family: 'web', revision: 5 };

describe('the form of "Update service"', () => {
  it('the form of a service → the count preset to its desired count, "Keep {family}:{revision}" chosen, the box clear', () => {
    expect(updateFormStart(SERVICE)).toEqual({ count: '2', revision: undefined, force: false });
    expect(keepLabel(SERVICE)).toBe('Keep web:3');
  });

  it('count empty, -1, 1.5 → "Enter a whole number, 0 or more."; 0 accepted', () => {
    const form = (count: string): UpdateFormState => ({ count, revision: undefined, force: false });
    for (const count of ['', '-1', '1.5']) {
      expect(updateFormMessages(form(count))).toEqual({ count: COUNT_MESSAGE });
      expect(updateRequestOf(form(count))).toBeUndefined();
    }
    expect(COUNT_MESSAGE).toBe('Enter a whole number, 0 or more.');
    expect(updateFormMessages(form('0'))).toEqual({});
    expect(updateRequestOf(form('0'))).toEqual({ desiredCount: 0 });
  });

  it('the request → desiredCount always; taskDefinition only for a chosen revision; forceNewDeployment only when checked', () => {
    expect(updateRequestOf({ count: '3', revision: undefined, force: false })).toEqual({ desiredCount: 3 });
    expect(updateRequestOf({ count: '3', revision: REVISION, force: false })).toEqual({
      desiredCount: 3,
      taskDefinition: 'web:5',
    });
    expect(updateRequestOf({ count: '3', revision: undefined, force: true })).toEqual({
      desiredCount: 3,
      forceNewDeployment: true,
    });
  });
});
