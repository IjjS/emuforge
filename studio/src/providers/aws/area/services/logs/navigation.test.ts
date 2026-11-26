import { describe, expect, it } from 'vitest';

import { LOGS_ENTRIES, logsNavigation } from './navigation';

const requiredEntries = [
  { text: 'Log groups', href: '/aws/logs/log-groups' },
  { text: 'Log streams', href: '/aws/logs/log-streams' },
  { text: 'Log events', href: '/aws/logs/log-events' },
  { text: 'Log group fields', href: '/aws/logs/log-group-fields' },
  { text: 'Log fields', href: '/aws/logs/log-fields' },
  { text: 'Log group summaries', href: '/aws/logs/log-group-summaries' },
  { text: 'Live Tail', href: '/aws/logs/live-tail' },
  { text: 'Logs Insights queries', href: '/aws/logs/queries' },
  { text: 'Query results', href: '/aws/logs/query-results' },
  { text: 'Query definitions', href: '/aws/logs/query-definitions' },
  { text: 'Scheduled queries', href: '/aws/logs/scheduled-queries' },
  { text: 'Scheduled query history', href: '/aws/logs/scheduled-query-history' },
  { text: 'Metric filters', href: '/aws/logs/metric-filters' },
  { text: 'Subscription filters', href: '/aws/logs/subscription-filters' },
  { text: 'Anomaly detectors', href: '/aws/logs/anomaly-detectors' },
  { text: 'Anomalies', href: '/aws/logs/anomalies' },
  { text: 'Account policies', href: '/aws/logs/account-policies' },
  { text: 'Data protection policies', href: '/aws/logs/data-protection-policies' },
  { text: 'Destinations', href: '/aws/logs/destinations' },
  { text: 'Deliveries', href: '/aws/logs/deliveries' },
  { text: 'Delivery sources', href: '/aws/logs/delivery-sources' },
  { text: 'Delivery destinations', href: '/aws/logs/delivery-destinations' },
  { text: 'Delivery destination policies', href: '/aws/logs/delivery-destination-policies' },
  { text: 'Delivery configuration templates', href: '/aws/logs/configuration-templates' },
  { text: 'Export tasks', href: '/aws/logs/export-tasks' },
  { text: 'Import tasks', href: '/aws/logs/import-tasks' },
  { text: 'Import task batches', href: '/aws/logs/import-task-batches' },
  { text: 'Resource policies', href: '/aws/logs/resource-policies' },
  { text: 'Index policies', href: '/aws/logs/index-policies' },
  { text: 'Field indexes', href: '/aws/logs/field-indexes' },
  { text: 'Transformers', href: '/aws/logs/transformers' },
  { text: 'Integrations', href: '/aws/logs/integrations' },
  { text: 'S3 table integration sources', href: '/aws/logs/s3-table-integration-sources' },
  { text: 'Lookup tables', href: '/aws/logs/lookup-tables' },
  { text: 'Syslog configurations', href: '/aws/logs/syslog-configurations' },
  { text: 'Storage tier policy', href: '/aws/logs/storage-tier-policy' },
];

describe('CloudWatch Logs navigation', () => {
  it('includes every entry and exact path of the requirement', () => {
    expect(LOGS_ENTRIES.map(({ text, href }) => ({ text, href }))).toEqual(expect.arrayContaining(requiredEntries));
  });

  it('gives each entry a unique text and a unique path below the service', () => {
    const labels = LOGS_ENTRIES.map(({ text }) => text);
    const paths = LOGS_ENTRIES.map(({ href }) => href);
    expect(labels.every((label) => label.trim() !== '')).toBe(true);
    expect(paths.every((path) => path.startsWith('/aws/logs/'))).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('links its header to the service and marks the screen entry current', () => {
    expect(logsNavigation('/aws/logs/log-groups')).toMatchObject({
      header: { text: 'CloudWatch Logs', href: '/aws/logs' },
      activeHref: '/aws/logs/log-groups',
    });
    expect(logsNavigation('/aws/logs/log-events').activeHref).toBe('/aws/logs/log-events');
  });
});
