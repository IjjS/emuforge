import type { LambdaFunction } from './lambda-api';
import type { HttpMethod } from './method-form';

export const ROUTE_PATH_RULE = 'The path must begin with /.';

export interface IntegrationChoice {
  id: string;
  type: string | undefined;
  target: string | undefined;
}

export interface RouteForm {
  route: 'default' | 'method';
  method: HttpMethod;
  path: string;
  authorization: 'NONE' | 'AWS_IAM';
  source: 'existing' | 'new';
  existing: IntegrationChoice | undefined;
  kind: 'lambda' | 'http';
  function: LambdaFunction | undefined;
  payload: '2.0' | '1.0';
  allow: boolean;
  address: string;
  integrationMethod: HttpMethod;
}

export const ROUTE_START: RouteForm = {
  route: 'method',
  method: 'GET',
  path: '',
  authorization: 'NONE',
  source: 'existing',
  existing: undefined,
  kind: 'lambda',
  function: undefined,
  payload: '2.0',
  allow: true,
  address: '',
  integrationMethod: 'GET',
};

type Integration =
  | { kind: 'existing'; id: string }
  | { kind: 'lambda'; function: LambdaFunction; payload: RouteForm['payload']; allow: boolean }
  | { kind: 'http'; address: string; method: HttpMethod };

export interface RouteInput {
  key: string;
  authorization: RouteForm['authorization'];
  integration: Integration;
}

type RouteErrors = Partial<Record<'path' | 'existing' | 'function' | 'address', string>>;

export function routeKey(form: RouteForm): string | undefined {
  if (form.route === 'default') return '$default';
  const path = form.path.trim();
  return path.startsWith('/') ? `${form.method} ${path}` : undefined;
}

export function validateRoute(form: RouteForm): { input: RouteInput } | { errors: RouteErrors } {
  const key = routeKey(form);
  const errors: RouteErrors = {};
  if (key === undefined) errors.path = ROUTE_PATH_RULE;

  let integration: Integration | undefined;
  if (form.source === 'existing') {
    if (form.existing) integration = { kind: 'existing', id: form.existing.id };
    else errors.existing = 'Choose an integration.';
  } else if (form.kind === 'lambda') {
    if (form.function) {
      integration = { kind: 'lambda', function: form.function, payload: form.payload, allow: form.allow };
    } else errors.function = 'Choose a Lambda function.';
  } else {
    const address = form.address.trim();
    if (address) integration = { kind: 'http', address, method: form.integrationMethod };
    else errors.address = 'Enter an HTTP address.';
  }

  return key !== undefined && integration
    ? { input: { key, authorization: form.authorization, integration } }
    : { errors };
}

export function routeChanged(form: RouteForm): boolean {
  return (Object.keys(ROUTE_START) as (keyof RouteForm)[]).some((key) => form[key] !== ROUTE_START[key]);
}
