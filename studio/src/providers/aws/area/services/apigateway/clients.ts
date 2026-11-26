import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../../lib/aws/request';

export function sendRest<T>(
  endpoint: string,
  operation: string,
  send: (client: APIGatewayClient, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abort) => send(createAwsClient(APIGatewayClient, { endpoint }), abort), signal);
}

export function sendV2<T>(
  endpoint: string,
  operation: string,
  send: (client: ApiGatewayV2Client, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abort) => send(createAwsClient(ApiGatewayV2Client, { endpoint }), abort), signal);
}
