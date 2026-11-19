import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';

import type { AreaConnection } from '../../../components/emulator-line';
import type { LambdaFunction } from '../api';
import type { FunctionChange } from '../queries';
import { CodeTab } from './code-tab';

// The tab "Code" with its read-only content and its actions (issue 516, test criteria "Unit s1, then s3 —
// components/code-tab.test.tsx", and "Unit s3 — components/code-tab.test.tsx").

const CONNECTION: AreaConnection = { result: undefined, engineOrigin: undefined };

// The changes' hooks are stand-ins of this file that hold each change until the case answers it.
interface HeldChange {
  input: unknown;
  answer: (failure?: RequestFailure) => void;
}

const held = vi.hoisted(() => ({ changes: [] as unknown[] }));

function useStandInChange<Input>(): FunctionChange<Input> {
  const [isPending, setPending] = useState(false);
  return {
    isPending,
    error: undefined,
    reset: () => undefined,
    mutate: (input, callbacks) => {
      if (isPending) {
        return;
      }
      setPending(true);
      held.changes.push({
        input,
        answer: (failure?: RequestFailure) => {
          setPending(false);
          if (failure === undefined) {
            callbacks?.onSuccess?.();
          } else {
            callbacks?.onError?.(failure);
          }
        },
      });
    },
  };
}

vi.mock('../queries', () => ({
  useUpdateFunctionCode: () => useStandInChange(),
  useUpdateFunctionConfiguration: () => useStandInChange(),
}));

const changes = () => held.changes as HeldChange[];

beforeEach(() => {
  held.changes = [];
});

/** `content` inside an area root, as the page renders a tab, its flash dropped. */
function inArea(content: ReactNode): ReactNode {
  const root = { current: null as HTMLDivElement | null };
  const flash: PageFlash = { show: () => undefined, handOver: () => undefined };
  return (
    <AreaRootContext.Provider value={root}>
      <PageFlashContext.Provider value={flash}>
        <div
          ref={(element) => {
            root.current = element;
          }}
        >
          {content}
        </div>
      </PageFlashContext.Provider>
    </AreaRootContext.Provider>
  );
}

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

function renderTab(fn: LambdaFunction = ORDERS, ready = true) {
  const result = render(inArea(<CodeTab fn={fn} name={fn.name} connection={CONNECTION} ready={ready} />));
  return {
    ...result,
    reread: (next: LambdaFunction) => {
      result.rerender(inArea(<CodeTab fn={next} name={next.name} connection={CONNECTION} ready />));
    },
  };
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

describe('the actions of "Code"', () => {
  it('not ready: "Upload" and "Edit" are unavailable with "Wait until the function is ready."; ready: available', () => {
    const { reread } = renderTab(ORDERS, false);

    const edit = screen.getByRole('button', { name: 'Edit runtime settings' });
    const upload = screen.getByRole('button', { name: 'Upload' });
    expect(edit.getAttribute('aria-disabled')).toBe('true');
    expect(upload.getAttribute('aria-disabled')).toBe('true');
    fireEvent.focus(edit);
    expect(document.body.textContent).toContain('Wait until the function is ready.');
    fireEvent.click(edit);
    expect(screen.queryByRole('dialog')).toBeNull();

    reread(ORDERS);
    expect(screen.getByRole('button', { name: 'Edit runtime settings' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('"Edit" opens its dialog; after a save the section shows what the read holds, never the form’s values', async () => {
    const { reread } = renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Edit runtime settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit runtime settings' });
    const handler = createWrapper(dialog).findInput()?.findNativeInput().getElement() as HTMLInputElement;
    fireEvent.change(handler, { target: { value: 'typed.in_the_form' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    act(() => {
      changes()[0]?.answer();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    expect(pairs('Runtime settings')[1]).toEqual(['Handler', 'lambda_function.lambda_handler']);
    expect(document.body.textContent).not.toContain('typed.in_the_form');

    reread({ ...ORDERS, handler: 'lambda_function.other', runtime: 'python3.12' });
    expect(pairs('Runtime settings').slice(0, 2)).toEqual([
      ['Runtime', 'Python 3.12'],
      ['Handler', 'lambda_function.other'],
    ]);
  });
});
