import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    name: 'Amazon EC2',
    entries: [
      {
        label: 'Instances',
        path: '/aws/ec2/instances',
        listedBy: 'DescribeInstances',
      },
      {
        label: 'Volumes',
        path: '/aws/ec2/volumes',
        listedBy: 'DescribeVolumes',
      },
      {
        label: 'Security groups',
        path: '/aws/ec2/security-groups',
        listedBy: 'DescribeSecurityGroups',
      },
      {
        label: 'Key pairs',
        path: '/aws/ec2/key-pairs',
        listedBy: 'DescribeKeyPairs',
      },
      {
        label: 'Bundle tasks',
        path: '/aws/ec2/bundle-tasks',
        listedBy: 'DescribeBundleTasks',
      },
      {
        label: 'Capacity blocks',
        path: '/aws/ec2/capacity-blocks',
        listedBy: 'DescribeCapacityBlocks',
      },
      {
        label: 'Capacity manager data exports',
        path: '/aws/ec2/capacity-manager-data-exports',
        listedBy: 'DescribeCapacityManagerDataExports',
      },
      {
        label: 'Capacity reservation billing requests',
        path: '/aws/ec2/capacity-reservation-billing-requests',
        listedBy: 'DescribeCapacityReservationBillingRequests',
      },
      {
        label: 'Capacity reservation fleets',
        path: '/aws/ec2/capacity-reservation-fleets',
        listedBy: 'DescribeCapacityReservationFleets',
      },
      {
        label: 'Capacity reservations',
        path: '/aws/ec2/capacity-reservations',
        listedBy: 'DescribeCapacityReservations',
      },
      {
        label: 'Conversion tasks',
        path: '/aws/ec2/conversion-tasks',
        listedBy: 'DescribeConversionTasks',
      },
      {
        label: 'Declarative policies reports',
        path: '/aws/ec2/declarative-policies-reports',
        listedBy: 'DescribeDeclarativePoliciesReports',
      },
      {
        label: 'Elastic IP address transfers',
        path: '/aws/ec2/address-transfers',
        listedBy: 'DescribeAddressTransfers',
      },
      {
        label: 'Elastic IP addresses',
        path: '/aws/ec2/addresses',
        listedBy: 'DescribeAddresses',
      },
      {
        label: 'Export image tasks',
        path: '/aws/ec2/export-image-tasks',
        listedBy: 'DescribeExportImageTasks',
      },
      {
        label: 'Export tasks',
        path: '/aws/ec2/export-tasks',
        listedBy: 'DescribeExportTasks',
      },
      {
        label: 'Fleets',
        path: '/aws/ec2/fleets',
        listedBy: 'DescribeFleets',
      },
      {
        label: 'FPGA images',
        path: '/aws/ec2/fpga-images',
        listedBy: 'DescribeFpgaImages',
      },
      {
        label: 'Host reservations',
        path: '/aws/ec2/host-reservations',
        listedBy: 'DescribeHostReservations',
      },
      {
        label: 'Hosts',
        path: '/aws/ec2/hosts',
        listedBy: 'DescribeHosts',
      },
      {
        label: 'IAM instance profile associations',
        path: '/aws/ec2/iam-instance-profile-associations',
        listedBy: 'DescribeIamInstanceProfileAssociations',
      },
      {
        label: 'Image usage reports',
        path: '/aws/ec2/image-usage-reports',
        listedBy: 'DescribeImageUsageReports',
      },
      {
        label: 'Images (AMIs)',
        path: '/aws/ec2/images',
        listedBy: 'DescribeImages',
      },
      {
        label: 'Import image tasks',
        path: '/aws/ec2/import-image-tasks',
        listedBy: 'DescribeImportImageTasks',
      },
      {
        label: 'Import snapshot tasks',
        path: '/aws/ec2/import-snapshot-tasks',
        listedBy: 'DescribeImportSnapshotTasks',
      },
      {
        label: 'Instance connect endpoints',
        path: '/aws/ec2/instance-connect-endpoints',
        listedBy: 'DescribeInstanceConnectEndpoints',
      },
      {
        label: 'Instance event windows',
        path: '/aws/ec2/instance-event-windows',
        listedBy: 'DescribeInstanceEventWindows',
      },
      {
        label: 'Launch template versions',
        path: '/aws/ec2/launch-template-versions',
        listedBy: 'DescribeLaunchTemplateVersions',
        listedInside: '/aws/ec2/launch-templates',
      },
      {
        label: 'Launch templates',
        path: '/aws/ec2/launch-templates',
        listedBy: 'DescribeLaunchTemplates',
      },
      {
        label: 'Mac modification tasks',
        path: '/aws/ec2/mac-modification-tasks',
        listedBy: 'DescribeMacModificationTasks',
      },
      {
        label: 'Network interface permissions',
        path: '/aws/ec2/network-interface-permissions',
        listedBy: 'DescribeNetworkInterfacePermissions',
      },
      {
        label: 'Network interfaces',
        path: '/aws/ec2/network-interfaces',
        listedBy: 'DescribeNetworkInterfaces',
      },
      {
        label: 'Placement groups',
        path: '/aws/ec2/placement-groups',
        listedBy: 'DescribePlacementGroups',
      },
      {
        label: 'Replace root volume tasks',
        path: '/aws/ec2/replace-root-volume-tasks',
        listedBy: 'DescribeReplaceRootVolumeTasks',
      },
      {
        label: 'Reserved instances',
        path: '/aws/ec2/reserved-instances',
        listedBy: 'DescribeReservedInstances',
      },
      {
        label: 'Reserved instances listings',
        path: '/aws/ec2/reserved-instances-listings',
        listedBy: 'DescribeReservedInstancesListings',
      },
      {
        label: 'Scheduled instances',
        path: '/aws/ec2/scheduled-instances',
        listedBy: 'DescribeScheduledInstances',
      },
      {
        label: 'Security group rules',
        path: '/aws/ec2/security-group-rules',
        listedBy: 'DescribeSecurityGroupRules',
        shownIn: {
          entry: '/aws/ec2/security-groups',
          place: 'the "Rules" section of a security group',
        },
      },
      {
        label: 'Snapshots',
        path: '/aws/ec2/snapshots',
        listedBy: 'DescribeSnapshots',
      },
      {
        label: 'Spot fleet requests',
        path: '/aws/ec2/spot-fleet-requests',
        listedBy: 'DescribeSpotFleetRequests',
      },
      {
        label: 'Spot instance requests',
        path: '/aws/ec2/spot-instance-requests',
        listedBy: 'DescribeSpotInstanceRequests',
      },
      {
        label: 'Store image tasks',
        path: '/aws/ec2/store-image-tasks',
        listedBy: 'DescribeStoreImageTasks',
      },
      {
        label: 'Tags',
        path: '/aws/ec2/tags',
        listedBy: 'DescribeTags',
        shownIn: {
          entry: '/aws/ec2/instances',
          place: 'the "Tags" section of an instance',
        },
      },
    ],
  },
  {
    name: 'Elastic Load Balancing',
    subService: {
      name: 'Elastic Load Balancing',
      path: '/aws/ec2/elastic-load-balancing',
    },
    entries: [
      {
        label: 'Listener certificates',
        path: '/aws/ec2/listener-certificates',
        listedBy: 'DescribeListenerCertificates',
        listedInside: '/aws/ec2/listeners',
      },
      {
        label: 'Listeners',
        path: '/aws/ec2/listeners',
        listedBy: 'DescribeListeners',
      },
      {
        label: 'Load balancers',
        path: '/aws/ec2/load-balancers',
        listedBy: 'DescribeLoadBalancers',
      },
      {
        label: 'Rules',
        path: '/aws/ec2/rules',
        listedBy: 'DescribeRules',
        listedInside: '/aws/ec2/listeners',
      },
      {
        label: 'Target groups',
        path: '/aws/ec2/target-groups',
        listedBy: 'DescribeTargetGroups',
      },
      {
        label: 'Trust store revocations',
        path: '/aws/ec2/trust-store-revocations',
        listedBy: 'DescribeTrustStoreRevocations',
        listedInside: '/aws/ec2/trust-stores',
      },
      {
        label: 'Trust stores',
        path: '/aws/ec2/trust-stores',
        listedBy: 'DescribeTrustStores',
      },
    ],
  },
  {
    name: 'Classic Load Balancing',
    subService: {
      name: 'Classic Load Balancing',
      path: '/aws/ec2/classic-load-balancing',
    },
    entries: [
      {
        label: 'Classic load balancer policies',
        path: '/aws/ec2/load-balancer-policies',
        listedBy: 'DescribeLoadBalancerPolicies',
      },
      {
        label: 'Classic load balancers',
        path: '/aws/ec2/classic-load-balancers',
        listedBy: 'DescribeLoadBalancers',
      },
    ],
  },
  {
    name: 'EC2 Auto Scaling',
    subService: {
      name: 'EC2 Auto Scaling',
      path: '/aws/ec2/ec2-auto-scaling',
    },
    entries: [
      {
        label: 'Auto Scaling groups',
        path: '/aws/ec2/auto-scaling-groups',
        listedBy: 'DescribeAutoScalingGroups',
      },
      {
        label: 'Auto Scaling tags',
        path: '/aws/ec2/auto-scaling-tags',
        listedBy: 'DescribeTags',
      },
      {
        label: 'Instance refreshes',
        path: '/aws/ec2/instance-refreshes',
        listedBy: 'DescribeInstanceRefreshes',
        listedInside: '/aws/ec2/auto-scaling-groups',
      },
      {
        label: 'Launch configurations',
        path: '/aws/ec2/launch-configurations',
        listedBy: 'DescribeLaunchConfigurations',
      },
      {
        label: 'Lifecycle hooks',
        path: '/aws/ec2/lifecycle-hooks',
        listedBy: 'DescribeLifecycleHooks',
        listedInside: '/aws/ec2/auto-scaling-groups',
      },
      {
        label: 'Notification configurations',
        path: '/aws/ec2/notification-configurations',
        listedBy: 'DescribeNotificationConfigurations',
      },
      {
        label: 'Scaling policies',
        path: '/aws/ec2/policies',
        listedBy: 'DescribePolicies',
      },
      {
        label: 'Scheduled actions',
        path: '/aws/ec2/scheduled-actions',
        listedBy: 'DescribeScheduledActions',
      },
      {
        label: 'Traffic sources',
        path: '/aws/ec2/traffic-sources',
        listedBy: 'DescribeTrafficSources',
        listedInside: '/aws/ec2/auto-scaling-groups',
      },
    ],
  },
];
