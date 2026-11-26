import { useMutation, useQueryClient } from '@tanstack/react-query';

import { noEndpoint } from '../../components/use-token-listing';
import { deleteApi, deleteApiModel, type DeleteApiTarget } from './api-delete-api';
import { dropApi, refreshApiLists } from './queries';

export function useDeleteApi(endpoint: string | undefined, onDeleted: (api: DeleteApiTarget) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ api, signal }: { api: DeleteApiTarget; signal: AbortSignal }) =>
      endpoint === undefined ? noEndpoint() : deleteApi(endpoint, api, signal),
    onSuccess: (_, { api, signal }) => {
      dropApi(client, deleteApiModel(api.kind), api.id);
      if (!signal.aborted) onDeleted(api);
      return refreshApiLists(client);
    },
  });
}
