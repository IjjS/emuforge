import type { LambdaFunction } from './lambda-api';

export const HTTP_METHODS = [
  { value: 'ANY', label: 'ANY', description: 'Every HTTP method.' },
  { value: 'GET', label: 'GET', description: 'Read.' },
  { value: 'POST', label: 'POST', description: 'Create or submit.' },
  { value: 'PUT', label: 'PUT', description: 'Replace.' },
  { value: 'PATCH', label: 'PATCH', description: 'Change a part.' },
  { value: 'DELETE', label: 'DELETE', description: 'Remove.' },
  { value: 'HEAD', label: 'HEAD', description: 'Like GET, without a body.' },
  { value: 'OPTIONS', label: 'OPTIONS', description: 'Ask what is allowed.' },
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number]['value'];

export interface MethodResource {
  id: string;
  path: string;
}

export interface MethodForm {
  method: HttpMethod;
  authorization: 'NONE' | 'AWS_IAM';
  apiKeyRequired: boolean;
  kind: 'lambda' | 'http' | 'mock';
  function: LambdaFunction | undefined;
  allow: boolean;
  address: string;
  integrationMethod: HttpMethod;
  body: string;
}

export const METHOD_START: MethodForm = {
  method: 'GET',
  authorization: 'NONE',
  apiKeyRequired: false,
  kind: 'lambda',
  function: undefined,
  allow: true,
  address: '',
  integrationMethod: 'GET',
  body: '{"message": "ok"}',
};

type Integration =
  | { kind: 'lambda'; function: LambdaFunction; allow: boolean }
  | { kind: 'http'; address: string; method: HttpMethod }
  | { kind: 'mock'; body: string };

export interface MethodInput {
  resource: MethodResource;
  method: HttpMethod;
  authorization: MethodForm['authorization'];
  apiKeyRequired: boolean;
  integration: Integration;
}

type MethodErrors = Partial<Record<'resource' | 'function' | 'address' | 'body', string>>;

export function validateMethod(
  form: MethodForm,
  resource: MethodResource | undefined,
): { input: MethodInput } | { errors: MethodErrors } {
  const errors: MethodErrors = {};
  if (!resource) errors.resource = 'Choose a resource.';
  let integration: Integration | undefined;
  switch (form.kind) {
    case 'lambda':
      if (form.function) integration = { kind: 'lambda', function: form.function, allow: form.allow };
      else errors.function = 'Choose a Lambda function.';
      break;
    case 'http':
      if (form.address.trim()) {
        integration = { kind: 'http', address: form.address.trim(), method: form.integrationMethod };
      } else errors.address = 'Enter an HTTP address.';
      break;
    case 'mock':
      if (form.body.trim()) integration = { kind: 'mock', body: form.body };
      else errors.body = 'Enter a response body.';
      break;
  }

  if (!resource || !integration) return { errors };
  return {
    input: {
      resource,
      integration,
      method: form.method,
      authorization: form.authorization,
      apiKeyRequired: form.apiKeyRequired,
    },
  };
}

export function methodChanged(
  form: MethodForm,
  resource: MethodResource | undefined,
  linked: MethodResource | undefined,
) {
  return (
    resource?.id !== linked?.id ||
    form.function?.arn !== METHOD_START.function?.arn ||
    (Object.keys(METHOD_START) as (keyof MethodForm)[]).some(
      (key) => key !== 'function' && form[key] !== METHOD_START[key],
    )
  );
}
