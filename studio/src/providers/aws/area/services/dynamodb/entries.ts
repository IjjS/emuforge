import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    name: 'DynamoDB',
    entries: [
      {
        label: 'Tables',
        path: '/aws/dynamodb/tables',
        listedBy: 'ListTables',
      },
      {
        label: 'Backups',
        path: '/aws/dynamodb/backups',
        listedBy: 'ListBackups',
      },
      {
        label: 'Contributor insights',
        path: '/aws/dynamodb/contributor-insights',
        listedBy: 'ListContributorInsights',
      },
      {
        label: 'Exports',
        path: '/aws/dynamodb/exports',
        listedBy: 'ListExports',
      },
      {
        label: 'Global tables',
        path: '/aws/dynamodb/global-tables',
        listedBy: 'ListGlobalTables',
      },
      {
        label: 'Imports',
        path: '/aws/dynamodb/imports',
        listedBy: 'ListImports',
      },
    ],
  },
  {
    name: 'DynamoDB Accelerator (DAX)',
    subService: {
      name: 'DynamoDB Accelerator (DAX)',
      path: '/aws/dynamodb/dax',
    },
    entries: [
      {
        label: 'Clusters',
        path: '/aws/dynamodb/clusters',
        listedBy: 'DescribeClusters',
      },
      {
        label: 'Parameter groups',
        path: '/aws/dynamodb/parameter-groups',
        listedBy: 'DescribeParameterGroups',
      },
      {
        label: 'Subnet groups',
        path: '/aws/dynamodb/subnet-groups',
        listedBy: 'DescribeSubnetGroups',
      },
    ],
  },
];
