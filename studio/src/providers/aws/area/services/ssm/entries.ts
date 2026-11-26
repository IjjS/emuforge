import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'Parameter Store',
        path: '/aws/ssm/parameters',
        listedBy: 'DescribeParameters',
      },
      {
        label: 'Activations',
        path: '/aws/ssm/activations',
        listedBy: 'DescribeActivations',
      },
      {
        label: 'Association versions',
        path: '/aws/ssm/association-versions',
        listedBy: 'ListAssociationVersions',
        listedInside: '/aws/ssm/associations',
      },
      {
        label: 'Associations',
        path: '/aws/ssm/associations',
        listedBy: 'ListAssociations',
      },
      {
        label: 'Automation executions',
        path: '/aws/ssm/automation-executions',
        listedBy: 'DescribeAutomationExecutions',
      },
      {
        label: 'Commands',
        path: '/aws/ssm/commands',
        listedBy: 'ListCommands',
      },
      {
        label: 'Compliance items',
        path: '/aws/ssm/compliance-items',
        listedBy: 'ListComplianceItems',
      },
      {
        label: 'Document versions',
        path: '/aws/ssm/document-versions',
        listedBy: 'ListDocumentVersions',
        listedInside: '/aws/ssm/documents',
      },
      {
        label: 'Documents',
        path: '/aws/ssm/documents',
        listedBy: 'ListDocuments',
      },
      {
        label: 'Maintenance window targets',
        path: '/aws/ssm/maintenance-window-targets',
        listedBy: 'DescribeMaintenanceWindowTargets',
        listedInside: '/aws/ssm/maintenance-windows',
      },
      {
        label: 'Maintenance window tasks',
        path: '/aws/ssm/maintenance-window-tasks',
        listedBy: 'DescribeMaintenanceWindowTasks',
        listedInside: '/aws/ssm/maintenance-windows',
      },
      {
        label: 'Maintenance windows',
        path: '/aws/ssm/maintenance-windows',
        listedBy: 'DescribeMaintenanceWindows',
      },
      {
        label: 'Ops item related items',
        path: '/aws/ssm/ops-item-related-items',
        listedBy: 'ListOpsItemRelatedItems',
      },
      {
        label: 'Ops items',
        path: '/aws/ssm/ops-items',
        listedBy: 'DescribeOpsItems',
      },
      {
        label: 'Ops metadata',
        path: '/aws/ssm/ops-metadata',
        listedBy: 'ListOpsMetadata',
      },
      {
        label: 'Patch baselines',
        path: '/aws/ssm/patch-baselines',
        listedBy: 'DescribePatchBaselines',
      },
      {
        label: 'Resource data sync',
        path: '/aws/ssm/resource-data-sync',
        listedBy: 'ListResourceDataSync',
      },
      {
        label: 'Sessions',
        path: '/aws/ssm/sessions',
        listedBy: 'DescribeSessions',
      },
    ],
  },
];
