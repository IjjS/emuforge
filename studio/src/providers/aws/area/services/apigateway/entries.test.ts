import { expect, it } from 'vitest';

import { entryFaults, entryHasScreen, ENTRY_FOLDERS } from '../../entries';
import { SCREENS } from '../../screens';
import { ENTRIES } from './entries';

const service = '/apigateway';
const prefix = '/aws/apigateway/';
const entries = ENTRIES.flatMap((group) => group.entries);

it('registers both API models and the v2 sub-service with the area', () => {
  expect(ENTRIES.map(({ name, subService }) => [name, subService])).toEqual([
    ['API Gateway', undefined],
    ['HTTP and WebSocket APIs', { name: 'HTTP and WebSocket APIs', path: '/aws/apigateway/v2' }],
  ]);
  const folders = ENTRY_FOLDERS.filter(({ folder }) => folder === 'apigateway');
  expect(folders).toEqual([{ folder: 'apigateway', groups: ENTRIES }]);
  expect(entryFaults(folders, SCREENS)).toEqual([]);
});

it('gives every kind its label, address, list operation and parent in the model order', () => {
  expect(
    ENTRIES.map(({ entries }) =>
      entries.map(({ label, path, listedBy, listedInside }) => [
        label,
        path.replace(prefix, ''),
        listedBy,
        ...(listedInside === undefined ? [] : [listedInside.replace(prefix, '')]),
      ]),
    ),
  ).toEqual([
    [
      ['REST APIs', 'rest-apis', 'GetRestApis'],
      ['Resources', 'resources', 'GetResources', 'rest-apis'],
      ['Stages', 'stages', 'GetStages', 'rest-apis'],
      ['API keys', 'api-keys', 'GetApiKeys'],
      ['Authorizers', 'authorizers', 'GetAuthorizers', 'rest-apis'],
      ['Base path mappings', 'base-path-mappings', 'GetBasePathMappings', 'domain-names'],
      ['Client certificates', 'client-certificates', 'GetClientCertificates'],
      ['Deployments', 'deployments', 'GetDeployments', 'rest-apis'],
      ['Documentation parts', 'documentation-parts', 'GetDocumentationParts', 'rest-apis'],
      ['Documentation versions', 'documentation-versions', 'GetDocumentationVersions', 'rest-apis'],
      ['Domain name access associations', 'domain-name-access-associations', 'GetDomainNameAccessAssociations'],
      ['Domain names', 'domain-names', 'GetDomainNames'],
      ['Gateway responses', 'gateway-responses', 'GetGatewayResponses', 'rest-apis'],
      ['Models', 'models', 'GetModels', 'rest-apis'],
      ['Request validators', 'request-validators', 'GetRequestValidators', 'rest-apis'],
      ['Usage plan keys', 'usage-plan-keys', 'GetUsagePlanKeys', 'usage-plans'],
      ['Usage plans', 'usage-plans', 'GetUsagePlans'],
      ['VPC links', 'vpc-links', 'GetVpcLinks'],
    ],
    [
      ['APIs', 'apis', 'GetApis'],
      ['Routes', 'routes', 'GetRoutes', 'apis'],
      ['Integrations', 'integrations', 'GetIntegrations', 'apis'],
      ['V2 stages', 'v2-stages', 'GetStages', 'apis'],
      ['API mappings', 'api-mappings', 'GetApiMappings', 'v2-domain-names'],
      ['Integration responses', 'integration-responses', 'GetIntegrationResponses', 'integrations'],
      ['Portal products', 'portal-products', 'ListPortalProducts'],
      ['Portals', 'portals', 'ListPortals'],
      ['Route responses', 'route-responses', 'GetRouteResponses', 'routes'],
      ['Routing rules', 'routing-rules', 'ListRoutingRules', 'v2-domain-names'],
      ['V2 authorizers', 'v2-authorizers', 'GetAuthorizers', 'apis'],
      ['V2 deployments', 'v2-deployments', 'GetDeployments', 'apis'],
      ['V2 domain names', 'v2-domain-names', 'GetDomainNames'],
      ['V2 models', 'v2-models', 'GetModels', 'apis'],
      ['V2 VPC links', 'v2-vpc-links', 'GetVpcLinks'],
    ],
  ]);
});

it('uses unique labels and paths, with built entries before the rest in each group', () => {
  expect(new Set(entries.map(({ label }) => label)).size).toBe(entries.length);
  expect(new Set(entries.map(({ path }) => path)).size).toBe(entries.length);
  for (const { entries } of ENTRIES) {
    const built = entries.filter(({ path }) => entryHasScreen(SCREENS, service, path));
    const unbuilt = entries
      .filter(({ path }) => !entryHasScreen(SCREENS, service, path))
      .toSorted((a, b) => a.label.localeCompare(b.label, 'en'));
    expect(entries).toEqual([...built, ...unbuilt]);
  }
});
