import { describe, expect, it } from 'vitest';

import {
  architecturesText,
  codeSizeText,
  functionTabHref,
  lastModifiedText,
  memoryText,
  runtimeText,
  tabOf,
  timeoutText,
  typeText,
  valueText,
} from './format';

// How the Lambda screens write a function's values (issue 84, requirement R4.2).

describe('the runtime', () => {
  it.each([
    ['nodejs24.x', 'Node.js 24.x'],
    ['nodejs22.x', 'Node.js 22.x'],
    ['python3.14', 'Python 3.14'],
    ['python3.13', 'Python 3.13'],
    ['java21', 'Java 21'],
    ['java17.al2023', 'Java 17'],
    ['dotnet10', '.NET 10'],
    ['ruby3.4', 'Ruby 3.4'],
    ['provided.al2023', 'OS-only Runtime'],
  ])('writes %s as %s', (runtime, text) => {
    expect(runtimeText(runtime)).toBe(text);
  });

  it('writes a runtime the table does not hold as it came, and none as "-"', () => {
    expect(runtimeText('cobol99')).toBe('cobol99');
    expect(runtimeText('toString')).toBe('toString');
    expect(runtimeText(undefined)).toBe('-');
  });
});

describe('the type', () => {
  it('is "Durable" for a durable function and "Standard" otherwise', () => {
    expect(typeText(true)).toBe('Durable');
    expect(typeText(false)).toBe('Standard');
  });
});

describe('the other values', () => {
  it('writes an empty or missing description, and a missing package type, as "-"', () => {
    expect(valueText('')).toBe('-');
    expect(valueText(undefined)).toBe('-');
    expect(valueText('Zip')).toBe('Zip');
  });

  it('writes the architectures x86_64 and arm64 as "x86_64, arm64"', () => {
    expect(architecturesText(['x86_64', 'arm64'])).toBe('x86_64, arm64');
    expect(architecturesText([])).toBe('-');
    expect(architecturesText(undefined)).toBe('-');
  });
});

describe('the last modified time', () => {
  const instant = new Date('2026-11-17T02:22:16.474Z');

  it('writes the instant in Asia/Seoul as November 17, 2026, 11:22:16 (UTC+09:00)', () => {
    expect(lastModifiedText(instant, 'Asia/Seoul')).toBe('November 17, 2026, 11:22:16 (UTC+09:00)');
  });

  it('writes the instant in UTC as November 17, 2026, 02:22:16 (UTC+00:00)', () => {
    expect(lastModifiedText(instant, 'UTC')).toBe('November 17, 2026, 02:22:16 (UTC+00:00)');
  });

  it('writes a text that is not a time as it came, and none as "-"', () => {
    expect(lastModifiedText('yesterday-ish')).toBe('yesterday-ish');
    expect(lastModifiedText(undefined)).toBe('-');
  });
});

// The values of the tabs "Code" and "Configuration", and the tabs' addresses (issue 516, test criteria "Unit s1 —
// format.test.ts").

describe('the values of a function’s tabs', () => {
  it('writes code size 1234 as "1234 bytes", memory 256 as "256 MB", timeout 1 as "1 second" and 3 as "3 seconds"', () => {
    expect(codeSizeText(1234)).toBe('1234 bytes');
    expect(memoryText(256)).toBe('256 MB');
    expect(timeoutText(1)).toBe('1 second');
    expect(timeoutText(3)).toBe('3 seconds');
  });

  it('writes "-" for a value the answer lacks', () => {
    expect(codeSizeText(undefined)).toBe('-');
    expect(memoryText(undefined)).toBe('-');
    expect(timeoutText(undefined)).toBe('-');
  });
});

describe('the address of a function’s tab', () => {
  it('is the function’s path without a query for "Test", with ?tab=code for "Code", ?tab=configuration for "Configuration"', () => {
    expect(functionTabHref('orders', 'test')).toBe('/aws/lambda/functions/function/orders');
    expect(functionTabHref('orders', 'code')).toBe('/aws/lambda/functions/function/orders?tab=code');
    expect(functionTabHref('orders', 'versions')).toBe('/aws/lambda/functions/function/orders?tab=versions');
    expect(functionTabHref('orders', 'configuration')).toBe('/aws/lambda/functions/function/orders?tab=configuration');
  });

  it('encodes a name with characters that need encoding once', () => {
    expect(functionTabHref('a b%c', 'code')).toBe('/aws/lambda/functions/function/a%20b%25c?tab=code');
    expect(functionTabHref('a b%c', 'test')).toBe('/aws/lambda/functions/function/a%20b%25c');
  });

  it('is named by ?tab=: code and configuration their tabs, none or any other value "Test"', () => {
    expect(tabOf('code')).toBe('code');
    expect(tabOf('configuration')).toBe('configuration');
    expect(tabOf('versions')).toBe('versions');
    expect(tabOf(null)).toBe('test');
    expect(tabOf('')).toBe('test');
    expect(tabOf('nonsense')).toBe('test');
    expect(tabOf('Code')).toBe('test');
  });
});
