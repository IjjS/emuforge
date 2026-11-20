import { describe, expect, it } from 'vitest';

import {
  ADD_INSTANCE_PATTERN,
  addInstanceHref,
  CLUSTER_PATTERN,
  clusterHref,
  CLUSTERS_PATH,
  CLUSTERS_WORD,
  CREATE_CLUSTER_PATH,
  CREATE_INSTANCE_PATH,
  engineText,
  INSTANCE_PATTERN,
  instanceHref,
  INSTANCES_PATH,
  INSTANCES_WORD,
  RDS_PATH,
} from './format';

describe("RDS's addresses and words", () => {
  it("the seven screens' addresses are the requirement's routes; an identifier is one segment encoded once", () => {
    expect(RDS_PATH).toBe('/aws/rds');
    expect(INSTANCES_PATH).toBe('/aws/rds/instances');
    expect(CREATE_INSTANCE_PATH).toBe('/aws/rds/instances/create');
    expect(INSTANCE_PATTERN).toBe('/aws/rds/instances/instance/{id}');
    expect(CLUSTERS_PATH).toBe('/aws/rds/clusters');
    expect(CREATE_CLUSTER_PATH).toBe('/aws/rds/clusters/create');
    expect(CLUSTER_PATTERN).toBe('/aws/rds/clusters/cluster/{id}');
    expect(ADD_INSTANCE_PATTERN).toBe('/aws/rds/clusters/cluster/{id}/add-instance');

    expect(instanceHref('app-db')).toBe('/aws/rds/instances/instance/app-db');
    expect(instanceHref('a/b c%')).toBe('/aws/rds/instances/instance/a%2Fb%20c%25');
    expect(clusterHref('aur-1')).toBe('/aws/rds/clusters/cluster/aur-1');
    expect(clusterHref('a/b')).toBe('/aws/rds/clusters/cluster/a%2Fb');
    expect(addInstanceHref('a/b')).toBe('/aws/rds/clusters/cluster/a%2Fb/add-instance');
  });

  it('an engine with its version reads as one text; without a version, the engine alone', () => {
    expect(engineText('postgres', '18.3')).toBe('postgres 18.3');
    expect(engineText('aurora-mysql', '8.0.mysql_aurora.3.08.0')).toBe('aurora-mysql 8.0.mysql_aurora.3.08.0');
    expect(engineText('mariadb', undefined)).toBe('mariadb');
    expect(engineText('mariadb', '')).toBe('mariadb');
    expect(engineText(undefined, undefined)).toBeUndefined();
  });

  it('the notice words are "DB instances" and "DB clusters"', () => {
    expect(INSTANCES_WORD).toBe('DB instances');
    expect(CLUSTERS_WORD).toBe('DB clusters');
  });
});
