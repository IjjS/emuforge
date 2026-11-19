import { AWS_PATH } from '../../identity';

// The addresses in Studio of a queue's and a function's page and of their create forms (issue 536, design "What is
// shared"), lifted from SQS's and Lambda's `format.ts` when SNS became their second user. Each is written once here;
// SQS's and Lambda's `format.ts` export them again under the same names.

/** SQS's route in the area, `/aws/sqs`. */
export const SQS_PATH = `${AWS_PATH}/sqs`;

/** SQS's S1, the queue list. */
export const QUEUES_PATH = `${SQS_PATH}/queues`;

/** SQS's "Create queue" (issue 489). */
export const CREATE_QUEUE_PATH = `${QUEUES_PATH}/create`;

/** SQS's S2, a queue's page; its name is one segment below `queue/`. */
export function queuePath(name: string): string {
  return `${QUEUES_PATH}/queue/${encodeURIComponent(name)}`;
}

/** Lambda's route in the area, `/aws/lambda`. */
export const LAMBDA_PATH = `${AWS_PATH}/lambda`;

/** Lambda's function list, "Event Functions". */
export const FUNCTIONS_PATH = `${LAMBDA_PATH}/functions`;

/** Lambda's "Create Event Function". */
export const CREATE_FUNCTION_PATH = `${FUNCTIONS_PATH}/create`;

/** A function's own page; the segment `function/` keeps a function named `create` off the create form's route. */
export function functionPath(name: string): string {
  return `${FUNCTIONS_PATH}/function/${encodeURIComponent(name)}`;
}
