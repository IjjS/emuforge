import { CreateServiceCommand } from '@aws-sdk/client-ecs';

import { sendEcs, text } from './api';
import type { CreateServiceRequest } from './create-service-form';

export const CREATE_SERVICE_OPERATION = 'CreateService';

export async function createService(
  endpoint: string,
  request: CreateServiceRequest,
  signal: AbortSignal,
): Promise<string> {
  const { service } = await sendEcs(
    endpoint,
    CREATE_SERVICE_OPERATION,
    (client, abortSignal) => client.send(new CreateServiceCommand(request), { abortSignal }),
    signal,
  );
  const name = text(service?.serviceName);
  if (name === undefined) {
    throw new Error('CreateService did not return a service name.');
  }
  return name;
}
