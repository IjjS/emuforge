import type { ReactNode } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { Code, ReadFailure, type ReadFailureState } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';

function textState(first: string, detail: ReactNode, type: ReadFailureState['type'] = 'error'): ReadFailureState {
  return { type, first, firstText: first, detail, recovery: false };
}

function connectionState(
  before: string,
  value: string | undefined,
  after: string,
  detail: ReactNode,
  type: ReadFailureState['type'] = 'error',
): ReadFailureState {
  const first =
    value === undefined ? (
      before
    ) : (
      <>
        {before}
        <Code>
          <ValueText kind={type === 'stopped' ? 'fixed' : 'address'} value={value} />
        </Code>
        {after}
      </>
    );
  return { type, first, firstText: `${before}${value ?? ''}${after}`, detail, recovery: true };
}

// eslint-disable-next-line react-refresh/only-export-components -- a read failure and its presentation are used together
export function requestReadFailureState(
  failure: RequestFailure,
  { result, engineOrigin }: AreaConnection,
  thing: string,
): ReadFailureState {
  const { operation } = failure;
  switch (failure.kind) {
    case 'not-implemented':
      return textState(
        'Not implemented by the emulator',
        `The emulator answered 501 Not Implemented for ${operation}, so Studio cannot show the ${thing}.`,
        'info',
      );
    case 'access-denied':
      return textState(
        'Access denied',
        <ValueText kind="text" value={`${operation} was refused: ${failure.message}`} />,
      );
    case 'other':
      return textState(
        `The ${thing} could not be read`,
        <ValueText
          kind="text"
          value={`${operation}: ${failure.code}${failure.message === undefined ? '' : `: ${failure.message}`}`}
        />,
      );
    case 'engine-did-not-answer': {
      const detail = `${operation} got no answer.`;
      return engineOrigin === undefined
        ? connectionState('The EmuForge engine is not answering', undefined, '', detail)
        : connectionState('The EmuForge engine at ', engineOrigin, ' is not answering', detail);
    }
    case 'emulator-did-not-answer': {
      const detail = (
        <ValueText
          kind="text"
          value={`${operation} got no answer from the emulator.${failure.message === '' ? '' : ` ${failure.message}`}`}
        />
      );
      if (result?.kind === 'emulator-unreachable' && result.reason === 'not_started') {
        return connectionState('Not started on port ', String(result.emulator.port), '', detail, 'stopped');
      }
      if (result?.kind === 'connected' || result?.kind === 'emulator-unreachable') {
        return connectionState('Not answering at ', result.emulator.endpoint, '', detail);
      }
      return connectionState('The emulator did not answer', undefined, '', detail);
    }
  }
}

export interface RequestReadFailureProps {
  failure: RequestFailure;
  connection: AreaConnection;
  thing: string;
  onRetry: () => void;
}

export function RequestReadFailure({ failure, connection, thing, onRetry }: RequestReadFailureProps) {
  return <ReadFailure state={requestReadFailureState(failure, connection, thing)} onRetry={onRetry} />;
}
