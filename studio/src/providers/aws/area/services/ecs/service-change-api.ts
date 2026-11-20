import { DeleteServiceCommand, UpdateServiceCommand } from '@aws-sdk/client-ecs';

import { sendEcs } from './api';
import type { UpdateRequest } from './update-form';

// The changes of a service on S4 (issue 575, design task 6): "Update service" and "Delete service", each one call
// through `api.ts`'s `sendEcs` with its operation's name, so a refusal rejects with its `RequestError` carrying the
// emulator's code and message as they came.

/** The operations of the changes, as a failure names them. */
export const SERVICE_CHANGE_OPERATIONS = {
  updateService: 'UpdateService',
  deleteService: 'DeleteService',
} as const;

/** "Update service": `UpdateService` with the cluster, the service and the request as `update-form.ts` built it. */
export async function updateService(
  endpoint: string,
  cluster: string,
  service: string,
  request: UpdateRequest,
  signal: AbortSignal,
): Promise<void> {
  await sendEcs(
    endpoint,
    SERVICE_CHANGE_OPERATIONS.updateService,
    (client, abortSignal) => client.send(new UpdateServiceCommand({ cluster, service, ...request }), { abortSignal }),
    signal,
  );
}

/** "Delete service": `DeleteService` with the cluster, the service and `force`, so a service of tasks is deleted. */
export async function deleteService(
  endpoint: string,
  cluster: string,
  service: string,
  signal: AbortSignal,
): Promise<void> {
  await sendEcs(
    endpoint,
    SERVICE_CHANGE_OPERATIONS.deleteService,
    (client, abortSignal) => client.send(new DeleteServiceCommand({ cluster, service, force: true }), { abortSignal }),
    signal,
  );
}
