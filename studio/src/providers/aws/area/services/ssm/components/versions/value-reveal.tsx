import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useLayoutEffect, useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../../components/failure-states';
import { failureOf } from '../../../../components/use-token-listing';
import { ValueText } from '../../../../components/value-text';
import { useUnsupportedOperation } from '../../queries';
import { GET_PARAMETER, getParameterValue } from '../../version-api';

type Reveal =
  | { kind: 'hidden' }
  | { kind: 'loading'; showRetry: boolean }
  | { kind: 'shown'; value: string | undefined }
  | { kind: 'failed'; failure: RequestFailure; showRetry: boolean };

export function ValueReveal({
  connection,
  name,
  secure,
}: {
  connection: AreaConnection;
  name: string;
  secure: boolean;
}) {
  const { failure: unsupported, markUnsupported } = useUnsupportedOperation(connection, GET_PARAMETER);
  const request = useRef<AbortController | undefined>(undefined);
  const [reveal, setReveal] = useState<Reveal>({ kind: 'hidden' });
  useLayoutEffect(() => () => request.current?.abort(), []);

  const handleHide = () => {
    request.current?.abort();
    request.current = undefined;
    setReveal({ kind: 'hidden' });
  };

  const handleShow = async () => {
    const endpoint = connection.engineOrigin;
    if (endpoint === undefined || unsupported || request.current) return;

    const controller = new AbortController();
    const retrying = reveal.kind === 'failed';
    request.current = controller;
    setReveal({ kind: 'loading', showRetry: retrying });
    try {
      const value = await getParameterValue(endpoint, name, secure, controller.signal);
      if (!controller.signal.aborted) setReveal({ kind: 'shown', value });
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = failureOf(error, GET_PARAMETER);
      if (failure.kind === 'not-implemented') markUnsupported(failure);
      setReveal({ kind: 'failed', failure, showRetry: retrying || failure.kind !== 'not-implemented' });
    } finally {
      if (request.current === controller) request.current = undefined;
    }
  };

  const visible = !unsupported && (reveal.kind === 'shown' || reveal.kind === 'loading');
  const failure = unsupported && actionFailureItem(unsupported, 'Showing the value', connection.engineOrigin);
  const showRetry = (reveal.kind === 'loading' || reveal.kind === 'failed') && reveal.showRetry;
  return (
    <SpaceBetween size="xs">
      <Button
        disabled={connection.engineOrigin === undefined || unsupported !== undefined}
        onClick={visible ? handleHide : () => void handleShow()}
      >
        {visible ? 'Hide value' : 'Show value'}
      </Button>
      {failure ? (
        <div role="status">
          <StatusIndicator type="info">{failure.header}</StatusIndicator>
          <Box variant="p">{failure.content}</Box>
          {showRetry && <Button disabled>Retry</Button>}
        </div>
      ) : reveal.kind === 'loading' ? (
        <StatusIndicator type="loading">Loading value…</StatusIndicator>
      ) : reveal.kind === 'shown' ? (
        <Box variant="code" nativeAttributes={{ style: { whiteSpace: 'pre-wrap' } }}>
          <ValueText
            kind="text"
            value={reveal.value}
            none={reveal.value === '' ? '(Empty value)' : 'Value unavailable'}
          />
        </Box>
      ) : reveal.kind === 'failed' ? (
        <ReadFailure
          state={readFailureState(reveal.failure, connection, 'parameter value')}
          onRetry={() => void handleShow()}
        />
      ) : null}
    </SpaceBetween>
  );
}
