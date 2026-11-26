import { useMutation } from '@tanstack/react-query';

import { failureOf, noEndpoint, usePageSignal } from '../../components/use-token-listing';
import { TEST_INVOKE_METHOD, testInvokeMethod, type TestMethodInput } from './test-api';

export function useTestMethod(endpoint: string | undefined) {
  const pageSignal = usePageSignal();
  // The observer follows the latest mutation even if an older test finishes later.
  const { mutate, data, error, isError, isPending } = useMutation({
    mutationFn: ({ input, signal }: { input: TestMethodInput; signal: AbortSignal }) =>
      endpoint === undefined ? noEndpoint() : testInvokeMethod(endpoint, input, signal),
  });
  const failure = isError ? failureOf(error, TEST_INVOKE_METHOD) : undefined;
  const unavailableReason =
    failure?.kind === 'not-implemented'
      ? 'Not implemented by the emulator'
      : endpoint === undefined
        ? 'The EmuForge engine address is not available.'
        : undefined;

  return {
    response: data,
    failure,
    isPending,
    unavailableReason,
    submit: (input: TestMethodInput) => {
      if (unavailableReason === undefined) mutate({ input, signal: pageSignal() });
    },
  };
}
