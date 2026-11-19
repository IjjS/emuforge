import { readFileSync } from 'node:fs';
import path from 'node:path';

import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { InvokeAnswer } from '../api';
import type { Invocation } from '../queries';
import { TestTab } from './test-tab';

// The tab "Test": the event field, "Invoke" and "Result" (issue 516, test criteria "Unit s2 —
// components/test-tab.test.tsx"). The invoke is the page's; here a stand-in the test sets.

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function invocation(over: Partial<Invocation> = {}): Invocation {
  return { mutate: vi.fn(), isPending: false, data: undefined, error: undefined, answers: 0, ...over };
}

/** The tab with the page's event text kept as the page keeps it. */
function Harness({ invoke, initial = '{}' }: { invoke: Invocation; initial?: string }) {
  const [eventText, setEventText] = useState(initial);
  return <TestTab functionName="orders" eventText={eventText} onEventTextChange={setEventText} invoke={invoke} />;
}

function field() {
  const wrapper = createWrapper(document.body).findTextarea();
  expect(wrapper).not.toBeNull();
  return wrapper as NonNullable<typeof wrapper>;
}

function invokeButton() {
  const button = createWrapper(document.body)
    .findAllButtons()
    .find((found) => /^Invok/.test(norm(found.getElement().textContent)));
  expect(button).toBeDefined();
  return button as NonNullable<typeof button>;
}

function result(): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: 'Result' });
  const container = createWrapper(document.body)
    .findAllContainers()
    .find((found) => found.getElement().contains(heading));
  expect(container).toBeDefined();
  return (container as NonNullable<typeof container>).getElement();
}

function announced(): string[] {
  const region = document.querySelector('.aws-area-announcer');
  return [...(region?.querySelectorAll('span') ?? [])].map((span) => span.textContent ?? '');
}

// jsdom lays nothing out and has no `scrollIntoView`; the tab calls it when a new answer arrives.
Element.prototype.scrollIntoView = () => undefined;

const ANSWER: InvokeAnswer = { payload: '{"got": {}, "version": "v1"}', log: 'echo-line a\nREPORT RequestId: 1' };

describe('the tab "Test"', () => {
  it('opens with "{}" in "Event JSON" and "Not invoked yet"', () => {
    render(<Harness invoke={invocation()} />);
    expect(field().getTextareaValue()).toBe('{}');
    expect(norm(createWrapper(document.body).findFormField()?.findLabel()?.getElement().textContent)).toBe(
      'Event JSON',
    );
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
      expect(norm(createWrapper(document.body).findFormField()?.findError()?.getElement().textContent)).toBe(
        'Enter the event as one JSON value.',
      );
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
    expect(invoke.mutate).toHaveBeenCalledWith(text);
    expect(createWrapper(document.body).findFormField()?.findError()).toBeNull();
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

  it('shows "Succeeded" with the response and the log tail, announced once per invoke', () => {
    const { rerender, unmount } = render(<Harness invoke={invocation()} />);
    expect(announced()).toEqual([]);
    rerender(<Harness invoke={invocation({ data: ANSWER, answers: 1 })} />);
    const text = norm(result().textContent);
    expect(text).toContain('Succeeded');
    expect(text).toContain('Response');
    expect(text).toContain('Log tail');
    expect(text).toContain("The end of this invocation's log, as the emulator returned it.");
    expect(result().textContent).toContain('echo-line a\nREPORT RequestId: 1');
    expect(announced()).toEqual(['Succeeded']);
    // Pressed again: in flight, then the same words again
    rerender(<Harness invoke={invocation({ data: ANSWER, answers: 1, isPending: true })} />);
    expect(announced()).toEqual(['Succeeded']);
    rerender(<Harness invoke={invocation({ data: ANSWER, answers: 2 })} />);
    expect(announced()).toEqual(['Succeeded']);
    expect(document.querySelector('.aws-area-announcer span')?.textContent).toBe('Succeeded');
    // The tab opened again on the same outcome says nothing
    unmount();
    render(<Harness invoke={invocation({ data: ANSWER, answers: 2 })} />);
    expect(announced()).toEqual([]);
  });

  it('counts each new answer as one announcement, even with the same words', () => {
    const { rerender } = render(<Harness invoke={invocation({ data: ANSWER, answers: 1 })} />);
    rerender(<Harness invoke={invocation({ data: ANSWER, answers: 2 })} />);
    const first = document.querySelector('.aws-area-announcer span');
    rerender(<Harness invoke={invocation({ data: ANSWER, answers: 3 })} />);
    const second = document.querySelector('.aws-area-announcer span');
    expect(second?.textContent).toBe('Succeeded');
    expect(second).not.toBe(first);
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
    expect(announced()).toEqual(['The function returned an error']);
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
    expect(announced()).toEqual(['The invocation was refused']);
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
    expect(announced()).toEqual(['The invocation got no answer']);
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
    expect(invoke.mutate).toHaveBeenCalledWith('{}');
  });

  it('checks the text on Ctrl+Enter as on "Invoke"', () => {
    const invoke = invocation();
    render(<Harness invoke={invoke} initial={'{"a":'} />);
    fireEvent.keyDown(field().findNativeTextarea().getElement(), { key: 'Enter', ctrlKey: true });
    expect(norm(createWrapper(document.body).findFormField()?.findError()?.getElement().textContent)).toBe(
      'Enter the event as one JSON value.',
    );
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

  it('brings "Result" into view, nearest, when a new answer arrives, and leaves focus where it was', () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const { rerender, unmount } = render(<Harness invoke={invocation()} />);
      expect(scroll).not.toHaveBeenCalled();
      const native = field().findNativeTextarea().getElement();
      native.focus();
      rerender(<Harness invoke={invocation({ data: ANSWER, answers: 1 })} />);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
      expect((scroll.mock.contexts[0] as Element).contains(result())).toBe(true);
      expect(document.activeElement).toBe(native);
      rerender(<Harness invoke={invocation({ data: ANSWER, answers: 1, isPending: true })} />);
      expect(scroll).toHaveBeenCalledTimes(1);
      rerender(
        <Harness invoke={invocation({ error: { kind: 'engine-did-not-answer', operation: 'Invoke' }, answers: 2 })} />,
      );
      expect(scroll).toHaveBeenCalledTimes(2);
      unmount();
      render(<Harness invoke={invocation({ data: ANSWER, answers: 2 })} />);
      expect(scroll).toHaveBeenCalledTimes(2);
    } finally {
      Element.prototype.scrollIntoView = original;
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
