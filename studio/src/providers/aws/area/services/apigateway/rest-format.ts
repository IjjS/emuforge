import type { Integration, Resource } from '@aws-sdk/client-api-gateway';

import { integrationTypeText } from './format';

export function orderedResources(resources: readonly Resource[]) {
  return [...resources]
    .sort((first, second) => (first.path ?? '').localeCompare(second.path ?? ''))
    .map((resource) => ({
      resource,
      depth: resource.path?.split('/').filter(Boolean).length ?? 0,
    }));
}

interface RestIntegration {
  kind: string;
  target?: string | undefined;
  label?: string;
}

export function restIntegration(integration: Integration | undefined): RestIntegration {
  if (integration === undefined) return { kind: 'No integration' };

  const { type, uri } = integration;
  if (type === 'MOCK') return { kind: integrationTypeText(type) };
  if (type === 'HTTP' || type === 'HTTP_PROXY') {
    return { kind: integrationTypeText('HTTP_PROXY'), target: uri, label: 'HTTP address' };
  }
  const arn =
    /^(?:arn:[^:]+:apigateway:[^:]+:lambda:path\/[^/]+\/functions\/)?(arn:[^:]+:lambda:[^:]+:[^:]+:function:[^/]+)(?:\/invocations)?$/.exec(
      uri ?? '',
    )?.[1];
  if ((type === 'AWS' || type === 'AWS_PROXY') && arn !== undefined) {
    return { kind: integrationTypeText('AWS_PROXY'), target: arn, label: 'Lambda function ARN' };
  }
  return { kind: type ?? '-', target: uri, label: 'Integration URI' };
}
