import { apisPath, servicePath } from './format';

export interface ApiGatewayEntry {
  group: 'core' | 'REST APIs' | 'HTTP and WebSocket APIs';
  name: string;
  path: string;
  built: boolean;
}

export const ENTRIES: readonly ApiGatewayEntry[] = [
  { group: 'core', name: 'APIs', path: apisPath, built: true },
  { group: 'REST APIs', name: 'Resources', path: `${servicePath}/resources`, built: false },
  { group: 'REST APIs', name: 'Stages', path: `${servicePath}/stages`, built: false },
  { group: 'REST APIs', name: 'Deployments', path: `${servicePath}/deployments`, built: false },
  { group: 'REST APIs', name: 'Authorizers', path: `${servicePath}/authorizers`, built: false },
  { group: 'REST APIs', name: 'Models', path: `${servicePath}/models`, built: false },
  { group: 'REST APIs', name: 'Request validators', path: `${servicePath}/request-validators`, built: false },
  { group: 'REST APIs', name: 'Gateway responses', path: `${servicePath}/gateway-responses`, built: false },
  { group: 'REST APIs', name: 'Documentation parts', path: `${servicePath}/documentation-parts`, built: false },
  { group: 'REST APIs', name: 'Documentation versions', path: `${servicePath}/documentation-versions`, built: false },
  { group: 'REST APIs', name: 'API keys', path: `${servicePath}/api-keys`, built: false },
  { group: 'REST APIs', name: 'Usage plans', path: `${servicePath}/usage-plans`, built: false },
  { group: 'REST APIs', name: 'Usage plan keys', path: `${servicePath}/usage-plan-keys`, built: false },
  { group: 'REST APIs', name: 'Custom domain names', path: `${servicePath}/domain-names`, built: false },
  { group: 'REST APIs', name: 'Base path mappings', path: `${servicePath}/base-path-mappings`, built: false },
  {
    group: 'REST APIs',
    name: 'Domain name access associations',
    path: `${servicePath}/domain-name-access-associations`,
    built: false,
  },
  { group: 'REST APIs', name: 'VPC links', path: `${servicePath}/vpc-links`, built: false },
  { group: 'REST APIs', name: 'Client certificates', path: `${servicePath}/client-certificates`, built: false },
  { group: 'REST APIs', name: 'Account settings', path: `${servicePath}/account`, built: false },
  { group: 'HTTP and WebSocket APIs', name: 'Routes', path: `${servicePath}/v2/routes`, built: false },
  { group: 'HTTP and WebSocket APIs', name: 'Integrations', path: `${servicePath}/v2/integrations`, built: false },
  { group: 'HTTP and WebSocket APIs', name: 'Stages', path: `${servicePath}/v2/stages`, built: false },
  { group: 'HTTP and WebSocket APIs', name: 'Deployments', path: `${servicePath}/v2/deployments`, built: false },
  {
    group: 'HTTP and WebSocket APIs',
    name: 'Route responses',
    path: `${servicePath}/v2/route-responses`,
    built: false,
  },
  {
    group: 'HTTP and WebSocket APIs',
    name: 'Integration responses',
    path: `${servicePath}/v2/integration-responses`,
    built: false,
  },
  { group: 'HTTP and WebSocket APIs', name: 'Authorizers', path: `${servicePath}/v2/authorizers`, built: false },
  { group: 'HTTP and WebSocket APIs', name: 'Models', path: `${servicePath}/v2/models`, built: false },
  {
    group: 'HTTP and WebSocket APIs',
    name: 'Custom domain names',
    path: `${servicePath}/v2/domain-names`,
    built: false,
  },
  { group: 'HTTP and WebSocket APIs', name: 'API mappings', path: `${servicePath}/v2/api-mappings`, built: false },
  { group: 'HTTP and WebSocket APIs', name: 'Routing rules', path: `${servicePath}/v2/routing-rules`, built: false },
  { group: 'HTTP and WebSocket APIs', name: 'VPC links', path: `${servicePath}/v2/vpc-links`, built: false },
  { group: 'HTTP and WebSocket APIs', name: 'Portals', path: `${servicePath}/v2/portals`, built: false },
  {
    group: 'HTTP and WebSocket APIs',
    name: 'Portal products',
    path: `${servicePath}/v2/portal-products`,
    built: false,
  },
  { group: 'HTTP and WebSocket APIs', name: 'Product pages', path: `${servicePath}/v2/product-pages`, built: false },
  {
    group: 'HTTP and WebSocket APIs',
    name: 'Product REST endpoint pages',
    path: `${servicePath}/v2/product-rest-endpoint-pages`,
    built: false,
  },
];
