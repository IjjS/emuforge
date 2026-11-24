import { describe, expect, it } from 'vitest';

import {
  endpointName,
  publishTabHref,
  settingsTabHref,
  subscribeHref,
  tabOf,
  topicHref,
  topicName,
  topicType,
} from './format';

const ARN = 'arn:aws:sns:us-east-1:000000000000:orders';

describe('format', () => {
  it("a topic's name is its ARN's text after the last colon; .fifo names are FIFO, the others Standard", () => {
    expect(topicName(ARN)).toBe('orders');
    expect(topicName('arn:aws:sns:us-east-1:000000000000:o.fifo')).toBe('o.fifo');
    expect(topicType('o.fifo')).toBe('FIFO');
    expect(topicType('orders')).toBe('Standard');
    expect(topicType('fifo')).toBe('Standard');
  });

  it("a topic's page holds its ARN percent-encoded as one segment; subscribe and publish addresses follow it", () => {
    const encoded = 'arn%3Aaws%3Asns%3Aus-east-1%3A000000000000%3Aorders';
    expect(topicHref(ARN)).toBe(`/aws/sns/topics/topic/${encoded}`);
    expect(topicHref('arn:x/y')).toBe('/aws/sns/topics/topic/arn%3Ax%2Fy');
    expect(subscribeHref(ARN)).toBe(`/aws/sns/topics/topic/${encoded}/subscribe`);
    expect(publishTabHref(ARN)).toBe(`/aws/sns/topics/topic/${encoded}?tab=publish`);
  });

  it('the query publish names "Publish"; none and any other value "Subscriptions"', () => {
    expect(tabOf('publish')).toBe('publish');
    expect(tabOf(null)).toBe('subscriptions');
    expect(tabOf(undefined)).toBe('subscriptions');
    expect(tabOf('')).toBe('subscriptions');
    expect(tabOf('Publish')).toBe('subscriptions');
    expect(tabOf('subscriptions')).toBe('subscriptions');
  });

  it('addresses Settings with the topic ARN encoded once', () => {
    expect(settingsTabHref(ARN)).toBe(
      '/aws/sns/topics/topic/arn%3Aaws%3Asns%3Aus-east-1%3A000000000000%3Aorders?tab=settings',
    );
  });

  it('selects Settings from the settings parameter', () => {
    expect(tabOf('settings')).toBe('settings');
  });

  it("an endpoint's name from a queue's or a function's ARN", () => {
    expect(endpointName('arn:aws:sqs:us-east-1:000000000000:jobs')).toBe('jobs');
    expect(endpointName('arn:aws:sqs:us-east-1:000000000000:jobs.fifo')).toBe('jobs.fifo');
    expect(endpointName('arn:aws:lambda:us-east-1:000000000000:function:printer')).toBe('printer');
    expect(endpointName('arn:aws:lambda:us-east-1:000000000000:function:printer:live')).toBe('printer');
  });
});
