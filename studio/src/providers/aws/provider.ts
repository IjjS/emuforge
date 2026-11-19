import type { Provider } from '../../app/provider-list';
import { AWS_NAME, AWS_SEGMENT, AWS_SHORT_NAME, servicePath } from './identity';
import { SERVICES } from './services';

/**
 * The AWS entry of Studio's providers list. Plain data: its area, with Cloudscape and its styles, is loaded with a
 * dynamic `import()` only when a path under `/aws` is opened.
 */
export const AWS_PROVIDER: Provider = {
  name: AWS_NAME,
  shortName: AWS_SHORT_NAME,
  segment: AWS_SEGMENT,
  services: SERVICES.map((service) => ({
    label: service.label,
    path: servicePath(service),
    hasScreen: service.hasScreen,
  })),
  loadArea: () => import('./area'),
};
