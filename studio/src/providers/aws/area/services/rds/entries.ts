import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'DB instances',
        path: '/aws/rds/instances',
        listedBy: 'DescribeDBInstances',
      },
      {
        label: 'DB clusters',
        path: '/aws/rds/clusters',
        listedBy: 'DescribeDBClusters',
      },
      {
        label: 'DB cluster snapshots',
        path: '/aws/rds/cluster-snapshots',
        listedBy: 'DescribeDBClusterSnapshots',
      },
      {
        label: 'Blue green deployments',
        path: '/aws/rds/blue-green-deployments',
        listedBy: 'DescribeBlueGreenDeployments',
      },
      {
        label: 'DB cluster backtracks',
        path: '/aws/rds/db-cluster-backtracks',
        listedBy: 'DescribeDBClusterBacktracks',
        listedInside: '/aws/rds/clusters',
      },
      {
        label: 'DB cluster endpoints',
        path: '/aws/rds/db-cluster-endpoints',
        listedBy: 'DescribeDBClusterEndpoints',
      },
      {
        label: 'DB cluster parameter groups',
        path: '/aws/rds/db-cluster-parameter-groups',
        listedBy: 'DescribeDBClusterParameterGroups',
      },
      {
        label: 'DB engine versions',
        path: '/aws/rds/db-engine-versions',
        listedBy: 'DescribeDBEngineVersions',
      },
      {
        label: 'DB instance automated backups',
        path: '/aws/rds/db-instance-automated-backups',
        listedBy: 'DescribeDBInstanceAutomatedBackups',
      },
      {
        label: 'DB parameter groups',
        path: '/aws/rds/db-parameter-groups',
        listedBy: 'DescribeDBParameterGroups',
      },
      {
        label: 'DB proxies',
        path: '/aws/rds/db-proxies',
        listedBy: 'DescribeDBProxies',
      },
      {
        label: 'DB proxy endpoints',
        path: '/aws/rds/db-proxy-endpoints',
        listedBy: 'DescribeDBProxyEndpoints',
      },
      {
        label: 'DB proxy targets',
        path: '/aws/rds/db-proxy-targets',
        listedBy: 'DescribeDBProxyTargets',
        listedInside: '/aws/rds/db-proxies',
      },
      {
        label: 'DB security groups',
        path: '/aws/rds/db-security-groups',
        listedBy: 'DescribeDBSecurityGroups',
      },
      {
        label: 'DB shard groups',
        path: '/aws/rds/db-shard-groups',
        listedBy: 'DescribeDBShardGroups',
      },
      {
        label: 'DB snapshots',
        path: '/aws/rds/db-snapshots',
        listedBy: 'DescribeDBSnapshots',
      },
      {
        label: 'DB subnet groups',
        path: '/aws/rds/db-subnet-groups',
        listedBy: 'DescribeDBSubnetGroups',
      },
      {
        label: 'Event subscriptions',
        path: '/aws/rds/event-subscriptions',
        listedBy: 'DescribeEventSubscriptions',
      },
      {
        label: 'Export tasks',
        path: '/aws/rds/export-tasks',
        listedBy: 'DescribeExportTasks',
      },
      {
        label: 'Global clusters',
        path: '/aws/rds/global-clusters',
        listedBy: 'DescribeGlobalClusters',
      },
      {
        label: 'Integrations',
        path: '/aws/rds/integrations',
        listedBy: 'DescribeIntegrations',
      },
      {
        label: 'Option groups',
        path: '/aws/rds/option-groups',
        listedBy: 'DescribeOptionGroups',
      },
      {
        label: 'Reserved DB instances',
        path: '/aws/rds/reserved-db-instances',
        listedBy: 'DescribeReservedDBInstances',
      },
      {
        label: 'Tenant databases',
        path: '/aws/rds/tenant-databases',
        listedBy: 'DescribeTenantDatabases',
      },
    ],
  },
];
