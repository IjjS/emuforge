import type { CreateEventBusCommandInput } from '@aws-sdk/client-eventbridge';

import type { Tag } from '../../components/tags';
import { isBusName } from './format';

export const BUS_NAME_RULE = '1 to 256 characters. Use letters, digits and . - _. The name cannot start with aws.';
export const BUS_DESCRIPTION_RULE = 'Up to 512 characters.';

export interface BusForm {
  name: string;
  description: string;
  tags: Tag[];
}

export const INITIAL_BUS_FORM: BusForm = { name: '', description: '', tags: [] };

export function busNameError(name: string): string | undefined {
  if (name.length === 0 || name.length > 256) return 'Enter a name of 1 to 256 characters.';
  if (name.includes('/')) return 'The name cannot contain /.';
  if (!isBusName(name)) return 'Use only letters, digits and . - _.';
  if (name.startsWith('aws.')) return 'The name cannot start with aws.';
}

export function busDescriptionError(description: string): string | undefined {
  if ([...description].length > 512) return 'Enter a description of up to 512 characters.';
}

export function createBusInput({ name, description, tags }: BusForm): CreateEventBusCommandInput {
  return {
    Name: name,
    ...(description !== '' && { Description: description }),
    ...(tags.length > 0 && { Tags: tags.map(({ key, value }) => ({ Key: key, Value: value })) }),
  };
}
