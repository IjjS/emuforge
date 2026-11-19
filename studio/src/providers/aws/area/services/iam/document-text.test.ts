import { describe, expect, it } from 'vitest';

import { decodeDocument, indentJson, isOneJsonValue, POLICY_SKELETON } from './document-text';

// Test criteria, "Unit s1 — providers/aws/area/services/iam/document-text.test.ts" (issue 535).

describe('decodeDocument', () => {
  it('decodes a percent-encoded document once, keeps a text that cannot be decoded, and gives empty for none', () => {
    const text = '{\n  "Version":  "2012-10-17"\n}';
    expect(decodeDocument(encodeURIComponent(text))).toBe(text);
    // Encoded twice: decoded once only.
    expect(decodeDocument(encodeURIComponent(encodeURIComponent('a b')))).toBe('a%20b');
    expect(decodeDocument('{"a": "100%"}')).toBe('{"a": "100%"}');
    expect(decodeDocument(undefined)).toBe('');
  });
});

describe('isOneJsonValue', () => {
  it('accepts one JSON value', () => {
    for (const text of ['{"a": 1}', '[1, 2]', '"text"', '42', '  {"a": 1}\n']) {
      expect(isOneJsonValue(text), text).toBe(true);
    }
  });

  it('refuses empty, white space, a text cut short and two values', () => {
    for (const text of ['', '   \n\t', '{"a": ', '{"a": 1} {"b": 2}', '1 2']) {
      expect(isOneJsonValue(text), text).toBe(false);
    }
  });
});

describe('indentJson', () => {
  it('indents a compact JSON text by two spaces, equal as JSON', () => {
    const compact = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"}}]}';
    const indented = indentJson(compact);
    expect(indented).toBe(
      [
        '{',
        '  "Version": "2012-10-17",',
        '  "Statement": [',
        '    {',
        '      "Effect": "Allow",',
        '      "Principal": {',
        '        "Service": "lambda.amazonaws.com"',
        '      }',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    );
    expect(JSON.parse(indented)).toEqual(JSON.parse(compact));
  });

  it('gives a text that is not JSON as it came', () => {
    expect(indentJson('not { json')).toBe('not { json');
    expect(indentJson('')).toBe('');
  });
});

describe('POLICY_SKELETON', () => {
  it('is JSON indented by two spaces, version 2012-10-17, one statement allowing no action yet on *', () => {
    const parsed = JSON.parse(POLICY_SKELETON) as unknown;
    expect(parsed).toEqual({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: [], Resource: '*' }],
    });
    expect(POLICY_SKELETON).toBe(JSON.stringify(parsed, null, 2));
    expect(POLICY_SKELETON.split('\n')[1]).toBe('  "Version": "2012-10-17",');
  });
});
