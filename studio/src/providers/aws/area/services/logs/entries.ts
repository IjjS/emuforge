import type { EntryGroup } from '../../entries';
import { LOG_GROUPS_PATH, LOG_STREAMS_PATH } from './format';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'Log groups',
        path: LOG_GROUPS_PATH,
        listedBy: 'ListLogGroups',
      },
      {
        label: 'Log streams',
        path: LOG_STREAMS_PATH,
        listedBy: 'DescribeLogStreams',
        listedInside: LOG_GROUPS_PATH,
      },
      {
        label: 'Deliveries',
        path: '/aws/logs/deliveries',
        listedBy: 'DescribeDeliveries',
      },
      {
        label: 'Delivery destinations',
        path: '/aws/logs/delivery-destinations',
        listedBy: 'DescribeDeliveryDestinations',
      },
      {
        label: 'Delivery sources',
        path: '/aws/logs/delivery-sources',
        listedBy: 'DescribeDeliverySources',
      },
      {
        label: 'Destinations',
        path: '/aws/logs/destinations',
        listedBy: 'DescribeDestinations',
      },
      {
        label: 'Export tasks',
        path: '/aws/logs/export-tasks',
        listedBy: 'DescribeExportTasks',
      },
      {
        label: 'Import tasks',
        path: '/aws/logs/import-tasks',
        listedBy: 'DescribeImportTasks',
      },
      {
        label: 'Index policies',
        path: '/aws/logs/index-policies',
        listedBy: 'DescribeIndexPolicies',
        listedInside: LOG_GROUPS_PATH,
      },
      {
        label: 'Integrations',
        path: '/aws/logs/integrations',
        listedBy: 'ListIntegrations',
      },
      {
        label: 'Log anomaly detectors',
        path: '/aws/logs/log-anomaly-detectors',
        listedBy: 'ListLogAnomalyDetectors',
      },
      {
        label: 'Lookup tables',
        path: '/aws/logs/lookup-tables',
        listedBy: 'DescribeLookupTables',
      },
      {
        label: 'Metric filters',
        path: '/aws/logs/metric-filters',
        listedBy: 'DescribeMetricFilters',
      },
      {
        label: 'Queries',
        path: '/aws/logs/queries',
        listedBy: 'DescribeQueries',
      },
      {
        label: 'Query definitions',
        path: '/aws/logs/query-definitions',
        listedBy: 'DescribeQueryDefinitions',
      },
      {
        label: 'Resource policies',
        path: '/aws/logs/resource-policies',
        listedBy: 'DescribeResourcePolicies',
      },
      {
        label: 'Scheduled queries',
        path: '/aws/logs/scheduled-queries',
        listedBy: 'ListScheduledQueries',
      },
      {
        label: 'Subscription filters',
        path: '/aws/logs/subscription-filters',
        listedBy: 'DescribeSubscriptionFilters',
        listedInside: LOG_GROUPS_PATH,
      },
    ],
  },
];
