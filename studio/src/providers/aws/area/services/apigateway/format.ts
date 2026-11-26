export const servicePath = '/aws/apigateway';
export const apisPath = `${servicePath}/apis`;
export const restApisPath = `${servicePath}/rest-apis`;
export const createApiPath = `${apisPath}/create`;

export const REST_API_NAME_LIMIT = 512;
export const V2_API_NAME_LIMIT = 128;

export type ApiKind = 'REST' | 'HTTP' | 'WebSocket';
export type ApiModel = 'rest' | 'v2';

export function apiKindText(protocol: 'REST' | 'HTTP' | 'WEBSOCKET'): ApiKind {
  return protocol === 'WEBSOCKET' ? 'WebSocket' : protocol;
}

export function endpointTypeText(type: string): string {
  switch (type) {
    case 'EDGE':
      return 'Edge-optimized';
    case 'REGIONAL':
      return 'Regional';
    case 'PRIVATE':
      return 'Private';
    default:
      return type;
  }
}

export function integrationTypeText(type: string): string {
  switch (type) {
    case 'AWS_PROXY':
      return 'Lambda function';
    case 'HTTP_PROXY':
      return 'HTTP endpoint';
    case 'MOCK':
      return 'Mock';
    default:
      return type;
  }
}

function queryPart(key: string, value: string | undefined): string {
  return value === undefined ? '' : `?${key}=${encodeURIComponent(value)}`;
}

export function restApiPath(id: string, show?: string): string {
  return `${apisPath}/rest/${encodeURIComponent(id)}${queryPart('show', show)}`;
}

export function v2ApiPath(id: string, show?: string): string {
  return `${apisPath}/v2/${encodeURIComponent(id)}${queryPart('show', show)}`;
}

export function createMethodPath(id: string, resourceId?: string): string {
  return `${restApiPath(id)}/methods/create${queryPart('resource', resourceId)}`;
}

export function createRoutePath(id: string): string {
  return `${v2ApiPath(id)}/routes/create`;
}
