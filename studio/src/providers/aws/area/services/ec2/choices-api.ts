import {
  DescribeImagesCommand,
  DescribeInstanceTypesCommand,
  DescribeInstanceTypeOfferingsCommand,
  DescribeKeyPairsCommand,
  DescribeVpcsCommand,
  type Filter,
} from '@aws-sdk/client-ec2';

import { sendEc2, text, withValues } from '../../lib/ec2-client';
import { paged, pageOf, type ChoicePage, type VpcChoice } from '../../lib/ec2-network-choices';

// EC2 form choices. Images and types are read a page at a time, with the typed text sent as a filter.

/** The operations of the choices, as a failure names them. */
export const CHOICE_OPERATIONS = {
  describeImages: 'DescribeImages',
  describeInstanceTypes: 'DescribeInstanceTypes',
  describeInstanceTypeOfferings: 'DescribeInstanceTypeOfferings',
  describeVpcs: 'DescribeVpcs',
  describeKeyPairs: 'DescribeKeyPairs',
} as const;

export interface ImageChoice {
  id: string;
  name?: string;
  architecture?: string;
  description?: string;
}

export interface InstanceTypeChoice {
  type: string;
  vcpus?: number;
  memoryMiB?: number;
  architectures: string[];
}

export interface KeyPairChoice {
  name: string;
  type?: string;
}

export {
  listSecurityGroupChoices as listGroupChoices,
  type SecurityGroupChoice as GroupChoice,
} from '../../components/security-group-choices';

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The filter `name` with `*` around `typed`, or none for an empty text. */
function contains(name: string, typed: string | undefined): Filter[] {
  return typed === undefined || typed === '' ? [] : [{ Name: name, Values: [`*${typed}*`] }];
}

/** Images: `DescribeImages`, the filter `name` when a text is typed. */
export async function listImageChoices(
  endpoint: string,
  typed: string | undefined,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ChoicePage<ImageChoice>> {
  const output = await sendEc2(
    endpoint,
    CHOICE_OPERATIONS.describeImages,
    (client, abortSignal) =>
      client.send(new DescribeImagesCommand(paged(contains('name', typed), token)), { abortSignal }),
    signal,
  );
  const choices = (output.Images ?? []).flatMap((image) => {
    const id = text(image.ImageId);
    return id === undefined
      ? []
      : [
          withValues<ImageChoice>(
            { id },
            {
              name: text(image.Name),
              architecture: text(image.Architecture),
              description: text(image.Description),
            },
          ),
        ];
  });
  return pageOf(choices, output.NextToken);
}

/** Instance types: `DescribeInstanceTypes`, the filter `instance-type` when a text is typed. */
export async function listInstanceTypeChoices(
  endpoint: string,
  typed: string | undefined,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ChoicePage<InstanceTypeChoice>> {
  const output = await sendEc2(
    endpoint,
    CHOICE_OPERATIONS.describeInstanceTypes,
    (client, abortSignal) =>
      client.send(new DescribeInstanceTypesCommand(paged(contains('instance-type', typed), token)), { abortSignal }),
    signal,
  );
  const choices = (output.InstanceTypes ?? []).flatMap((info) => {
    const type = text(info.InstanceType);
    return type === undefined
      ? []
      : [
          withValues<InstanceTypeChoice>(
            {
              type,
              architectures: (info.ProcessorInfo?.SupportedArchitectures ?? []).flatMap((each) => {
                const architecture = text(each);
                return architecture === undefined ? [] : [architecture];
              }),
            },
            { vcpus: number(info.VCpuInfo?.DefaultVCpus), memoryMiB: number(info.MemoryInfo?.SizeInMiB) },
          ),
        ];
  });
  return pageOf(choices, output.NextToken);
}

/** The type names offered in one zone, across every page. */
export async function listInstanceTypeOfferings(
  endpoint: string,
  zone: string,
  signal: AbortSignal,
): Promise<ReadonlySet<string>> {
  const types = new Set<string>();
  let token: string | undefined;
  do {
    const output = await sendEc2(
      endpoint,
      CHOICE_OPERATIONS.describeInstanceTypeOfferings,
      (client, abortSignal) =>
        client.send(
          new DescribeInstanceTypeOfferingsCommand({
            LocationType: 'availability-zone',
            ...paged([{ Name: 'location', Values: [zone] }], token),
          }),
          { abortSignal },
        ),
      signal,
    );
    for (const offering of output.InstanceTypeOfferings ?? []) {
      const type = text(offering.InstanceType);
      if (type !== undefined) types.add(type);
    }
    token = text(output.NextToken);
  } while (token !== undefined);
  return types;
}

/** The default VPC: `DescribeVpcs` with the filter `is-default` `true`; `undefined` when it answers none. */
export async function getDefaultVpc(endpoint: string, signal: AbortSignal): Promise<VpcChoice | undefined> {
  const output = await sendEc2(
    endpoint,
    CHOICE_OPERATIONS.describeVpcs,
    (client, abortSignal) =>
      client.send(new DescribeVpcsCommand({ Filters: [{ Name: 'is-default', Values: ['true'] }] }), { abortSignal }),
    signal,
  );
  for (const vpc of output.Vpcs ?? []) {
    const id = text(vpc.VpcId);
    if (id !== undefined) {
      return withValues<VpcChoice>({ id, isDefault: true }, { cidr: text(vpc.CidrBlock) });
    }
  }
  return undefined;
}

/** Key pairs: `DescribeKeyPairs`, one answer with no page. */
export async function listKeyPairChoices(endpoint: string, signal: AbortSignal): Promise<KeyPairChoice[]> {
  const output = await sendEc2(
    endpoint,
    CHOICE_OPERATIONS.describeKeyPairs,
    (client, abortSignal) => client.send(new DescribeKeyPairsCommand({}), { abortSignal }),
    signal,
  );
  return (output.KeyPairs ?? []).flatMap((pair) => {
    const name = text(pair.KeyName);
    return name === undefined ? [] : [withValues<KeyPairChoice>({ name }, { type: text(pair.KeyType) })];
  });
}
