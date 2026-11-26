import { useMutation, useQueryClient } from '@tanstack/react-query';

import { noEndpoint, usePageSignal } from '../../components/use-token-listing';
import { refreshRestStages } from './rest-queries';
import { deleteRestStage, deployRestApi, type DeployInput } from './rest-stage-api';

export function useDeployRestApi(apiId: string, endpoint: string | undefined, onSuccess: (stageName: string) => void) {
  const client = useQueryClient();
  const signal = usePageSignal();
  return useMutation({
    mutationFn: (input: DeployInput) =>
      endpoint === undefined ? noEndpoint() : deployRestApi(endpoint, apiId, input, signal()),
    onSuccess: (_, input) => {
      onSuccess(input.stageName);
      void refreshRestStages(client, apiId);
    },
  });
}

export function useDeleteRestStage(
  apiId: string,
  endpoint: string | undefined,
  onSuccess: (stageName: string) => void,
) {
  const client = useQueryClient();
  const signal = usePageSignal();
  return useMutation({
    mutationFn: (stageName: string) =>
      endpoint === undefined ? noEndpoint() : deleteRestStage(endpoint, apiId, stageName, signal()),
    onSuccess: (_, stageName) => {
      onSuccess(stageName);
      void refreshRestStages(client, apiId);
    },
  });
}
