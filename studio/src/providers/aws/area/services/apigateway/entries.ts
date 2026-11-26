import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    name: 'API Gateway',
    entries: [
      {
        label: 'REST APIs',
        path: '/aws/apigateway/rest-apis',
        listedBy: 'GetRestApis',
      },
      {
        label: 'Resources',
        path: '/aws/apigateway/resources',
        listedBy: 'GetResources',
        listedInside: '/aws/apigateway/rest-apis',
      },
      {
        label: 'Stages',
        path: '/aws/apigateway/stages',
        listedBy: 'GetStages',
        listedInside: '/aws/apigateway/rest-apis',
      },
      {
        label: 'API keys',
        path: '/aws/apigateway/api-keys',
        listedBy: 'GetApiKeys',
      },
      {
        label: 'Authorizers',
        path: '/aws/apigateway/authorizers',
        listedBy: 'GetAuthorizers',
        listedInside: '/aws/apigateway/rest-apis',
      },
      {
        label: 'Base path mappings',
        path: '/aws/apigateway/base-path-mappings',
        listedBy: 'GetBasePathMappings',
        listedInside: '/aws/apigateway/domain-names',
      },
      {
        label: 'Client certificates',
        path: '/aws/apigateway/client-certificates',
        listedBy: 'GetClientCertificates',
      },
      {
        label: 'Deployments',
        path: '/aws/apigateway/deployments',
        listedBy: 'GetDeployments',
        listedInside: '/aws/apigateway/rest-apis',
      },
      {
        label: 'Documentation parts',
        path: '/aws/apigateway/documentation-parts',
        listedBy: 'GetDocumentationParts',
        listedInside: '/aws/apigateway/rest-apis',
      },
      {
        label: 'Documentation versions',
        path: '/aws/apigateway/documentation-versions',
        listedBy: 'GetDocumentationVersions',
        listedInside: '/aws/apigateway/rest-apis',
      },
      {
        label: 'Domain name access associations',
        path: '/aws/apigateway/domain-name-access-associations',
        listedBy: 'GetDomainNameAccessAssociations',
      },
      {
        label: 'Domain names',
        path: '/aws/apigateway/domain-names',
        listedBy: 'GetDomainNames',
      },
      {
        label: 'Gateway responses',
        path: '/aws/apigateway/gateway-responses',
        listedBy: 'GetGatewayResponses',
        listedInside: '/aws/apigateway/rest-apis',
      },
      {
        label: 'Models',
        path: '/aws/apigateway/models',
        listedBy: 'GetModels',
        listedInside: '/aws/apigateway/rest-apis',
      },
      {
        label: 'Request validators',
        path: '/aws/apigateway/request-validators',
        listedBy: 'GetRequestValidators',
        listedInside: '/aws/apigateway/rest-apis',
      },
      {
        label: 'Usage plan keys',
        path: '/aws/apigateway/usage-plan-keys',
        listedBy: 'GetUsagePlanKeys',
        listedInside: '/aws/apigateway/usage-plans',
      },
      {
        label: 'Usage plans',
        path: '/aws/apigateway/usage-plans',
        listedBy: 'GetUsagePlans',
      },
      {
        label: 'VPC links',
        path: '/aws/apigateway/vpc-links',
        listedBy: 'GetVpcLinks',
      },
    ],
  },
  {
    name: 'HTTP and WebSocket APIs',
    subService: {
      name: 'HTTP and WebSocket APIs',
      path: '/aws/apigateway/v2',
    },
    entries: [
      {
        label: 'APIs',
        path: '/aws/apigateway/apis',
        listedBy: 'GetApis',
      },
      {
        label: 'Routes',
        path: '/aws/apigateway/routes',
        listedBy: 'GetRoutes',
        listedInside: '/aws/apigateway/apis',
      },
      {
        label: 'Integrations',
        path: '/aws/apigateway/integrations',
        listedBy: 'GetIntegrations',
        listedInside: '/aws/apigateway/apis',
      },
      {
        label: 'V2 stages',
        path: '/aws/apigateway/v2-stages',
        listedBy: 'GetStages',
        listedInside: '/aws/apigateway/apis',
      },
      {
        label: 'API mappings',
        path: '/aws/apigateway/api-mappings',
        listedBy: 'GetApiMappings',
        listedInside: '/aws/apigateway/v2-domain-names',
      },
      {
        label: 'Integration responses',
        path: '/aws/apigateway/integration-responses',
        listedBy: 'GetIntegrationResponses',
        listedInside: '/aws/apigateway/integrations',
      },
      {
        label: 'Portal products',
        path: '/aws/apigateway/portal-products',
        listedBy: 'ListPortalProducts',
      },
      {
        label: 'Portals',
        path: '/aws/apigateway/portals',
        listedBy: 'ListPortals',
      },
      {
        label: 'Route responses',
        path: '/aws/apigateway/route-responses',
        listedBy: 'GetRouteResponses',
        listedInside: '/aws/apigateway/routes',
      },
      {
        label: 'Routing rules',
        path: '/aws/apigateway/routing-rules',
        listedBy: 'ListRoutingRules',
        listedInside: '/aws/apigateway/v2-domain-names',
      },
      {
        label: 'V2 authorizers',
        path: '/aws/apigateway/v2-authorizers',
        listedBy: 'GetAuthorizers',
        listedInside: '/aws/apigateway/apis',
      },
      {
        label: 'V2 deployments',
        path: '/aws/apigateway/v2-deployments',
        listedBy: 'GetDeployments',
        listedInside: '/aws/apigateway/apis',
      },
      {
        label: 'V2 domain names',
        path: '/aws/apigateway/v2-domain-names',
        listedBy: 'GetDomainNames',
      },
      {
        label: 'V2 models',
        path: '/aws/apigateway/v2-models',
        listedBy: 'GetModels',
        listedInside: '/aws/apigateway/apis',
      },
      {
        label: 'V2 VPC links',
        path: '/aws/apigateway/v2-vpc-links',
        listedBy: 'GetVpcLinks',
      },
    ],
  },
];
