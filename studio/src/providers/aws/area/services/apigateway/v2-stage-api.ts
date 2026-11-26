import { CreateDeploymentCommand, CreateStageCommand, DeleteStageCommand } from '@aws-sdk/client-apigatewayv2';

import { sendV2 } from './clients';

export const CREATE_STAGE = 'CreateStage';
export const CREATE_DEPLOYMENT = 'CreateDeployment';
export const DELETE_STAGE = 'DeleteStage';

export interface V2StageInput {
  stageName: string;
  autoDeploy: boolean;
}

export async function createV2Stage(
  endpoint: string,
  apiId: string,
  { stageName, autoDeploy }: V2StageInput,
  signal: AbortSignal,
): Promise<void> {
  await sendV2(
    endpoint,
    CREATE_STAGE,
    (client, abortSignal) =>
      client.send(new CreateStageCommand({ ApiId: apiId, StageName: stageName, AutoDeploy: autoDeploy }), {
        abortSignal,
      }),
    signal,
  );
}

export async function deployV2Stage(
  endpoint: string,
  apiId: string,
  stageName: string,
  signal: AbortSignal,
): Promise<void> {
  await sendV2(
    endpoint,
    CREATE_DEPLOYMENT,
    (client, abortSignal) =>
      client.send(new CreateDeploymentCommand({ ApiId: apiId, StageName: stageName }), { abortSignal }),
    signal,
  );
}

export async function deleteV2Stage(
  endpoint: string,
  apiId: string,
  stageName: string,
  signal: AbortSignal,
): Promise<void> {
  await sendV2(
    endpoint,
    DELETE_STAGE,
    (client, abortSignal) =>
      client.send(new DeleteStageCommand({ ApiId: apiId, StageName: stageName }), { abortSignal }),
    signal,
  );
}
