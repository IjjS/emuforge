import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ValueText, type ValueKind } from './value-text';

/** The area's class for each kind of value. */
const VALUE_CLASS: Record<ValueKind, string> = {
  address: 'aws-area-value-address',
  name: 'aws-area-value-name',
  fixed: 'aws-area-value-fixed',
  text: 'aws-area-value-text',
};

const ARN = 'arn:aws:iam::000000000000:role/team/app-role';
const URL = 'https://127.0.0.1:39823/_aws/lambda-url/abc/?a=1&b=2';

/** The rendered value's text, with `|` where a `<wbr>` stands: the break opportunities the element adds. */
function withBreaks(root: Element): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node instanceof Element && node.tagName === 'WBR') {
      out += '|';
    } else {
      node.childNodes.forEach(walk);
    }
  };
  walk(root);
  return out;
}

/** `value` with `|` directly after each character of `after`, and nowhere else (none after the last character). */
function breaksAfter(value: string, after: string): string {
  return [...value].map((c, i) => (after.includes(c) && i < value.length - 1 ? `${c}|` : c)).join('');
}

function shown(kind: ValueKind, value: string | null | undefined, none?: string): HTMLElement {
  const { container } = render(
    <p data-testid="holder">
      <ValueText kind={kind} value={value} {...(none !== undefined && { none })} />
    </p>,
  );
  return container.querySelector('p') as HTMLElement;
}

/** The area's stylesheet as rules: each selector of a rule with the declarations it sets. */
function stylesheet(): Map<string, Map<string, string>> {
  const css = readFileSync(path.join(import.meta.dirname, 'value-text.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = new Map<string, Map<string, string>>();
  for (const [, selectors = '', body = ''] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map(
      body
        .split(';')
        .map((d) => d.split(':').map((part) => part.trim()))
        .filter(([property]) => property !== undefined && property !== '')
        .map(([property = '', value = '']) => [property, value]),
    );
    for (const selector of selectors.split(',').map((s) => s.trim())) {
      rules.set(selector, new Map([...(rules.get(selector) ?? []), ...declarations]));
    }
  }
  return rules;
}

/** Every stylesheet under `providers/aws/area/services/`, as its path relative to that folder. */
function serviceStylesheets(): string[] {
  const root = path.join(import.meta.dirname, '..', 'services');
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(css|scss)$/.test(file))
    .sort();
}

/** The rules of a stylesheet that declare `overflow-wrap` or `word-break`, each as its selectors and the declaration. */
function breakingRules(file: string): string[] {
  const css = readFileSync(path.join(import.meta.dirname, '..', 'services', file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const found: string[] = [];
  for (const [, selectors = '', body = ''] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const declaration of body.split(';')) {
      const property = declaration.split(':')[0]?.trim() ?? '';
      if (property === 'overflow-wrap' || property === 'word-break') {
        found.push(`${selectors.trim()} { ${declaration.trim()} }`);
      }
    }
  }
  return found;
}

/** What the stylesheet sets for elements of `className`. */
function rulesOf(className: string): Map<string, string> {
  return stylesheet().get(`.${className}`) ?? new Map<string, string>();
}

describe("ValueText, the area's one way of breaking a value", () => {
  it('an ARN shown as an address: its text is the ARN, with a break opportunity after each ":" and "/" only', () => {
    const holder = shown('address', ARN);

    expect(holder.textContent).toBe(ARN);
    expect(withBreaks(holder)).toBe(breaksAfter(ARN, ':/'));
    // Each part between two break opportunities is one box, which the stylesheet does not split while it fits.
    const parts = [...holder.querySelectorAll('.aws-area-value-part')].map((part) => part.textContent);
    expect(parts).toEqual(['arn:', 'aws:', 'iam:', ':', '000000000000:', 'role/', 'team/', 'app-role']);
  });

  it('a URL shown as an address: a break opportunity after each ":", "/", "?" and "&"; its text is the URL', () => {
    const holder = shown('address', URL);

    expect(holder.textContent).toBe(URL);
    expect(withBreaks(holder)).toBe(breaksAfter(URL, ':/?&'));
  });

  it.each([
    ['name', 'p467-structure-admin_role.x'],
    ['fixed', 'November 17, 2026, 14:30:05 (UTC+09:00)'],
    ['fixed', 'us-east-1'],
    ['text', 'kept for one year: archive-reports/2026, then removed'],
  ] as const)('a %s "%s": its text is the value, with no break opportunity added inside', (kind, value) => {
    const holder = shown(kind, value);

    expect(holder.textContent).toBe(value);
    expect(withBreaks(holder)).toBe(value);
    expect(holder.querySelector('wbr')).toBeNull();
  });

  it.each(['address', 'name', 'fixed', 'text'] as const)("a %s carries the area's class for its kind", (kind) => {
    const holder = shown(kind, 'arn:aws:s3:::bucket kept');
    const element = holder.firstElementChild as HTMLElement;

    expect(element).toHaveClass('aws-area-value', VALUE_CLASS[kind]);
    expect(new Set(Object.values(VALUE_CLASS)).size).toBe(Object.keys(VALUE_CLASS).length);
  });

  it('a name keeps its spaces and tabs in the name element', () => {
    const name = 'a  b\tc';
    const holder = shown('name', name);

    expect(holder.firstElementChild).toHaveClass(VALUE_CLASS.name);
    expect(holder.firstElementChild?.textContent).toBe(name);
    expect(rulesOf(VALUE_CLASS.name).get('white-space')).toBe('break-spaces');
  });

  it.each(['text', 'address', 'fixed'] as const)('a %s keeps its element and text', (kind) => {
    const value = 'a  b';
    const holder = shown(kind, value);

    expect(holder.firstElementChild).toHaveClass(VALUE_CLASS[kind]);
    expect(holder.firstElementChild?.textContent).toBe(value);
    expect(rulesOf(VALUE_CLASS[kind]).get('white-space')).toBeUndefined();
    expect(rulesOf('aws-area-value-part').get('white-space')).toBeUndefined();
  });

  it("the stylesheet: a fixed word never breaks inside a word; an address's part, a name and free text break inside a word longer than its line", () => {
    // Every kind undoes a `word-break` it may inherit (Cloudscape's inline copy control sets `break-all`).
    expect(rulesOf('aws-area-value').get('word-break')).toBe('normal');

    // A fixed word: each of its words is an element that never wraps, and the stylesheet breaks nothing of it.
    const fixed = shown('fixed', 'Enabled us-east-1');
    const words = [...fixed.querySelectorAll('.aws-area-value-whole')].map((word) => word.textContent);
    expect(words).toEqual(['Enabled', 'us-east-1']);
    expect(rulesOf('aws-area-value-whole').get('white-space')).toBe('nowrap');
    expect(rulesOf(VALUE_CLASS.fixed).get('overflow-wrap')).toBeUndefined();

    // An address's parts and a name are boxes no wider than their line that break anywhere inside when longer.
    for (const className of ['aws-area-value-part', VALUE_CLASS.name]) {
      expect(rulesOf(className).get('display')).toBe('inline-block');
      expect(rulesOf(className).get('max-inline-size')).toBe('100%');
      expect(rulesOf(className).get('overflow-wrap')).toBe('anywhere');
    }
    // Free text breaks at spaces, and inside a word only when the word is longer than its line.
    expect(rulesOf(VALUE_CLASS.text).get('overflow-wrap')).toBe('break-word');
  });

  it.each([undefined, null, ''])(
    'an empty value (%j): only what the caller gave for "no value" is rendered',
    (value) => {
      expect(shown('address', value, '-').innerHTML).toBe('-');
      expect(shown('name', value, '-').innerHTML).toBe('-');
      expect(shown('text', value).innerHTML).toBe('');
    },
  );

  it('every stylesheet under services/, read from disk: none declares `overflow-wrap` or `word-break`, but for the rule of `.aws-area-policy-text` (the preformatted trust policy text)', () => {
    const files = serviceStylesheets();
    // The three services' stylesheets are found: the walk reads the folder, not a list of names.
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.startsWith(`iam${path.sep}`))).toBe(true);

    const found = files.flatMap((file) => breakingRules(file).map((rule) => `${file}: ${rule}`));
    expect(found).toEqual([
      `${path.join('iam', 'components', 'create-role.css')}: .aws-area-policy-text { overflow-wrap: anywhere }`,
    ]);
  });
});
