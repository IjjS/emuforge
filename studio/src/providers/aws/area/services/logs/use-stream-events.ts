import type { OutputLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf } from '../../components/use-token-listing';
import { GET_LOG_EVENTS, getLogEvents, type EventPage, type EventRead } from './event-api';

type End = 'older' | 'newer';
type Direction = 'initial' | End;

interface Continuation {
  token: string | undefined;
  beforeTime?: number;
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
  fromTime?: number;
  inFlight: Set<Direction>;
}

const INITIAL_STATE: StreamState = { prepended: 0, older: { token: undefined }, newer: { token: undefined } };

function acceptPage(
  state: StreamState,
  direction: Direction,
  page: EventPage,
  fromTime: number | undefined,
): StreamState {
  if (direction === 'initial') {
    return {
      events: page.events,
      prepended: 0,
      older: fromTime === undefined ? { token: page.nextBackwardToken } : { token: undefined, beforeTime: fromTime },
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
    let request: EventRead;
    if (continuation === undefined) {
      request = active.fromTime === undefined ? { kind: 'newest' } : { kind: 'from-time', time: active.fromTime };
    } else if (continuation.beforeTime !== undefined) {
      request = { kind: 'before-time', time: continuation.beforeTime };
    } else if (continuation.token !== undefined) {
      request = { kind: 'continue', token: continuation.token };
    } else {
      return;
    }

    const publish = (state: StreamState) => {
      active.state = state;
      setSnapshot({ source: active.source, state });
    };
    inFlight.add(direction);
    publish(
      direction === 'initial'
        ? INITIAL_STATE
        : {
            ...active.state,
            [direction]: { token: continuation?.token, beforeTime: continuation?.beforeTime, reading: true },
          },
    );
    try {
      const page = await getLogEvents(endpoint, group, stream, request, controller.signal);
      if (!controller.signal.aborted) publish(acceptPage(active.state, direction, page, active.fromTime));
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

  const start = useCallback(
    (source: StreamSource, fromTime?: number) => {
      session.current?.controller.abort();
      const active: ReadSession = {
        source,
        controller: new AbortController(),
        state: INITIAL_STATE,
        fromTime,
        inFlight: new Set(),
      };
      session.current = active;
      void read(active, 'initial');
    },
    [read],
  );

  useEffect(() => {
    start(source);
    return () => {
      if (session.current?.source === source) session.current.controller.abort();
    };
  }, [source, start]);

  const load = (direction: Direction) => {
    const active = session.current;
    if (active?.source === source) void read(active, direction);
  };
  return { ...state, load, readFrom: (time: number) => start(source, time) };
}
