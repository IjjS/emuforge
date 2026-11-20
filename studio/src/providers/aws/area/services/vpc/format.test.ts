import { describe, expect, it } from 'vitest';

import {
  ADD_ROUTE_PATTERN,
  addRouteHref,
  ASSOCIATE_SUBNET_PATTERN,
  associateSubnetHref,
  ATTACH_INTERNET_GATEWAY_PATTERN,
  attachInternetGatewayHref,
  CREATE_INTERNET_GATEWAY_PATH,
  CREATE_ROUTE_TABLE_PATH,
  CREATE_SUBNET_PATH,
  CREATE_VPC_PATH,
  createRouteTableHref,
  createSubnetHref,
  INTERNET_GATEWAYS_PATH,
  INTERNET_GATEWAYS_WORD,
  nameOrId,
  resourceName,
  ROUTE_TABLE_PATTERN,
  ROUTE_TABLES_PATH,
  ROUTE_TABLES_WORD,
  routeTableHref,
  SUBNET_PATTERN,
  subnetHref,
  SUBNETS_PATH,
  SUBNETS_WORD,
  VPC_PATH,
  VPC_PATTERN,
  vpcHref,
  VPCS_PATH,
  VPCS_WORD,
} from './format';

describe("VPC's addresses", () => {
  it("the fourteen screens' addresses are the requirement's routes", () => {
    expect([
      VPC_PATH,
      VPCS_PATH,
      CREATE_VPC_PATH,
      VPC_PATTERN,
      SUBNETS_PATH,
      CREATE_SUBNET_PATH,
      SUBNET_PATTERN,
      ROUTE_TABLES_PATH,
      CREATE_ROUTE_TABLE_PATH,
      ROUTE_TABLE_PATTERN,
      ADD_ROUTE_PATTERN,
      ASSOCIATE_SUBNET_PATTERN,
      INTERNET_GATEWAYS_PATH,
      CREATE_INTERNET_GATEWAY_PATH,
      ATTACH_INTERNET_GATEWAY_PATTERN,
    ]).toEqual([
      '/aws/vpc',
      '/aws/vpc/vpcs',
      '/aws/vpc/vpcs/create',
      '/aws/vpc/vpcs/vpc/{id}',
      '/aws/vpc/subnets',
      '/aws/vpc/subnets/create',
      '/aws/vpc/subnets/subnet/{id}',
      '/aws/vpc/route-tables',
      '/aws/vpc/route-tables/create',
      '/aws/vpc/route-tables/route-table/{id}',
      '/aws/vpc/route-tables/route-table/{id}/add-route',
      '/aws/vpc/route-tables/route-table/{id}/associate-subnet',
      '/aws/vpc/internet-gateways',
      '/aws/vpc/internet-gateways/create',
      '/aws/vpc/internet-gateways/gateway/{id}/attach',
    ]);
  });

  it("a VPC's, a subnet's and a route table's address hold the id percent-encoded once as one segment", () => {
    expect(vpcHref('vpc-1')).toBe('/aws/vpc/vpcs/vpc/vpc-1');
    expect(vpcHref('a/b c%')).toBe('/aws/vpc/vpcs/vpc/a%2Fb%20c%25');
    expect(subnetHref('subnet-1')).toBe('/aws/vpc/subnets/subnet/subnet-1');
    expect(subnetHref('a/b')).toBe('/aws/vpc/subnets/subnet/a%2Fb');
    expect(routeTableHref('rtb-1')).toBe('/aws/vpc/route-tables/route-table/rtb-1');
    expect(routeTableHref('a?b')).toBe('/aws/vpc/route-tables/route-table/a%3Fb');
  });

  it("a table's add-route and associate-subnet addresses and a gateway's attach address end as the requirement's", () => {
    expect(addRouteHref('rtb-1')).toBe('/aws/vpc/route-tables/route-table/rtb-1/add-route');
    expect(associateSubnetHref('rtb-1')).toBe('/aws/vpc/route-tables/route-table/rtb-1/associate-subnet');
    expect(attachInternetGatewayHref('igw-1')).toBe('/aws/vpc/internet-gateways/gateway/igw-1/attach');
    expect(attachInternetGatewayHref('a/b')).toBe('/aws/vpc/internet-gateways/gateway/a%2Fb/attach');
  });

  it('the create-subnet and create-route-table addresses with a VPC end ?vpc={id}; without one, none', () => {
    expect(createSubnetHref('vpc-1')).toBe('/aws/vpc/subnets/create?vpc=vpc-1');
    expect(createRouteTableHref('vpc-1')).toBe('/aws/vpc/route-tables/create?vpc=vpc-1');
    expect(createSubnetHref()).toBe('/aws/vpc/subnets/create');
    expect(createRouteTableHref()).toBe('/aws/vpc/route-tables/create');
    expect(new URL(createSubnetHref('a&b'), 'http://x').searchParams.get('vpc')).toBe('a&b');
  });
});

describe('names', () => {
  it('a resource\'s name is the value of its tag Name, "-" without one or with an empty one', () => {
    expect(
      resourceName([
        { key: 'env', value: 'dev' },
        { key: 'Name', value: 'app' },
      ]),
    ).toBe('app');
    expect(resourceName([{ key: 'env', value: 'dev' }])).toBe('-');
    expect(resourceName([{ key: 'Name', value: '' }])).toBe('-');
  });

  it('a heading and a result name a resource by its name when there is one, else its ID', () => {
    expect(nameOrId('vpc-1', [{ key: 'Name', value: 'app' }])).toBe('app');
    expect(nameOrId('vpc-1', [])).toBe('vpc-1');
    expect(nameOrId('vpc-1', [{ key: 'Name', value: '' }])).toBe('vpc-1');
  });
});

describe('the notice words', () => {
  it('"VPCs", "subnets", "route tables", "internet gateways"', () => {
    expect([VPCS_WORD, SUBNETS_WORD, ROUTE_TABLES_WORD, INTERNET_GATEWAYS_WORD]).toEqual([
      'VPCs',
      'subnets',
      'route tables',
      'internet gateways',
    ]);
  });
});
