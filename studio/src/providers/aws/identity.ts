import type { Service } from './services';

/** The provider's name, as the AWS console and the area's header give it. */
export const AWS_NAME = 'Amazon Web Services';

/** The provider's name in Studio's frame. */
export const AWS_SHORT_NAME = 'AWS';

/** The AWS area's first path segment: everything at `/aws` and below is the area's. */
export const AWS_SEGMENT = 'aws';

/** The AWS area's index. */
export const AWS_PATH = `/${AWS_SEGMENT}`;

/** A service's page in the AWS area: the area's path followed by the service's route (`/aws/s3`). */
export function servicePath(service: Service): string {
  return `${AWS_PATH}${service.route}`;
}
