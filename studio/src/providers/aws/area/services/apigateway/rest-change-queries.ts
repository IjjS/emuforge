import { useMutation, useQueryClient } from '@tanstack/react-query';

import { failureOf, noEndpoint, usePageSignal } from '../../components/use-token-listing';
import { dropApiLists } from './queries';
import {
  CREATE_RESOURCE,
  DELETE_METHOD,
  DELETE_RESOURCE,
  UPDATE_REST_API,
  createResource,
  deleteMethod,
  deleteResource,
  updateRestApi,
  type RestApiFields,
} from './rest-change-api';
import { refreshRestApi, refreshRestResources } from './rest-queries';

function useRestChange<T, Result>(
  endpoint: string | undefined,
  operation: string,
  change: (endpoint: string, fields: T, signal: AbortSignal) => Promise<Result>,
  onChanged: (result: Result) => void,
  refresh: () => Promise<void>,
) {
  const pageSignal = usePageSignal();
  const { mutate, isPending, isError, error } = useMutation({
    mutationFn: ({ fields, signal }: { fields: T; signal: AbortSignal }) =>
      endpoint === undefined ? noEndpoint() : change(endpoint, fields, signal),
    onSuccess: (result, { signal }) => {
      if (signal.aborted) return;
      onChanged(result);
      void refresh();
    },
  });
  const failure = isError ? failureOf(error, operation) : undefined;
  const available = endpoint !== undefined && failure?.kind !== 'not-implemented';

  return {
    isPending,
    failure,
    available,
    submit: (fields: T) => {
      if (available && !isPending) mutate({ fields, signal: pageSignal() });
    },
  };
}

export function useUpdateRestApi(
  endpoint: string | undefined,
  apiId: string,
  previous: RestApiFields,
  onSaved: (name: string) => void,
) {
  const client = useQueryClient();
  return useRestChange(
    endpoint,
    UPDATE_REST_API,
    async (origin, fields: RestApiFields, signal) => {
      const api = await updateRestApi(origin, apiId, previous, fields, signal);
      return api.name ?? fields.name;
    },
    onSaved,
    () => {
      dropApiLists(client);
      return refreshRestApi(client, apiId);
    },
  );
}

export function useCreateResource(endpoint: string | undefined, apiId: string, onCreated: (path: string) => void) {
  const client = useQueryClient();
  return useRestChange(
    endpoint,
    CREATE_RESOURCE,
    async (origin, fields: { parentId: string; parentPath: string; pathPart: string }, signal) => {
      const resource = await createResource(origin, apiId, fields.parentId, fields.pathPart, signal);
      return resource.path ?? `${fields.parentPath === '/' ? '' : fields.parentPath}/${fields.pathPart}`;
    },
    onCreated,
    () => refreshRestResources(client, apiId),
  );
}

export function useDeleteResource(endpoint: string | undefined, apiId: string, onDeleted: () => void) {
  const client = useQueryClient();
  return useRestChange(
    endpoint,
    DELETE_RESOURCE,
    (origin, resourceId: string, signal) => deleteResource(origin, apiId, resourceId, signal),
    onDeleted,
    () => refreshRestResources(client, apiId),
  );
}

export function useDeleteMethod(endpoint: string | undefined, apiId: string, onDeleted: () => void) {
  const client = useQueryClient();
  return useRestChange(
    endpoint,
    DELETE_METHOD,
    (origin, target: { resourceId: string; method: string }, signal) =>
      deleteMethod(origin, apiId, target.resourceId, target.method, signal),
    onDeleted,
    () => refreshRestResources(client, apiId),
  );
}
