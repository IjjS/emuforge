// What S2, "Launch instance", checks before it sends `RunInstances` (issue 553, design task 2): an image and an
// instance type are chosen, and the name, sent as the tag `Name`, has at most 256 characters, the longest tag value
// the emulator accepts. The requirement's messages.

/** The longest name the form keeps. */
export const NAME_MAX = 256;

export const NAME_RULE = 'Up to 256 characters. Stored as the Name tag.';
export const NAME_TOO_LONG = 'A name can have up to 256 characters.';
export const CHOOSE_IMAGE = 'Choose an image.';
export const CHOOSE_TYPE = 'Choose an instance type.';

export const TYPE_FILTER_HINT = "Type part of a type's name to narrow the list.";

/**
 * The instance type field's description: the chosen image's architecture when the form holds one, then how the
 * list is narrowed. Nothing is said of an image when none is chosen or its answer gave no architecture.
 */
export function typeDescription(imageArchitecture: string | undefined): string {
  return imageArchitecture === undefined || imageArchitecture === ''
    ? TYPE_FILTER_HINT
    : `The chosen image is ${imageArchitecture}. ${TYPE_FILTER_HINT}`;
}

/** What the checks read of the form. */
export interface LaunchFormValues {
  name: string;
  imageChosen: boolean;
  typeChosen: boolean;
}

/** The message of each field that fails its check; a field that passes has none. */
export interface LaunchFormMessages {
  name?: string;
  image?: string;
  type?: string;
}

/** What is wrong with the form, field by field. */
export function launchFormMessages({ name, imageChosen, typeChosen }: LaunchFormValues): LaunchFormMessages {
  const messages: LaunchFormMessages = {};
  if (name.length > NAME_MAX) {
    messages.name = NAME_TOO_LONG;
  }
  if (!imageChosen) {
    messages.image = CHOOSE_IMAGE;
  }
  if (!typeChosen) {
    messages.type = CHOOSE_TYPE;
  }
  return messages;
}
