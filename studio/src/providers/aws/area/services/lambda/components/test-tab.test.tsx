import { readFileSync } from 'node:fs';
import path from 'node:path';

import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { InvokeAnswer } from '../api';
import type { Invocation } from '../queries';
import type { FunctionAlias, FunctionVersion, ReleaseFailure } from '../version-api';
import type { ReleaseReading } from '../version-queries';
import { TestTab } from './test-tab';

// The tab "Test": the event field, "Invoke" and "Result" (issue 516, test criteria "Unit s2 —
// components/test-tab.test.tsx"). The invoke is the page's; here a stand-in the test sets.

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function invocation(over: Partial<Invocation> = {}): Invocation {
  return {
    mutate: vi.fn(),
    isPending: false,
    data: undefined,
    error: undefined,
    answers: 0,
    qualifier: undefined,
    isUnsupported: () => false,
    ...over,
  };
}

const versions = reading<FunctionVersion>([{ version: '$LATEST' }, { version: '2' }]);
const aliases = reading<FunctionAlias>([{ name: 'live', version: '2' }]);

function reading<T>(items: T[] | undefined, failure?: ReleaseFailure): ReleaseReading<T> {
  return { items, failure, loading: false, refresh: vi.fn() };
}

function Harness({
  invoke,
  initial = '{}',
  versionReading = versions,
  aliasReading = aliases,
  targetUnavailable = false,
}: {
  invoke: Invocation;
  initial?: string;
  versionReading?: ReleaseReading<FunctionVersion>;
  aliasReading?: ReleaseReading<FunctionAlias>;
  targetUnavailable?: boolean;
}) {
  const [eventText, setEventText] = useState(initial);
  const [qualifier, setQualifier] = useState<string>();
  return (
    <MemoryRouter>
      <TestTab
        functionName="orders"
        eventText={eventText}
        onEventTextChange={setEventText}
        invoke={invoke}
        connection={{
          engineOrigin: 'http://127.0.0.1:8308',
          result: { kind: 'connected', checkedAt: 0, emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' } },
        }}
        versions={versionReading}
        aliases={aliasReading}
        qualifier={qualifier}
        targetUnavailable={targetUnavailable && qualifier === 'live'}
        onTargetChange={setQualifier}
      />
    </MemoryRouter>
  );
}

function targetSelect() {
  const select = createWrapper(document.body).findSelect();
  if (select === null) {
    throw new Error('Expected the Invoke target selector');
  }
  return select;
}

function chooseTarget(value: string) {
  const select = targetSelect();
  select.openDropdown();
  select.selectOptionByValue(value);
}

function eventField() {
  return createWrapper(document.body)
    .findAllFormFields()
    .find((form) => form.findControl()?.findTextarea() != null);
}

function field() {
  const wrapper = createWrapper(document.body).findTextarea();
  expect(wrapper).not.toBeNull();
  return wrapper as NonNullable<typeof wrapper>;
}

function eventPanel() {
  const panel = createWrapper(document.body)
    .findAllContainers()
    .find((container) => container.findContent().findTextarea() !== null);
  if (!panel) {
    throw new Error('Expected the Test event panel');
  }
  return panel;
}

function invokeButton() {
  const header = eventPanel().findHeader()?.findHeader();
  const button = header?.findActions()?.findButton();
  if (!button) {
    throw new Error('Expected the Test event panel action');
  }
  expect(header?.findHeadingText().getElement()).toHaveTextContent('Event');
  expect(button.getElement()).toHaveTextContent(/^Invok(e|ing)$/);
  return button;
}

function result(): HTMLElement {
  const panel = createWrapper(document.body).findAllContainers()[1];
  expect(panel?.findHeader()?.findHeader()?.findHeadingText().getElement()).toHaveTextContent('Result');
  if (!panel) {
    throw new Error('Expected the invocation result panel');
  }
  return panel.getElement();
}

const ANSWER: InvokeAnswer = { payload: '{"got": {}, "version": "v1"}', log: 'echo-line a\nREPORT RequestId: 1' };

describe('the tab "Test"', () => {
  it('opens with "{}" in "Event JSON" and "Not invoked yet"', () => {
    render(<Harness invoke={invocation()} />);
    expect(field().getTextareaValue()).toBe('{}');
    expect(norm(eventField()?.findLabel()?.getElement().textContent)).toBe('Event JSON');
    expect(norm(result().textContent)).toContain('Not invoked yet');
    expect(norm(result().textContent)).toContain('Invoke the function to see what it returns and the end of its log.');
    expect(norm(invokeButton().getElement().textContent)).toBe('Invoke');
  });

  it.each(['', '   \n\t', '{"a":', '{} {}'])(
    'refuses %j as not one JSON value, focuses the field, sends nothing',
    (text) => {
      const invoke = invocation();
      render(<Harness invoke={invoke} initial={text} />);
      invokeButton().click();
      expect(norm(eventField()?.findError()?.getElement().textContent)).toBe('Enter the event as one JSON value.');
      expect(document.activeElement).toBe(field().findNativeTextarea().getElement());
      expect(invoke.mutate).not.toHaveBeenCalled();
    },
  );

  it.each(['null', '3', '"x"', '[1]', '{}', ' {\n  "b" : 2,  "a": 1 }\n'])('sends %j as typed', (text) => {
    const invoke = invocation();
    render(<Harness invoke={invoke} initial="nope" />);
    field().setTextareaValue(text);
    invokeButton().click();
    expect(invoke.mutate).toHaveBeenCalledTimes(1);
    expect(invoke.mutate).toHaveBeenCalledWith(text, undefined);
    expect(eventField()?.findError()).toBeNull();
  });

  it('reads "Invoking" while an invoke is in flight, sends nothing on a second press and keeps the earlier result', () => {
    const invoke = invocation({ isPending: true, data: ANSWER, answers: 1 });
    render(<Harness invoke={invoke} />);
    expect(norm(invokeButton().getElement().textContent)).toBe('Invoking');
    fireEvent.click(invokeButton().getElement());
    expect(invoke.mutate).not.toHaveBeenCalled();
    expect(norm(result().textContent)).toContain('Succeeded');
    expect(result().textContent).toContain('{"got": {}, "version": "v1"}');
  });

  it('shows "Succeeded" with the response and the log tail', () => {
    render(<Harness invoke={invocation({ data: ANSWER, answers: 1 })} />);
    const text = norm(result().textContent);
    expect(text).toContain('Succeeded');
    expect(text).toContain('Response');
    expect(text).toContain('Log tail');
    expect(text).toContain("The end of this invocation's log, as the emulator returned it.");
    expect(result().textContent).toContain('echo-line a\nREPORT RequestId: 1');
  });

  it('shows "The function returned an error" with its value, the response and the log tail', () => {
    const { rerender } = render(<Harness invoke={invocation()} />);
    rerender(
      <Harness
        invoke={invocation({
          data: { payload: '{"errorMessage": "boom-p"}', log: 'Traceback\nboom-p', functionError: 'Unhandled' },
          answers: 1,
        })}
      />,
    );
    const text = norm(result().textContent);
    expect(text).toContain('The function returned an error: Unhandled');
    expect(text).toContain('Response');
    expect(text).toContain('Log tail');
    expect(text).toContain('boom-p');
  });

  const refusals: [string, RequestFailure, string][] = [
    [
      'a code and message',
      { kind: 'other', operation: 'Invoke', code: 'InvalidRuntimeException', message: 'The runtime java21 <b>x</b>' },
      'InvalidRuntimeException: The runtime java21 <b>x</b>',
    ],
    ['a bare status', { kind: 'other', operation: 'Invoke', code: 'HTTP 413' }, 'HTTP 413'],
    ['not implemented', { kind: 'not-implemented', operation: 'Invoke' }, '501 Not Implemented for Invoke'],
  ];

  it.each(refusals)('shows a refusal with %s as it came, and no "Response" or "Log tail"', (_, error, shown) => {
    const { rerender } = render(<Harness invoke={invocation()} />);
    rerender(<Harness invoke={invocation({ error, answers: 1 })} />);
    const text = norm(result().textContent);
    expect(text).toContain('The invocation was refused');
    expect(text).toContain(shown);
    expect(text).not.toContain('Response');
    expect(text).not.toContain('Log tail');
    expect(result().querySelector('b')).toBeNull();
  });

  const silences: [string, RequestFailure, string[]][] = [
    ['the engine', { kind: 'engine-did-not-answer', operation: 'Invoke' }, ['The EmuForge engine did not answer.']],
    [
      'the emulator',
      { kind: 'emulator-did-not-answer', operation: 'Invoke', message: 'No emulator is connected.' },
      ['The emulator did not answer.', 'No emulator is connected.'],
    ],
  ];

  it.each(silences)('shows "got no answer" naming %s, and no "Response" or "Log tail"', (_, error, shown) => {
    const { rerender } = render(<Harness invoke={invocation()} />);
    rerender(<Harness invoke={invocation({ error, answers: 1 })} />);
    const text = norm(result().textContent);
    expect(text).toContain('The invocation got no answer');
    for (const piece of shown) {
      expect(text).toContain(piece);
    }
    expect(text).not.toContain('Response');
    expect(text).not.toContain('Log tail');
  });

  it('shows "-" for an empty response and no log', () => {
    render(<Harness invoke={invocation({ data: { payload: '', log: '' }, answers: 1 })} />);
    const blocks = [...result().querySelectorAll('.aws-lambda-output-text')].map((block) => block.textContent);
    expect(blocks).toEqual(['-', '-']);
  });

  it('shows a response and a log holding markup and an address as text only, line breaks and tabs kept', () => {
    const payload = '<script>alert(1)</script>\n\t<a href="https://example.com">x</a> https://example.com/a';
    const log = 'line 1\n\tline 2 <img src=x onerror=alert(1)> https://example.com/b';
    render(<Harness invoke={invocation({ data: { payload, log }, answers: 1 })} />);
    const blocks = [...result().querySelectorAll('.aws-lambda-output-text')];
    expect(blocks.map((block) => block.textContent)).toEqual([payload, log]);
    for (const block of blocks) {
      expect(block.querySelector('script, a, img')).toBeNull();
    }
    expect(result().querySelector('script, a, img')).toBeNull();
  });
});

describe('the tab "Test" after the critique (final r1)', () => {
  it('says Ctrl+Enter and Cmd+Enter in the Event header, and invokes on either in the field, not on Enter alone', () => {
    const invoke = invocation();
    render(<Harness invoke={invoke} />);
    expect(
      norm(
        screen.getByRole('heading', { level: 2, name: 'Event' }).closest('[class*="header"]')?.parentElement
          ?.textContent,
      ),
    ).toContain('The JSON the function receives as its event. Ctrl+Enter or Cmd+Enter in the field invokes.');
    const native = field().findNativeTextarea().getElement();
    fireEvent.keyDown(native, { key: 'Enter' });
    expect(invoke.mutate).not.toHaveBeenCalled();
    fireEvent.keyDown(native, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(native, { key: 'Enter', metaKey: true });
    expect(invoke.mutate).toHaveBeenCalledTimes(2);
    expect(invoke.mutate).toHaveBeenCalledWith('{}', undefined);
  });

  it('checks the text on Ctrl+Enter as on "Invoke"', () => {
    const invoke = invocation();
    render(<Harness invoke={invoke} initial={'{"a":'} />);
    fireEvent.keyDown(field().findNativeTextarea().getElement(), { key: 'Enter', ctrlKey: true });
    expect(norm(eventField()?.findError()?.getElement().textContent)).toBe('Enter the event as one JSON value.');
    expect(invoke.mutate).not.toHaveBeenCalled();
  });

  it('puts "Event" and "Result" in two columns of one grid, 12 wide at the default breakpoint (jsdom has no width)', () => {
    render(<Harness invoke={invocation()} />);
    const event = screen.getByRole('heading', { level: 2, name: 'Event' }).closest('[class*="grid-column"]');
    const resultColumn = result().closest('[class*="grid-column"]');
    expect(event).not.toBeNull();
    expect(resultColumn).not.toBeNull();
    expect(event).not.toBe(resultColumn);
    expect(event?.parentElement).toBe(resultColumn?.parentElement);
    for (const column of [event, resultColumn]) {
      const names = [...(column?.classList ?? [])].join(' ');
      expect(names).toMatch(/colspan-12/);
    }
  });
});

describe('components/output-text.css', () => {
  it('declares white-space: pre-wrap and neither overflow-wrap nor word-break', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'output-text.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(css).toMatch(/white-space:\s*pre-wrap/);
    expect(css).not.toMatch(/overflow-wrap/);
    expect(css).not.toMatch(/word-break/);
  });
});

describe('invoke targets', () => {
  it('defaults to $LATEST and offers published versions and aliases', () => {
    const invoke = invocation();
    render(<Harness invoke={invoke} />);
    expect(targetSelect().findTrigger().getElement()).toHaveTextContent('$LATEST');
    invokeButton().click();
    chooseTarget('2');
    invokeButton().click();
    chooseTarget('live');
    invokeButton().click();
    expect(invoke.mutate).toHaveBeenNthCalledWith(1, '{}', undefined);
    expect(invoke.mutate).toHaveBeenNthCalledWith(2, '{}', '2');
    expect(invoke.mutate).toHaveBeenNthCalledWith(3, '{}', 'live');
  });

  it.each([
    ['ListVersionsByFunction', 'other', 'live', '2'],
    ['ListAliases', 'other', '2', 'live'],
    ['ListVersionsByFunction', 'not-implemented', 'live', '2'],
    ['ListAliases', 'not-implemented', '2', 'live'],
  ] as const)('keeps the other targets usable after %s returns %s', (operation, kind, available, missing) => {
    const invoke = invocation();
    const failure: ReleaseFailure =
      kind === 'other' ? { kind, operation, code: 'ResourceNotFoundException' } : { kind, operation };
    render(
      <Harness
        invoke={invoke}
        versionReading={operation === 'ListVersionsByFunction' ? reading(undefined, failure) : versions}
        aliasReading={operation === 'ListAliases' ? reading(undefined, failure) : aliases}
      />,
    );
    const content = eventPanel().findContent().getElement();
    expect(content).toHaveTextContent(operation);
    expect(content).toHaveTextContent(
      kind === 'other' ? 'ResourceNotFoundException' : 'Not implemented by the emulator',
    );
    invokeButton().click();
    const select = targetSelect();
    select.openDropdown();
    expect(select.findDropdown().findOptionByValue(missing)).toBeNull();
    select.selectOptionByValue(available);
    invokeButton().click();
    expect(invoke.mutate).toHaveBeenNthCalledWith(1, '{}', undefined);
    expect(invoke.mutate).toHaveBeenNthCalledWith(2, '{}', available);
  });

  it('shows a qualified Invoke refusal for 501 and prevents button and shortcut resubmission', () => {
    const initial = invocation();
    const { rerender } = render(<Harness invoke={initial} />);
    chooseTarget('live');
    invokeButton().click();
    expect(initial.mutate).toHaveBeenCalledWith('{}', 'live');

    const invoke = invocation({
      error: { kind: 'not-implemented', operation: 'Invoke' },
      qualifier: 'live',
      answers: 1,
      isUnsupported: (qualifier) => qualifier !== undefined,
    });
    rerender(<Harness invoke={invoke} />);
    expect(result()).toHaveTextContent('Submitted target live');
    expect(result()).toHaveTextContent('Not implemented by the emulator');
    expect(result()).toHaveTextContent('501 Not Implemented for Invoke');
    const button = invokeButton().getElement();
    expect(button).toBeVisible();
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.keyDown(field().findNativeTextarea().getElement(), { key: 'Enter', ctrlKey: true });
    expect(invoke.mutate).not.toHaveBeenCalled();

    chooseTarget('$LATEST');
    invokeButton().click();
    expect(invoke.mutate).toHaveBeenCalledWith('{}', undefined);
  });

  it('requires another choice after a refresh drops the selected alias', () => {
    const invoke = invocation();
    const { rerender } = render(<Harness invoke={invoke} />);
    chooseTarget('live');
    rerender(<Harness invoke={invoke} aliasReading={reading([])} targetUnavailable />);
    const targetField = createWrapper(document.body)
      .findAllFormFields()
      .find((form) => form.findControl()?.findSelect() != null);
    expect(targetField?.findLabel()?.getElement()).toHaveTextContent('Invoke target');
    expect(targetField?.findError()?.getElement()).toHaveTextContent('live is unavailable. Choose another target.');
    const button = invokeButton().getElement();
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.keyDown(field().findNativeTextarea().getElement(), { key: 'Enter', metaKey: true });
    expect(invoke.mutate).not.toHaveBeenCalled();

    chooseTarget('2');
    invokeButton().click();
    expect(invoke.mutate).toHaveBeenCalledWith('{}', '2');
  });

  it('keeps a qualified function error, response and log together with the submitted target', () => {
    render(
      <Harness
        invoke={invocation({
          data: { payload: '{"errorMessage":"release failed"}', log: 'release log', functionError: 'Unhandled' },
          qualifier: 'live',
          answers: 1,
        })}
      />,
    );
    expect(result()).toHaveTextContent('Submitted target live');
    expect(result()).toHaveTextContent('The function returned an error');
    expect(result()).toHaveTextContent('Unhandled');
    expect(result()).toHaveTextContent('{"errorMessage":"release failed"}');
    expect(result()).toHaveTextContent('release log');
  });
});
