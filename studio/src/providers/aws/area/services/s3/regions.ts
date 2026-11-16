// AWS's public Region names (AWS General Reference, "AWS Regions"), for the bucket list's "AWS Region" column (issue
// 56, requirement R4.2). Names only, not data read from the emulator: the code beside each name is the emulator's.

const REGION_NAMES: Readonly<Record<string, string>> = {
  'af-south-1': 'Africa (Cape Town)',
  'ap-east-1': 'Asia Pacific (Hong Kong)',
  'ap-east-2': 'Asia Pacific (Taipei)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-northeast-3': 'Asia Pacific (Osaka)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'ap-south-2': 'Asia Pacific (Hyderabad)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-southeast-3': 'Asia Pacific (Jakarta)',
  'ap-southeast-4': 'Asia Pacific (Melbourne)',
  'ap-southeast-5': 'Asia Pacific (Malaysia)',
  'ap-southeast-6': 'Asia Pacific (New Zealand)',
  'ap-southeast-7': 'Asia Pacific (Thailand)',
  'ca-central-1': 'Canada (Central)',
  'ca-west-1': 'Canada West (Calgary)',
  'cn-north-1': 'China (Beijing)',
  'cn-northwest-1': 'China (Ningxia)',
  'eu-central-1': 'Europe (Frankfurt)',
  'eu-central-2': 'Europe (Zurich)',
  'eu-north-1': 'Europe (Stockholm)',
  'eu-south-1': 'Europe (Milan)',
  'eu-south-2': 'Europe (Spain)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-west-2': 'Europe (London)',
  'eu-west-3': 'Europe (Paris)',
  'il-central-1': 'Israel (Tel Aviv)',
  'me-central-1': 'Middle East (UAE)',
  'me-south-1': 'Middle East (Bahrain)',
  'mx-central-1': 'Mexico (Central)',
  'sa-east-1': 'South America (São Paulo)',
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-gov-east-1': 'AWS GovCloud (US-East)',
  'us-gov-west-1': 'AWS GovCloud (US-West)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
};

/** Shown for a bucket whose answer gave no Region. */
export const NO_REGION = '-';

/**
 * A Region as the console writes it, `<name> <code>` ("Asia Pacific (Seoul) ap-northeast-2"); the code alone for a
 * code without a known name; "-" for none.
 */
export function regionText(code: string | undefined): string {
  if (code === undefined || code === '') {
    return NO_REGION;
  }
  const name = Object.hasOwn(REGION_NAMES, code) ? REGION_NAMES[code] : undefined;
  return name === undefined ? code : `${name} ${code}`;
}
