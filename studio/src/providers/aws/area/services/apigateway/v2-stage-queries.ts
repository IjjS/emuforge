import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf, noEndpoint, usePageSignal } from '../../components/use-token-listing';
import { refreshV2Stages } from './v2-queries';
import {
  CREATE_DEPLOYMENT,
  CREATE_STAGE,
  DELETE_STAGE,
  createV2Stage,
  deleteV2Stage,
  deployV2Stage,
} from './v2-stage-api';

function useV2StageChange<T>(
  endpoint: string | undefined,
  apiId: string | undefined,
  operation: string,
  change: (endpoint: string, apiId: string, input: T, signal: AbortSignal) => Promise<void>,
  onSuccess: (input: T) => void,
  deletedStageName?: (input: T) => string,
) {
  const client = useQueryClient();
  const pageSignal = usePageSignal();
  const { mutate, isPending, isError, error } = useMutation({
    mutationFn: ({ input, signal }: { input: T; signal: AbortSignal }) => {
      if (endpoint === undefined) return noEndpoint();
      if (apiId === undefined) throw new Error('The API ID is not known yet.');
      return change(endpoint, apiId, input, signal);
    },
    onSuccess: (_, { input, signal }) => {
      if (apiId === undefined || signal.aborted) return;
      onSuccess(input);
      const stageName = deletedStageName?.(input);
      void refreshV2Stages(client, apiId, stageName === undefined ? undefined : { endpoint, stageName });
    },
  });
  const failure = isError ? failureOf(error, operation) : undefined;
  const available = endpoint !== undefined && apiId !== undefined && failure?.kind !== 'not-implemented';

  return {
    isPending,
    failure,
    available,
    submit: (input: T, onError?: (failure: RequestFailure) => void) => {
      if (!available || isPending) return;
      const signal = pageSignal();
      mutate(
        { input, signal },
        {
          onError: (error) => {
            if (!signal.aborted) onError?.(failureOf(error, operation));
          },
        },
      );
    },
  };
}

export function useCreateV2Stage(apiId: string, endpoint: string | undefined, onCreated: (stageName: string) => void) {
  return useV2StageChange(endpoint, apiId, CREATE_STAGE, createV2Stage, ({ stageName }) => onCreated(stageName));
}

export function useDeployV2Stage(
  apiId: string | undefined,
  endpoint: string | undefined,
  onDeployed: (stageName: string) => void,
) {
  return useV2StageChange(endpoint, apiId, CREATE_DEPLOYMENT, deployV2Stage, onDeployed);
}

export function useDeleteV2Stage(apiId: string, endpoint: string | undefined, onDeleted: (stageName: string) => void) {
  return useV2StageChange(endpoint, apiId, DELETE_STAGE, deleteV2Stage, onDeleted, (stageName) => stageName);
}
