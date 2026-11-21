import {
  CHOOSE_FAMILY,
  CHOOSE_REVISION,
  CHOOSE_SUBNET,
  RUN_FORM_START,
  runFormDiffers,
  type RunFormState,
  type RunRequest,
} from './run-form';
import { COUNT_MESSAGE, desiredCountOf } from './update-form';

export interface CreateServiceFormState extends RunFormState {
  name: string;
}

export const CREATE_SERVICE_START: CreateServiceFormState = { ...RUN_FORM_START, name: '' };

export type CreateServiceField = 'name' | 'family' | 'revision' | 'count' | 'subnets';

export function createServiceMessages(form: CreateServiceFormState): Partial<Record<CreateServiceField, string>> {
  return {
    ...(form.name.trim() === '' ? { name: 'Enter a service name.' } : {}),
    ...(form.family ? {} : { family: CHOOSE_FAMILY }),
    ...(form.revision === undefined ? { revision: CHOOSE_REVISION } : {}),
    ...(desiredCountOf(form.count) === undefined ? { count: COUNT_MESSAGE } : {}),
    ...(form.subnets.length === 0 ? { subnets: CHOOSE_SUBNET } : {}),
  };
}

export function createServiceDiffers(form: CreateServiceFormState): boolean {
  return form.name !== '' || runFormDiffers(form);
}

export interface CreateServiceRequest extends Omit<RunRequest, 'count'> {
  serviceName: string;
  desiredCount: number;
}

export function createServiceRequestOf(
  cluster: string,
  form: CreateServiceFormState,
): CreateServiceRequest | undefined {
  const desiredCount = desiredCountOf(form.count);
  const serviceName = form.name.trim();
  if (
    !serviceName ||
    !form.family ||
    form.revision === undefined ||
    desiredCount === undefined ||
    !form.subnets.length
  ) {
    return undefined;
  }

  return {
    cluster,
    serviceName,
    desiredCount,
    launchType: 'FARGATE',
    taskDefinition: form.revision.value,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: form.subnets.map(({ id }) => id),
        ...(form.groups.length === 0 ? {} : { securityGroups: form.groups.map(({ id }) => id) }),
        assignPublicIp: form.publicIp ? 'ENABLED' : 'DISABLED',
      },
    },
  };
}
