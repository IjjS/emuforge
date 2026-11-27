import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, render, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { expect, it, vi } from 'vitest';

import { AreaFlash, FlashAnnouncer } from './area-flash';
import { HandOverNoteContext, useHandOverNote, type FlashResult } from './page-flash';
import { useAreaFlash, type AreaFlashState } from './use-area-flash';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', () => ({ useNavigate: () => navigate }));

const from = '/aws/from';
const to = '/aws/to';
const note = { sample: 'received' };
const warning: FlashResult = [{ type: 'warning', content: 'Operation unavailable' }];

function mount(strict = false) {
  let flash: AreaFlashState | undefined;
  let mounted: string | null | boolean = null;
  function Page({ snapshot }: { snapshot: boolean }) {
    const current = useHandOverNote();
    const [initial] = useState(current);
    const received = snapshot ? initial : current;
    mounted = received?.sample ?? null;
    return null;
  }
  function Frame({
    path,
    visit,
    generation,
    snapshot,
  }: {
    path: string;
    visit: number;
    generation: number;
    snapshot: boolean;
  }) {
    const state = useAreaFlash(path, visit, true, generation);
    flash = state;
    return (
      <HandOverNoteContext value={state.note}>
        <FlashAnnouncer announcement={state.announcement} />
        {state.shown && <AreaFlash result={state.shown} onDismiss={state.dismiss} onAnnounce={state.announce} />}
        <Page key={`${path}:${String(visit)}:${String(generation)}`} snapshot={snapshot} />
      </HandOverNoteContext>
    );
  }
  const frame = (path: string, visit: number, generation: number) => {
    const element = <Frame path={path} visit={visit} generation={generation} snapshot={strict} />;
    return strict ? <StrictMode>{element}</StrictMode> : element;
  };
  const view = render(frame(from, 0, 0));
  return {
    get state() {
      if (!flash) throw new Error('Expected flash state');
      return flash;
    },
    get note() {
      return mounted;
    },
    view,
    route: (path: string, visit = 1, generation = 0) => view.rerender(frame(path, visit, generation)),
    status: () => within(view.container).getByRole('status').textContent,
    flashbar: () => createWrapper(view.container).findFlashbar(),
  };
}

it('shows and announces the result and supplies the note at its destination visit', () => {
  const frame = mount();
  act(() => frame.state.pageFlash.handOver(to, warning, note));
  expect(navigate).toHaveBeenLastCalledWith(to);
  expect(frame.note).toBeNull();
  frame.route(to);
  expect(frame.note).toBe('received');
  expect(frame.flashbar()?.getElement()).toHaveTextContent('Operation unavailable');
  expect(frame.status()).toBe('Warning Operation unavailable');
});

it.each([0, 1])('shows a hand-over without a note at target generation %i', (generation) => {
  const frame = mount();
  act(() => frame.state.pageFlash.handOver(to, warning));
  frame.route(to, 1, generation);
  expect(frame.note).toBeNull();
  expect(frame.flashbar()?.getElement()).toHaveTextContent('Operation unavailable');
  expect(frame.status()).toBe('Warning Operation unavailable');
});

it.each(['before', 'while'])(
  'clears the note, result and announcement when generation changes %s the destination visit',
  (timing) => {
    const frame = mount();
    act(() => frame.state.pageFlash.handOver(to, warning, note));
    if (timing === 'while') {
      frame.route(to);
      expect(frame.status()).toBe('Warning Operation unavailable');
    }
    frame.route(to, 1, 1);
    expect(frame.note).toBeNull();
    expect(frame.flashbar()).toBeNull();
    expect(frame.status()).toBe('');
  },
);

it('never shows a note when the next path is not the destination', () => {
  const frame = mount();
  act(() => frame.state.pageFlash.handOver(to, warning, note));
  frame.route('/aws/other');
  expect(frame.note).toBeNull();
  frame.route(to, 2);
  expect(frame.note).toBeNull();
  expect(frame.flashbar()).toBeNull();
});

it('does not show the note when returning on a later visit', () => {
  const frame = mount();
  act(() => frame.state.pageFlash.handOver(to, warning, note));
  frame.route(to);
  expect(frame.note).toBe('received');
  frame.route(from, 2);
  frame.route(to, 3);
  expect(frame.note).toBeNull();
});

it('provides the note at mount under StrictMode', () => {
  const frame = mount(true);
  act(() => frame.state.pageFlash.handOver(to, warning, note));
  frame.route(to);
  expect(frame.note).toBe('received');
});

it('keeps the note through query changes and dismissal, and drops it on show', () => {
  const frame = mount();
  act(() => frame.state.pageFlash.handOver(`${to}?bus=orders`, warning, note));
  frame.route(to);
  expect(frame.note).toBe('received');
  // The router supplies the same pathname and visit for a query change.
  frame.route(to);
  expect(frame.note).toBe('received');
  const key = frame.state.shown?.items[0]?.key;
  if (!key) throw new Error('Expected a flash item');
  act(() => frame.state.dismiss(key));
  expect(frame.note).toBe('received');
  expect(frame.flashbar()).toBeNull();
  act(() => frame.state.pageFlash.show([{ type: 'success', content: 'Saved' }]));
  expect(frame.note).toBeNull();
  expect(frame.status()).toBe('Success Saved');
});

it('only gives the note to the frame that handed it over', () => {
  const first = mount();
  const second = mount();
  act(() => first.state.pageFlash.handOver(to, warning, note));
  first.route(to);
  second.route(to);
  expect(first.note).toBe('received');
  expect(second.note).toBeNull();
});
