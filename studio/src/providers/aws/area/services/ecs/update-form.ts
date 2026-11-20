import type { RevisionChoice } from './definition-choices';
import type { Service } from './service-api';
import { definitionText } from './task-format';

// What "Update service" of S4 holds and checks before it sends `UpdateService` (issue 575, requirement S4; design
// task 6): the desired count, a whole number from 0, preset to the service's own; a revision, "Keep" the service's
// current one at the start; and whether to force a new deployment. The requirement's words, and the request the
// design sends for a valid form.

export const COUNT_RULE = 'A whole number, 0 or more.';
export const COUNT_MESSAGE = 'Enter a whole number, 0 or more.';

/** What the form holds. */
export interface UpdateFormState {
  /** As typed. */
  count: string;
  /** A revision chosen; `undefined` keeps the service's current one. */
  revision: RevisionChoice | undefined;
  force: boolean;
}

/** The message of each field that fails its check; a field that passes has none. */
export interface UpdateFormMessages {
  count?: string;
}

/** What `UpdateService` is sent besides the cluster and the service. */
export interface UpdateRequest {
  desiredCount: number;
  /** `family:revision`, only for a chosen revision. */
  taskDefinition?: string;
  /** Only when the box is checked. */
  forceNewDeployment?: true;
}

/** The form of `service` at start: its desired count, its current revision kept, the box clear. */
export function updateFormStart(service: Pick<Service, 'desired'>): UpdateFormState {
  return { count: service.desired === undefined ? '' : String(service.desired), revision: undefined, force: false };
}

/** The first choice of "Revision": "Keep {family}:{revision}", the service's current one. */
export function keepLabel(service: Pick<Service, 'definition' | 'definitionArn'>): string {
  if (service.definition !== undefined) {
    return `Keep ${definitionText(service.definition)}`;
  }
  return service.definitionArn === undefined ? 'Keep the current revision' : `Keep ${service.definitionArn}`;
}

/** The count as a number when it is a whole number, 0 or more. */
export function desiredCountOf(count: string): number | undefined {
  if (!/^\d+$/.test(count)) {
    return undefined;
  }
  const value = Number(count);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** What is wrong with the form, field by field. */
export function updateFormMessages(form: UpdateFormState): UpdateFormMessages {
  return desiredCountOf(form.count) === undefined ? { count: COUNT_MESSAGE } : {};
}

/** The request of a valid form; none while a field fails its check. */
export function updateRequestOf(form: UpdateFormState): UpdateRequest | undefined {
  const desiredCount = desiredCountOf(form.count);
  if (desiredCount === undefined) {
    return undefined;
  }
  return {
    desiredCount,
    ...(form.revision === undefined ? {} : { taskDefinition: form.revision.value }),
    ...(form.force ? { forceNewDeployment: true as const } : {}),
  };
}
