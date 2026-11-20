import { expect, it } from 'vitest';

import { CREATE_SERVICE_START, createServiceMessages, createServiceRequestOf } from './create-service-form';

const filled = {
  ...CREATE_SERVICE_START,
  name: 'api',
  family: 'web',
  revision: { family: 'web', revision: 2, value: 'web:2' },
  subnets: [{ id: 'subnet-a' }, { id: 'subnet-b' }],
  groups: [{ id: 'sg-a' }, { id: 'sg-b' }],
};

it.each(['', '  '])('reports the required choices and a blank service name (%j)', (name) => {
  expect(createServiceMessages({ ...CREATE_SERVICE_START, name })).toEqual({
    name: 'Enter a service name.',
    family: 'Choose a task definition family.',
    revision: 'Choose a revision.',
    subnets: 'Choose at least one subnet.',
  });
});

it.each(['', '-1', '1.5', 'abc'])('rejects the desired count %j', (count) => {
  const form = { ...filled, count };
  expect(createServiceMessages(form)).toEqual({ count: 'Enter a whole number, 0 or more.' });
  expect(createServiceRequestOf('dev', form)).toBeUndefined();
});

it.each(['0', '2'])('sends all configuration with desired count %s', (count) => {
  expect(createServiceRequestOf('dev', { ...filled, count })).toEqual({
    cluster: 'dev',
    serviceName: 'api',
    taskDefinition: 'web:2',
    desiredCount: Number(count),
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: ['subnet-a', 'subnet-b'],
        securityGroups: ['sg-a', 'sg-b'],
        assignPublicIp: 'ENABLED',
      },
    },
  });
});

it('disables public IP and omits an empty optional group selection', () => {
  expect(createServiceRequestOf('dev', { ...filled, publicIp: false, groups: [] })?.networkConfiguration).toEqual({
    awsvpcConfiguration: { subnets: ['subnet-a', 'subnet-b'], assignPublicIp: 'DISABLED' },
  });
});
