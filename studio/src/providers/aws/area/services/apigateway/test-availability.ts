import type { Integration } from '@aws-sdk/client-api-gateway';

import { restIntegration } from './rest-format';

export function testUnavailableReason(integration: Integration | undefined): string | undefined {
  if (integration === undefined) return undefined;
  if (integration.connectionType === 'VPC_LINK') {
    return 'Test is not offered for an integration through a VPC link: where the emulator sends it has not been verified.';
  }

  switch (integration.type) {
    case 'MOCK':
    case 'HTTP':
    case 'HTTP_PROXY':
      return undefined;
    case 'AWS':
    case 'AWS_PROXY':
      return restIntegration(integration).label === 'Lambda function ARN'
        ? undefined
        : 'Test is not offered for an AWS service integration other than Lambda: where the emulator sends it has not been verified.';
    default:
      return `Test is offered for mock, Lambda and HTTP integrations. This method's integration is of type ${integration.type ?? '-'}.`;
  }
}
