import type { OutputLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf } from '../../components/use-token-listing';
import { GET_LOG_EVENTS, getLogEvents, type EventPage, type EventRead } from './event-api';

type End = 'older' | 'newer';
type Direction = 'initial' | End;

interface Continuation {
  token: string | undefined;
  empty?: boolean;
  reading?: boolean;
  failure?: RequestFailure;
}

interface StreamState {
  events?: OutputLogEvent[];
  prepended: number;
  initialFailure?: RequestFailure;
  older: Continuation;
  newer: Continuation;
}

interface StreamSource {
  endpoint: string | undefined;
  group: string;
  stream: string;
}

interface ReadSession {
  source: StreamSource;
  controller: AbortController;
  state: StreamState;
  inFlight: Set<Direction>;
}

const INITIAL_STATE: StreamState = { prepended: 0, older: { token: undefined }, newer: { token: undefined } };

function acceptPage(state: StreamState, direction: Direction, page: EventPage): StreamState {
  if (direction === 'initial') {
    return {
      events: page.events,
      prepended: 0,
      older: { token: page.nextBackwardToken },
      newer: { token: page.nextForwardToken },
    };
  }
  const current = state.events ?? [];
  const empty = page.events.length === 0;
  if (direction === 'older') {
    return {
      ...state,
      events: [...page.events, ...current],
      prepended: state.prepended + page.events.length,
      older: { token: empty ? undefined : page.nextBackwardToken, empty },
    };
  }
  return {
    ...state,
    events: [...current, ...page.events],
    newer: { token: page.nextForwardToken ?? state.newer.token, empty },
  };
}

export function useStreamEvents(endpoint: string | undefined, group: string, stream: string) {
  const source = useMemo(() => ({ endpoint, group, stream }), [endpoint, group, stream]);
  const session = useRef<ReadSession>(null);
  const [snapshot, setSnapshot] = useState<{ source: StreamSource; state: StreamState }>();
  const state = snapshot?.source === source ? snapshot.state : INITIAL_STATE;

  const read = useCallback(async (active: ReadSession, direction: Direction) => {
    const { controller, inFlight } = active;
    const { endpoint, group, stream } = active.source;
    if (endpoint === undefined || controller.signal.aborted || inFlight.has(direction)) return;

    const continuation = direction === 'initial' ? undefined : active.state[direction];
    if (continuation !== undefined && continuation.token === undefined) return;
    const request: EventRead =
      continuation?.token === undefined ? { kind: 'newest' } : { kind: 'continue', token: continuation.token };

    const publish = (state: StreamState) => {
      active.state = state;
      setSnapshot({ source: active.source, state });
    };
    inFlight.add(direction);
    publish(
      direction === 'initial'
        ? INITIAL_STATE
        : { ...active.state, [direction]: { token: continuation?.token, reading: true } },
    );
    try {
      const page = await getLogEvents(endpoint, group, stream, request, controller.signal);
      if (!controller.signal.aborted) publish(acceptPage(active.state, direction, page));
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = failureOf(error, GET_LOG_EVENTS);
      publish(
        direction === 'initial'
          ? { ...active.state, initialFailure: failure }
          : { ...active.state, [direction]: { ...active.state[direction], reading: false, failure } },
      );
    } finally {
      inFlight.delete(direction);
    }
  }, []);

  useEffect(() => {
    const active: ReadSession = {
      source,
      controller: new AbortController(),
      state: INITIAL_STATE,
      inFlight: new Set(),
    };
    session.current = active;
    void read(active, 'initial');
    return () => active.controller.abort();
  }, [source, read]);

  const load = (direction: Direction) => {
    const active = session.current;
    if (active?.source === source) void read(active, direction);
  };
  return { ...state, load };
}
