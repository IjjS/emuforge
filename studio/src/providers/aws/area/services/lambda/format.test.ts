import { describe, expect, it } from 'vitest';

import { architecturesText, lastModifiedText, runtimeText, typeText, valueText } from './format';

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
