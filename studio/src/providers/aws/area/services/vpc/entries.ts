import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'VPCs',
        path: '/aws/vpc/vpcs',
        listedBy: 'DescribeVpcs',
      },
      {
        label: 'Subnets',
        path: '/aws/vpc/subnets',
        listedBy: 'DescribeSubnets',
      },
      {
        label: 'Route tables',
        path: '/aws/vpc/route-tables',
        listedBy: 'DescribeRouteTables',
      },
      {
        label: 'Internet gateways',
        path: '/aws/vpc/internet-gateways',
        listedBy: 'DescribeInternetGateways',
      },
      {
        label: 'AWS network performance metric subscriptions',
        path: '/aws/vpc/aws-network-performance-metric-subscriptions',
        listedBy: 'DescribeAwsNetworkPerformanceMetricSubscriptions',
      },
      {
        label: 'BYOIP CIDRs',
        path: '/aws/vpc/byoip-cidrs',
        listedBy: 'DescribeByoipCidrs',
      },
      {
        label: 'Carrier gateways',
        path: '/aws/vpc/carrier-gateways',
        listedBy: 'DescribeCarrierGateways',
      },
      {
        label: 'Client VPN authorization rules',
        path: '/aws/vpc/client-vpn-authorization-rules',
        listedBy: 'DescribeClientVpnAuthorizationRules',
        listedInside: '/aws/vpc/client-vpn-endpoints',
      },
      {
        label: 'Client VPN endpoints',
        path: '/aws/vpc/client-vpn-endpoints',
        listedBy: 'DescribeClientVpnEndpoints',
      },
      {
        label: 'Client VPN routes',
        path: '/aws/vpc/client-vpn-routes',
        listedBy: 'DescribeClientVpnRoutes',
        listedInside: '/aws/vpc/client-vpn-endpoints',
      },
      {
        label: 'Client VPN target networks',
        path: '/aws/vpc/client-vpn-target-networks',
        listedBy: 'DescribeClientVpnTargetNetworks',
        listedInside: '/aws/vpc/client-vpn-endpoints',
      },
      {
        label: 'CoIP pools',
        path: '/aws/vpc/coip-pools',
        listedBy: 'DescribeCoipPools',
      },
      {
        label: 'Customer gateways',
        path: '/aws/vpc/customer-gateways',
        listedBy: 'DescribeCustomerGateways',
      },
      {
        label: 'DHCP options',
        path: '/aws/vpc/dhcp-options',
        listedBy: 'DescribeDhcpOptions',
      },
      {
        label: 'Egress only internet gateways',
        path: '/aws/vpc/egress-only-internet-gateways',
        listedBy: 'DescribeEgressOnlyInternetGateways',
      },
      {
        label: 'Flow logs',
        path: '/aws/vpc/flow-logs',
        listedBy: 'DescribeFlowLogs',
      },
      {
        label: 'IPAM BYOASN',
        path: '/aws/vpc/ipam-byoasn',
        listedBy: 'DescribeIpamByoasn',
      },
      {
        label: 'IPAM pools',
        path: '/aws/vpc/ipam-pools',
        listedBy: 'DescribeIpamPools',
      },
      {
        label: 'IPAM prefix list resolver targets',
        path: '/aws/vpc/ipam-prefix-list-resolver-targets',
        listedBy: 'DescribeIpamPrefixListResolverTargets',
      },
      {
        label: 'IPAM prefix list resolvers',
        path: '/aws/vpc/ipam-prefix-list-resolvers',
        listedBy: 'DescribeIpamPrefixListResolvers',
      },
      {
        label: 'IPAM resource discoveries',
        path: '/aws/vpc/ipam-resource-discoveries',
        listedBy: 'DescribeIpamResourceDiscoveries',
      },
      {
        label: 'IPAM resource discovery associations',
        path: '/aws/vpc/ipam-resource-discovery-associations',
        listedBy: 'DescribeIpamResourceDiscoveryAssociations',
      },
      {
        label: 'IPAM scopes',
        path: '/aws/vpc/ipam-scopes',
        listedBy: 'DescribeIpamScopes',
      },
      {
        label: 'IPAMs',
        path: '/aws/vpc/ipams',
        listedBy: 'DescribeIpams',
      },
      {
        label: 'IPv6 pools',
        path: '/aws/vpc/ipv6-pools',
        listedBy: 'DescribeIpv6Pools',
      },
      {
        label: 'Local gateway route table virtual interface group associations',
        path: '/aws/vpc/local-gateway-route-table-virtual-interface-group-associations',
        listedBy: 'DescribeLocalGatewayRouteTableVirtualInterfaceGroupAssociations',
      },
      {
        label: 'Local gateway route table VPC associations',
        path: '/aws/vpc/local-gateway-route-table-vpc-associations',
        listedBy: 'DescribeLocalGatewayRouteTableVpcAssociations',
      },
      {
        label: 'Local gateway route tables',
        path: '/aws/vpc/local-gateway-route-tables',
        listedBy: 'DescribeLocalGatewayRouteTables',
      },
      {
        label: 'Local gateway virtual interface groups',
        path: '/aws/vpc/local-gateway-virtual-interface-groups',
        listedBy: 'DescribeLocalGatewayVirtualInterfaceGroups',
      },
      {
        label: 'Local gateway virtual interfaces',
        path: '/aws/vpc/local-gateway-virtual-interfaces',
        listedBy: 'DescribeLocalGatewayVirtualInterfaces',
      },
      {
        label: 'Managed prefix lists',
        path: '/aws/vpc/managed-prefix-lists',
        listedBy: 'DescribeManagedPrefixLists',
      },
      {
        label: 'NAT gateways',
        path: '/aws/vpc/nat-gateways',
        listedBy: 'DescribeNatGateways',
      },
      {
        label: 'Network ACLs',
        path: '/aws/vpc/network-acls',
        listedBy: 'DescribeNetworkAcls',
      },
      {
        label: 'Network insights access scope analyses',
        path: '/aws/vpc/network-insights-access-scope-analyses',
        listedBy: 'DescribeNetworkInsightsAccessScopeAnalyses',
      },
      {
        label: 'Network insights access scopes',
        path: '/aws/vpc/network-insights-access-scopes',
        listedBy: 'DescribeNetworkInsightsAccessScopes',
      },
      {
        label: 'Network insights analyses',
        path: '/aws/vpc/network-insights-analyses',
        listedBy: 'DescribeNetworkInsightsAnalyses',
      },
      {
        label: 'Network insights paths',
        path: '/aws/vpc/network-insights-paths',
        listedBy: 'DescribeNetworkInsightsPaths',
      },
      {
        label: 'Public IPv4 pools',
        path: '/aws/vpc/public-ipv4-pools',
        listedBy: 'DescribePublicIpv4Pools',
      },
      {
        label: 'Route server endpoints',
        path: '/aws/vpc/route-server-endpoints',
        listedBy: 'DescribeRouteServerEndpoints',
      },
      {
        label: 'Route server peers',
        path: '/aws/vpc/route-server-peers',
        listedBy: 'DescribeRouteServerPeers',
      },
      {
        label: 'Route servers',
        path: '/aws/vpc/route-servers',
        listedBy: 'DescribeRouteServers',
      },
      {
        label: 'Secondary networks',
        path: '/aws/vpc/secondary-networks',
        listedBy: 'DescribeSecondaryNetworks',
      },
      {
        label: 'Secondary subnets',
        path: '/aws/vpc/secondary-subnets',
        listedBy: 'DescribeSecondarySubnets',
      },
      {
        label: 'Security group VPC associations',
        path: '/aws/vpc/security-group-vpc-associations',
        listedBy: 'DescribeSecurityGroupVpcAssociations',
      },
      {
        label: 'Traffic mirror filters',
        path: '/aws/vpc/traffic-mirror-filters',
        listedBy: 'DescribeTrafficMirrorFilters',
      },
      {
        label: 'Traffic mirror sessions',
        path: '/aws/vpc/traffic-mirror-sessions',
        listedBy: 'DescribeTrafficMirrorSessions',
      },
      {
        label: 'Traffic mirror targets',
        path: '/aws/vpc/traffic-mirror-targets',
        listedBy: 'DescribeTrafficMirrorTargets',
      },
      {
        label: 'Transit gateway connect peers',
        path: '/aws/vpc/transit-gateway-connect-peers',
        listedBy: 'DescribeTransitGatewayConnectPeers',
      },
      {
        label: 'Transit gateway connects',
        path: '/aws/vpc/transit-gateway-connects',
        listedBy: 'DescribeTransitGatewayConnects',
      },
      {
        label: 'Transit gateway metering policies',
        path: '/aws/vpc/transit-gateway-metering-policies',
        listedBy: 'DescribeTransitGatewayMeteringPolicies',
      },
      {
        label: 'Transit gateway multicast domains',
        path: '/aws/vpc/transit-gateway-multicast-domains',
        listedBy: 'DescribeTransitGatewayMulticastDomains',
      },
      {
        label: 'Transit gateway peering attachments',
        path: '/aws/vpc/transit-gateway-peering-attachments',
        listedBy: 'DescribeTransitGatewayPeeringAttachments',
      },
      {
        label: 'Transit gateway policy tables',
        path: '/aws/vpc/transit-gateway-policy-tables',
        listedBy: 'DescribeTransitGatewayPolicyTables',
      },
      {
        label: 'Transit gateway route table announcements',
        path: '/aws/vpc/transit-gateway-route-table-announcements',
        listedBy: 'DescribeTransitGatewayRouteTableAnnouncements',
      },
      {
        label: 'Transit gateway route tables',
        path: '/aws/vpc/transit-gateway-route-tables',
        listedBy: 'DescribeTransitGatewayRouteTables',
      },
      {
        label: 'Transit gateway VPC attachments',
        path: '/aws/vpc/transit-gateway-vpc-attachments',
        listedBy: 'DescribeTransitGatewayVpcAttachments',
      },
      {
        label: 'Transit gateways',
        path: '/aws/vpc/transit-gateways',
        listedBy: 'DescribeTransitGateways',
      },
      {
        label: 'Verified access endpoints',
        path: '/aws/vpc/verified-access-endpoints',
        listedBy: 'DescribeVerifiedAccessEndpoints',
      },
      {
        label: 'Verified access instances',
        path: '/aws/vpc/verified-access-instances',
        listedBy: 'DescribeVerifiedAccessInstances',
      },
      {
        label: 'Verified access trust providers',
        path: '/aws/vpc/verified-access-trust-providers',
        listedBy: 'DescribeVerifiedAccessTrustProviders',
      },
      {
        label: 'VPC block public access exclusions',
        path: '/aws/vpc/vpc-block-public-access-exclusions',
        listedBy: 'DescribeVpcBlockPublicAccessExclusions',
      },
      {
        label: 'VPC encryption controls',
        path: '/aws/vpc/vpc-encryption-controls',
        listedBy: 'DescribeVpcEncryptionControls',
      },
      {
        label: 'VPC endpoint connection notifications',
        path: '/aws/vpc/vpc-endpoint-connection-notifications',
        listedBy: 'DescribeVpcEndpointConnectionNotifications',
      },
      {
        label: 'VPC endpoint service configurations',
        path: '/aws/vpc/vpc-endpoint-service-configurations',
        listedBy: 'DescribeVpcEndpointServiceConfigurations',
      },
      {
        label: 'VPC endpoints',
        path: '/aws/vpc/vpc-endpoints',
        listedBy: 'DescribeVpcEndpoints',
      },
      {
        label: 'VPC peering connections',
        path: '/aws/vpc/vpc-peering-connections',
        listedBy: 'DescribeVpcPeeringConnections',
      },
      {
        label: 'VPN connections',
        path: '/aws/vpc/vpn-connections',
        listedBy: 'DescribeVpnConnections',
      },
      {
        label: 'VPN gateways',
        path: '/aws/vpc/vpn-gateways',
        listedBy: 'DescribeVpnGateways',
      },
    ],
  },
];
