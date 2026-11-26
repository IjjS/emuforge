import { expect, it } from 'vitest';

import { ROUTE_PATH_RULE, ROUTE_START, routeChanged, routeKey, validateRoute, type RouteForm } from './route-form';

const selected: RouteForm = {
  ...ROUTE_START,
  path: '/orders',
  existing: { id: 'int-1', type: 'AWS_PROXY', target: 'arn:aws:lambda:us-west-2:123456789012:function:orders' },
};

it('builds the method and path key or the default key and refuses a path without a leading slash', () => {
  expect(routeKey({ ...selected, method: 'PATCH' })).toBe('PATCH /orders');
  expect(routeKey({ ...selected, route: 'default', path: '' })).toBe('$default');
  expect(validateRoute({ ...selected, path: 'orders' })).toEqual({ errors: { path: ROUTE_PATH_RULE } });
});

it('sends only the existing integration ID, including when values for a new Lambda integration were entered', () => {
  expect(
    validateRoute({
      ...selected,
      authorization: 'AWS_IAM',
      function: { name: 'orders', arn: 'arn:aws:lambda:us-west-2:123456789012:function:orders' },
      payload: '1.0',
    }),
  ).toEqual({
    input: { key: 'GET /orders', authorization: 'AWS_IAM', integration: { kind: 'existing', id: 'int-1' } },
  });
});

it('names a missing integration, Lambda function or HTTP address', () => {
  expect(validateRoute({ ...selected, existing: undefined })).toEqual({
    errors: { existing: 'Choose an integration.' },
  });
  expect(validateRoute({ ...selected, source: 'new' })).toEqual({ errors: { function: 'Choose a Lambda function.' } });
  expect(validateRoute({ ...selected, source: 'new', kind: 'http' })).toEqual({
    errors: { address: 'Enter an HTTP address.' },
  });
});

it('treats the initial values and fields restored to those values as unchanged', () => {
  expect(routeChanged({ ...ROUTE_START })).toBe(false);
  expect(routeChanged({ ...ROUTE_START, route: 'default' })).toBe(true);
  expect(routeChanged({ ...ROUTE_START, existing: selected.existing })).toBe(true);
  expect(routeChanged({ ...ROUTE_START, address: 'https://127.0.0.1:9682/orders' })).toBe(true);
  expect(routeChanged({ ...selected, path: '', existing: undefined })).toBe(false);
});
