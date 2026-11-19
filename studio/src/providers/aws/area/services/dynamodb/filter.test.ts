import { describe, expect, it } from 'vitest';

import {
  checkConditions,
  COMPARISONS,
  filterMembers,
  NEW_CONDITION,
  typesOf,
  type Comparison,
  type Condition,
} from './filter';

// The filter's conditions, the types each comparison offers, the expression and its placeholders, and the checks
// "Run" makes (issue 512, test-criteria.md "Unit s1 — .../dynamodb/filter.test.ts").

function condition(name: string, extra: Partial<Condition> = {}): Condition {
  return { ...NEW_CONDITION, name, ...extra };
}

describe('the types each comparison offers', () => {
  it.each([
    ['=', ['S', 'N', 'B', 'BOOL', 'NULL']],
    ['<>', ['S', 'N', 'B', 'BOOL', 'NULL']],
    ['<', ['S', 'N', 'B']],
    ['<=', ['S', 'N', 'B']],
    ['>', ['S', 'N', 'B']],
    ['>=', ['S', 'N', 'B']],
    ['between', ['S', 'N', 'B']],
    ['begins_with', ['S', 'B']],
    ['contains', ['S', 'N', 'B']],
    ['not_contains', ['S', 'N', 'B']],
    ['exists', []],
    ['not_exists', []],
  ] as const)('%s → %j', (comparison, types) => {
    expect(typesOf(comparison)).toEqual(types);
  });

  it("the labels are the sort key condition's and the requirement's", () => {
    expect(COMPARISONS.map(({ label }) => label)).toEqual([
      'Equal to',
      'Not equal to',
      'Less than',
      'Less than or equal to',
      'Greater than',
      'Greater than or equal to',
      'Between',
      'Begins with',
      'Contains',
      'Does not contain',
      'Exists',
      'Does not exist',
    ]);
  });
});

describe('the expression', () => {
  it.each<[Comparison, string, Record<string, unknown>]>([
    ['=', '#f0 = :f0', { ':f0': { S: 'v' } }],
    ['<>', '#f0 <> :f0', { ':f0': { S: 'v' } }],
    ['<', '#f0 < :f0', { ':f0': { S: 'v' } }],
    ['<=', '#f0 <= :f0', { ':f0': { S: 'v' } }],
    ['>', '#f0 > :f0', { ':f0': { S: 'v' } }],
    ['>=', '#f0 >= :f0', { ':f0': { S: 'v' } }],
    ['between', '#f0 BETWEEN :f0 AND :f0u', { ':f0': { S: 'v' }, ':f0u': { S: 'w' } }],
    ['begins_with', 'begins_with(#f0, :f0)', { ':f0': { S: 'v' } }],
    ['contains', 'contains(#f0, :f0)', { ':f0': { S: 'v' } }],
    ['not_contains', 'NOT contains(#f0, :f0)', { ':f0': { S: 'v' } }],
    ['exists', 'attribute_exists(#f0)', {}],
    ['not_exists', 'attribute_not_exists(#f0)', {}],
  ])('%s → %s', (comparison, expression, values) => {
    expect(filterMembers([condition('a', { comparison, value: 'v', upper: 'w' })])).toEqual({
      expression,
      names: { '#f0': 'a' },
      values,
    });
  });

  it('three conditions: their parts joined with AND in order; one attribute in two conditions under two placeholders', () => {
    expect(
      filterMembers([
        condition('total', { comparison: '>=', type: 'N', value: '7' }),
        condition('total', { comparison: '<=', type: 'N', value: '25.5' }),
        condition('status', { comparison: 'exists' }),
      ]),
    ).toEqual({
      expression: '#f0 >= :f0 AND #f1 <= :f1 AND attribute_exists(#f2)',
      names: { '#f0': 'total', '#f1': 'total', '#f2': 'status' },
      values: { ':f0': { N: '7' }, ':f1': { N: '25.5' } },
    });
  });

  it('a value of each type', () => {
    const values = (extra: Partial<Condition>) => filterMembers([condition('a', extra)])?.values;
    expect(values({ type: 'S', value: 'open' })).toEqual({ ':f0': { S: 'open' } });
    expect(values({ type: 'S', value: '' })).toEqual({ ':f0': { S: '' } });
    expect(values({ type: 'N', value: '10.0' })).toEqual({ ':f0': { N: '10.0' } });
    expect(values({ type: 'N', value: 'abc' })).toEqual({ ':f0': { N: 'abc' } });
    expect(values({ type: 'N', value: '' })).toEqual({ ':f0': { N: '' } });
    expect(values({ type: 'B', value: 'AQI=' })).toEqual({ ':f0': { B: new Uint8Array([1, 2]) } });
    expect(values({ type: 'BOOL', bool: true })).toEqual({ ':f0': { BOOL: true } });
    expect(values({ type: 'BOOL', bool: false })).toEqual({ ':f0': { BOOL: false } });
    expect(values({ type: 'NULL' })).toEqual({ ':f0': { NULL: true } });
    expect(values({ comparison: 'between', type: 'B', value: 'AQI=', upper: 'AQM=' })).toEqual({
      ':f0': { B: new Uint8Array([1, 2]) },
      ':f0u': { B: new Uint8Array([1, 3]) },
    });
  });

  it('a reserved word, a period or a space in a name: in the names only, never in the expression', () => {
    const members = filterMembers([condition('name'), condition('a.b'), condition('two words')]);
    expect(members?.names).toEqual({ '#f0': 'name', '#f1': 'a.b', '#f2': 'two words' });
    expect(members?.expression).toBe('#f0 = :f0 AND #f1 = :f1 AND #f2 = :f2');
    for (const name of ['name', 'a.b', 'two words']) {
      expect(members?.expression).not.toContain(name);
    }
  });

  it('no condition: no expression, no names, no values', () => {
    expect(filterMembers([])).toBeUndefined();
  });
});

describe('the checks "Run" makes', () => {
  it('an empty attribute name → "Enter an attribute name." for that condition', () => {
    expect(checkConditions([condition('status'), condition('')])).toEqual([
      undefined,
      { name: 'Enter an attribute name.' },
    ]);
  });

  it('a Binary value or upper bound that is not base64 → "Enter the value in base64." for that field', () => {
    expect(checkConditions([condition('b', { type: 'B', value: 'not base64' })])).toEqual([
      { value: 'Enter the value in base64.' },
    ]);
    expect(checkConditions([condition('b', { comparison: 'between', type: 'B', value: 'AQI=', upper: '!!' })])).toEqual(
      [{ upper: 'Enter the value in base64.' }],
    );
  });

  it('a Number that is no number, an empty value, bounds in the wrong order → no message', () => {
    expect(
      checkConditions([
        condition('n', { type: 'N', value: 'abc' }),
        condition('s', { value: '' }),
        condition('n', { type: 'N', value: '' }),
        condition('n', { comparison: 'between', type: 'N', value: '10', upper: '2' }),
        condition('x', { comparison: 'exists', type: 'B', value: 'not base64' }),
      ]),
    ).toEqual([]);
  });
});
