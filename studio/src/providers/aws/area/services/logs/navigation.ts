import type { ScreenNavigation } from '../../screens';
import { LOG_EVENTS_PATH, LOG_GROUPS_PATH, LOG_STREAMS_PATH, LOGS_PATH } from './format';

export const LOGS_ENTRIES = [
  { text: 'Log groups', href: LOG_GROUPS_PATH, section: 'Log data' },
  { text: 'Log streams', href: LOG_STREAMS_PATH, section: 'Log data' },
  { text: 'Log events', href: LOG_EVENTS_PATH, section: 'Log data' },
  { text: 'Log group fields', href: `${LOGS_PATH}/log-group-fields`, section: 'Log data' },
  { text: 'Log fields', href: `${LOGS_PATH}/log-fields`, section: 'Log data' },
  { text: 'Log group summaries', href: `${LOGS_PATH}/log-group-summaries`, section: 'Log data' },
  { text: 'Live Tail', href: `${LOGS_PATH}/live-tail`, section: 'Log data' },
  { text: 'Logs Insights queries', href: `${LOGS_PATH}/queries`, section: 'Queries' },
  { text: 'Query results', href: `${LOGS_PATH}/query-results`, section: 'Queries' },
  { text: 'Query definitions', href: `${LOGS_PATH}/query-definitions`, section: 'Queries' },
  { text: 'Scheduled queries', href: `${LOGS_PATH}/scheduled-queries`, section: 'Queries' },
  { text: 'Scheduled query history', href: `${LOGS_PATH}/scheduled-query-history`, section: 'Queries' },
  { text: 'Metric filters', href: `${LOGS_PATH}/metric-filters`, section: 'Monitoring' },
  { text: 'Subscription filters', href: `${LOGS_PATH}/subscription-filters`, section: 'Monitoring' },
  { text: 'Anomaly detectors', href: `${LOGS_PATH}/anomaly-detectors`, section: 'Monitoring' },
  { text: 'Anomalies', href: `${LOGS_PATH}/anomalies`, section: 'Monitoring' },
  { text: 'Account policies', href: `${LOGS_PATH}/account-policies`, section: 'Policies and processing' },
  {
    text: 'Data protection policies',
    href: `${LOGS_PATH}/data-protection-policies`,
    section: 'Policies and processing',
  },
  { text: 'Destinations', href: `${LOGS_PATH}/destinations`, section: 'Delivery and data transfer' },
  { text: 'Deliveries', href: `${LOGS_PATH}/deliveries`, section: 'Delivery and data transfer' },
  { text: 'Delivery sources', href: `${LOGS_PATH}/delivery-sources`, section: 'Delivery and data transfer' },
  { text: 'Delivery destinations', href: `${LOGS_PATH}/delivery-destinations`, section: 'Delivery and data transfer' },
  {
    text: 'Delivery destination policies',
    href: `${LOGS_PATH}/delivery-destination-policies`,
    section: 'Delivery and data transfer',
  },
  {
    text: 'Delivery configuration templates',
    href: `${LOGS_PATH}/configuration-templates`,
    section: 'Delivery and data transfer',
  },
  { text: 'Export tasks', href: `${LOGS_PATH}/export-tasks`, section: 'Delivery and data transfer' },
  { text: 'Import tasks', href: `${LOGS_PATH}/import-tasks`, section: 'Delivery and data transfer' },
  { text: 'Import task batches', href: `${LOGS_PATH}/import-task-batches`, section: 'Delivery and data transfer' },
  { text: 'Resource policies', href: `${LOGS_PATH}/resource-policies`, section: 'Policies and processing' },
  { text: 'Index policies', href: `${LOGS_PATH}/index-policies`, section: 'Policies and processing' },
  { text: 'Field indexes', href: `${LOGS_PATH}/field-indexes`, section: 'Policies and processing' },
  { text: 'Transformers', href: `${LOGS_PATH}/transformers`, section: 'Policies and processing' },
  { text: 'Integrations', href: `${LOGS_PATH}/integrations`, section: 'Delivery and data transfer' },
  {
    text: 'S3 table integration sources',
    href: `${LOGS_PATH}/s3-table-integration-sources`,
    section: 'Delivery and data transfer',
  },
  { text: 'Lookup tables', href: `${LOGS_PATH}/lookup-tables`, section: 'Delivery and data transfer' },
  { text: 'Syslog configurations', href: `${LOGS_PATH}/syslog-configurations`, section: 'Policies and processing' },
  { text: 'Storage tier policy', href: `${LOGS_PATH}/storage-tier-policy`, section: 'Policies and processing' },
] as const;

const sections = [...new Set(LOGS_ENTRIES.map(({ section }) => section))];

export function logsNavigation(activeHref: string): ScreenNavigation {
  return {
    header: { text: 'CloudWatch Logs', href: LOGS_PATH },
    items: sections.map((section) => ({
      type: 'section',
      text: section,
      items: LOGS_ENTRIES.filter((entry) => entry.section === section).map(({ text, href }) => ({
        type: 'link',
        text,
        href,
      })),
    })),
    activeHref,
  };
}
