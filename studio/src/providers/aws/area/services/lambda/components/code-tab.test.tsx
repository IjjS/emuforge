import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AreaConnection } from '../../../components/emulator-line';
import type { LambdaFunction } from '../api';
import { CodeTab } from './code-tab';

// The tab "Code" as `s1` leaves it: its read-only content (issue 516, test criteria "Unit s1, then s3 —
// components/code-tab.test.tsx").

const CONNECTION: AreaConnection = { result: undefined, engineOrigin: undefined };

const ORDERS: LambdaFunction = {
  name: 'orders',
  durable: false,
  packageType: 'Zip',
  runtime: 'python3.13',
  handler: 'lambda_function.lambda_handler',
  architectures: ['arm64'],
  codeSize: 1234,
  codeSha256: 'q1w2e3r4t5y6u7i8o9p0+/=',
  environment: [{ key: 'SECRET', value: 'orders-secret-value' }],
  url: { kind: 'none' },
};

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function section(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: title });
  const container = createWrapper(document.body)
    .findAllContainers()
    .find((found) => found.getElement().contains(heading));
  expect(container).toBeDefined();
  return (container as NonNullable<typeof container>).getElement();
}

function pairs(title: string): [string, string][] {
  return (createWrapper(section(title)).findKeyValuePairs()?.findItems() ?? []).map((item) => [
    norm(item.findLabel()?.getElement().textContent),
    norm(item.findValue()?.getElement().textContent),
  ]);
}

/** The kinds of the area's value elements inside the value of `label` in `title`. */
function kinds(title: string, label: string): string[] {
  const item = (createWrapper(section(title)).findKeyValuePairs()?.findItems() ?? []).find(
    (found) => norm(found.findLabel()?.getElement().textContent) === label,
  );
  return [...(item?.findValue()?.getElement().querySelectorAll('.aws-area-value') ?? [])].map(
    (element) =>
      [...element.classList].find((name) => name.startsWith('aws-area-value-'))?.slice('aws-area-value-'.length) ?? '',
  );
}

function renderTab(fn: LambdaFunction = ORDERS) {
  return render(<CodeTab fn={fn} name={fn.name} connection={CONNECTION} ready />);
}

describe('the tab "Code"', () => {
  it('"Package" with package type, code size and SHA-256, then "Runtime settings" with runtime, handler and architecture', () => {
    renderTab();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => norm(heading.textContent));
    expect(headings).toEqual(['Package', 'Runtime settings']);
    expect(pairs('Package')).toEqual([
      ['Package type', 'Zip'],
      ['Code size', '1234 bytes'],
      ['SHA-256', 'q1w2e3r4t5y6u7i8o9p0+/='],
    ]);
    expect(pairs('Runtime settings')).toEqual([
      ['Runtime', 'Python 3.13'],
      ['Handler', 'lambda_function.lambda_handler'],
      ['Architecture', 'arm64'],
    ]);
  });

  it('each value as the kind it is: the SHA-256 and the handler names, the others fixed words', () => {
    renderTab();

    expect(kinds('Package', 'Package type')).toEqual(['fixed']);
    expect(kinds('Package', 'Code size')).toEqual(['fixed']);
    expect(kinds('Package', 'SHA-256')).toEqual(['name']);
    expect(kinds('Runtime settings', 'Runtime')).toEqual(['fixed']);
    expect(kinds('Runtime settings', 'Handler')).toEqual(['name']);
    expect(kinds('Runtime settings', 'Architecture')).toEqual(['fixed']);
  });

  it('"-" for a value the read lacks; a runtime outside the console’s names as it came', () => {
    const bare: LambdaFunction = {
      name: 'bare',
      durable: false,
      runtime: 'mystery1.0',
      environment: [],
      url: { kind: 'none' },
    };
    renderTab(bare);

    expect(pairs('Package')).toEqual([
      ['Package type', '-'],
      ['Code size', '-'],
      ['SHA-256', '-'],
    ]);
    expect(pairs('Runtime settings')).toEqual([
      ['Runtime', 'mystery1.0'],
      ['Handler', '-'],
      ['Architecture', '-'],
    ]);
  });

  it('holds neither an environment variable nor the code itself', () => {
    renderTab();

    expect(document.body.textContent).not.toContain('orders-secret-value');
    expect(document.body.textContent).not.toContain('SECRET');
    expect(screen.queryByRole('heading', { name: 'Code source' })).toBeNull();
  });
});
