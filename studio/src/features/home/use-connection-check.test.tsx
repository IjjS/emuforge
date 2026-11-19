import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advance,
  connected,
  connectedTo,
  FakeEngine,
  present,
  renderWithTargetSeen,
  type SeenProbe,
} from '../../test/home-test-kit';
import { useConnectionCheck } from './use-connection-check';

let engine: FakeEngine;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(1_000_000);
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs the connection check for as long as it is mounted. */
function Check() {
  useConnectionCheck();
  return null;
}

function report(seen: SeenProbe, name: string, startedAt: number): void {
  act(() => {
    seen.current.report(name, startedAt);
  });
}

describe('the connection check and the target seen (issue 486, s1)', () => {
  it('each answer naming a target is reported, with the time its check started', async () => {
    engine.healthAnswers = [{ ...connectedTo('local'), delayMs: 300 }, connectedTo('second')];
    const { seen } = renderWithTargetSeen(<Check />);
    await advance(100);
    expect(engine.healths).toHaveLength(1);
    const started = Date.now() - 100;

    // A report made after the check started and before its answer: the answer, older by its start, does not undo it.
    report(seen, 'other', started + 50);
    await advance(200);
    expect(seen.current.name).toBe('other');
    expect(seen.current.generation).toBe(0);

    // The next answer, of a check started after that report, is reported.
    await advance(5_000);
    expect(engine.healths).toHaveLength(2);
    expect(seen.current.name).toBe('second');
    expect(seen.current.generation).toBe(1);
  });

  it('an answer naming no target is not reported', async () => {
    engine.healthAnswers = [connected()];
    const { seen } = renderWithTargetSeen(<Check />);
    await advance();
    expect(engine.healths).toHaveLength(1);
    expect(seen.current.name).toBeUndefined();
  });

  it('a change of generation by another report: a check at once, not 5 s later, and the check in flight replaced', async () => {
    engine.healthAnswers = [connectedTo('local'), { hang: true }, connectedTo('second')];
    const { seen } = renderWithTargetSeen(<Check />);
    await advance();
    expect(seen.current.name).toBe('local');
    await advance(5_000);
    expect(engine.healths).toHaveLength(2);
    const inFlight = present(engine.healths[1], 'the check in flight');
    expect(inFlight.aborted()).toBe(false);

    report(seen, 'second', Date.now());
    await advance();

    expect(seen.current.generation).toBe(1);
    expect(engine.healths).toHaveLength(3);
    expect(inFlight.aborted()).toBe(true);
    expect(seen.current.name).toBe('second');
    // Its own answer named the same target: no further change and no further check before the next 5 s.
    expect(seen.current.generation).toBe(1);
    await advance(4_999);
    expect(engine.healths).toHaveLength(3);
    await advance(1);
    expect(engine.healths).toHaveLength(4);
  });

  it('a change of generation by its own answer: no extra check', async () => {
    engine.healthAnswers = [connectedTo('local'), connectedTo('second')];
    const { seen } = renderWithTargetSeen(<Check />);
    await advance();
    await advance(5_000);
    expect(engine.healths).toHaveLength(2);
    expect(seen.current.name).toBe('second');
    expect(seen.current.generation).toBe(1);

    await advance(4_999);
    expect(engine.healths).toHaveLength(2);
    await advance(1);
    expect(engine.healths).toHaveLength(3);
  });
});
