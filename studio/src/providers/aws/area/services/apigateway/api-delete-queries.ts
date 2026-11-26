import { useMutation, useQueryClient } from '@tanstack/react-query';

import { noEndpoint } from '../../components/use-token-listing';
import { deleteApi, deleteApiModel, type DeleteApiTarget } from './api-delete-api';
import { dropApi, refreshApiLists } from './queries';

export function useDeleteApi(endpoint: string | undefined, onDeleted: (api: DeleteApiTarget) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ api, signal }: { api: DeleteApiTarget; signal: AbortSignal }) => {
      if (endpoint === undefined) return noEndpoint();
      await deleteApi(endpoint, api, signal);
      return endpoint;
    },
    onSuccess: (origin, { api, signal }) => {
      const model = deleteApiModel(api.kind);
      dropApi(client, model, api.id);
      if (!signal.aborted) onDeleted(api);
      return refreshApiLists(client, { endpoint: origin, model, id: api.id });
    },
  });
}
