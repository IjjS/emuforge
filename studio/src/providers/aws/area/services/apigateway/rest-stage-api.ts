import { CreateDeploymentCommand, DeleteStageCommand } from '@aws-sdk/client-api-gateway';

import { sendRest } from './clients';

export const CREATE_DEPLOYMENT = 'CreateDeployment';
export const DELETE_STAGE = 'DeleteStage';

export interface DeployInput {
  stageName: string;
  description: string;
}

export async function deployRestApi(
  endpoint: string,
  restApiId: string,
  { stageName, description }: DeployInput,
  signal: AbortSignal,
): Promise<void> {
  await sendRest(
    endpoint,
    CREATE_DEPLOYMENT,
    (client, abortSignal) =>
      client.send(new CreateDeploymentCommand({ restApiId, stageName, ...(description !== '' && { description }) }), {
        abortSignal,
      }),
    signal,
  );
}

export async function deleteRestStage(
  endpoint: string,
  restApiId: string,
  stageName: string,
  signal: AbortSignal,
): Promise<void> {
  await sendRest(
    endpoint,
    DELETE_STAGE,
    (client, abortSignal) => client.send(new DeleteStageCommand({ restApiId, stageName }), { abortSignal }),
    signal,
  );
}
