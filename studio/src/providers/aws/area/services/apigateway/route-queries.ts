import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createRoute } from './route-create-api';
import type { RouteInput } from './route-form';
import { refreshV2Routes } from './v2-queries';

export function useCreateRoute(apiId: string, endpoint: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ input, signal }: { input: RouteInput; signal: AbortSignal }) =>
      createRoute(endpoint, apiId, input, signal),
    networkMode: 'always',
    onSuccess: (outcome) => {
      if (outcome.kind === 'created' || outcome.kind === 'left') void refreshV2Routes(client, apiId);
    },
  });
}
