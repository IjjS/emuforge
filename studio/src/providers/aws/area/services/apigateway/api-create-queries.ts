import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { bindAwsMutationAuthorization, RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import { createApi, type CreatedApi } from './api-create-api';
import type { NewApi } from './api-form';
import { dropApiLists } from './queries';

export type ApiCreateOutcome = { created: CreatedApi } | { failure: RequestFailure };

export function useCreateApi(endpoint: string | undefined) {
  const client = useQueryClient();
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const { mutateAsync, isPending } = useMutation({
    mutationFn: ({ origin, input, signal }: { origin: string; input: NewApi; signal: AbortSignal }) =>
      createApi(origin, input, signal),
    retry: false,
    networkMode: 'always',
    onSuccess: () => dropApiLists(client),
  });

  async function submit(input: NewApi): Promise<ApiCreateOutcome | undefined> {
    if (active.current || endpoint === undefined) return;
    const controller = new AbortController();
    active.current = controller;
    const dispose = bindAwsMutationAuthorization(controller);
    try {
      const created = await mutateAsync({ origin: endpoint, input, signal: controller.signal });
      if (!controller.signal.aborted) return { created };
    } catch (error) {
      if (error instanceof RequestError) return { failure: error.failure };
      if (!controller.signal.aborted) throw error;
    } finally {
      dispose();
      active.current = null;
    }
  }

  return { submit, isPending };
}
