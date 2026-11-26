// eslint-disable-next-line studio/boundaries -- Shared unit-test support is excluded from the app build.
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { waitFor } from '@testing-library/react';
import { expect } from 'vitest';

export const aws = () => createWrapper(document.body);
export type Modal = NonNullable<ReturnType<ReturnType<typeof aws>['findModal']>>;
export type Table = NonNullable<ReturnType<ReturnType<typeof aws>['findTable']>>;

export function modal(name?: string | RegExp) {
  return waitFor(() => {
    const dialog = aws().findModal();
    if (dialog === null || !dialog.isVisible()) throw new Error('Expected an open modal');
    if (name !== undefined) expect(dialog.getElement()).toHaveAccessibleName(name);
    return dialog;
  });
}

export function modalInput(dialog: Modal, name?: string) {
  const content = dialog.findContent();
  const field = content.findInput()?.findNativeInput() ?? content.findTextarea()?.findNativeTextarea();
  if (field == null) throw new Error('Expected a modal input');
  const input = field.getElement();
  if (name !== undefined) expect(input).toHaveAccessibleName(name);
  return input;
}

export function buttonIn(scope: ReturnType<typeof aws> | null | undefined, name: string) {
  return scope
    ?.findAllButtons()
    .find(
      (button) =>
        (button.getElement().getAttribute('aria-label') ??
          button.findTextRegion()?.getElement().textContent?.trim()) === name,
    )
    ?.getElement();
}

export function modalButton(dialog: Modal, name: string) {
  const button =
    name === 'Close dialog'
      ? dialog.findDismissButton().getElement()
      : (buttonIn(dialog.findFooter(), name) ?? buttonIn(dialog.findContent(), name));
  if (button === undefined) throw new Error(`Expected modal button "${name}"`);
  return button;
}

export const modalAlert = (dialog: Modal) => dialog.findContent().findAlert();
export const flash = () => aws().findFlashbar()?.findItems()[0];
export const tableByHeading = (heading: string) =>
  aws()
    .findAllTables()
    .find((table) => table.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === heading);

export function rowLink(table: Table | null | undefined, name: string) {
  return table
    ?.findRows()
    .flatMap((row) => row.findAllLinks())
    .map((link) => link.getElement())
    .find((link) => (link.getAttribute('aria-label') ?? link.textContent?.trim()) === name);
}

export async function waitForLink(table: () => Table | null | undefined, name: string) {
  return waitFor(() => {
    const link = rowLink(table(), name);
    if (link === undefined) throw new Error(`Expected table link "${name}"`);
    expect(link).toBeVisible();
    return link;
  });
}

export function rowRadio(table: Table | null | undefined, name: string) {
  const radios = table?.findRows().map((_, index) =>
    table
      .findRowSelectionArea(index + 1)
      ?.find('input')
      ?.getElement(),
  );
  const radio = radios?.find((input) => {
    try {
      expect(input).toHaveAccessibleName(name);
      return true;
    } catch {
      return false;
    }
  });
  if (radio === undefined) throw new Error(`Expected row selection "${name}"`);
  return radio;
}

export function expectModalAlert(dialog: Modal, title: string) {
  return waitFor(() => {
    const header = modalAlert(dialog)?.findHeader()?.getElement();
    expect(header).toBeVisible();
    expect(header).toHaveTextContent(title);
  });
}

export function expectModalBox(dialog: Modal, text: string) {
  const box = dialog
    .findContent()
    .findAllBoxes()
    .find((item) => item.getElement().textContent === text);
  expect(box?.getElement()).toBeVisible();
  expect(box?.getElement()).toHaveTextContent(text);
}

export const modalTextInputs = (dialog: Modal) =>
  dialog
    .findContent()
    .findAllInputs()
    .map((input) => input.findNativeInput().getElement());

export function modalInputByValue(dialog: Modal, value: string) {
  const input = modalTextInputs(dialog).find((item) => item.value === value);
  if (input === undefined) throw new Error(`Expected modal input with value "${value}"`);
  return input;
}

export function boxText(scope: ReturnType<typeof aws> | null | undefined, text: string, selector?: string) {
  return scope
    ?.findAllBoxes()
    .find((box) => {
      const element = box.getElement();
      return (selector === undefined || element.localName === selector) && element.textContent === text;
    })
    ?.getElement();
}

export function expectEmpty(table: () => Table | null | undefined, text: string) {
  return waitFor(() => {
    const empty = table()?.findEmptySlot()?.getElement();
    expect(empty).toBeVisible();
    expect(empty?.textContent?.trim()).toBe(text);
  });
}

export function detailValue(label: string) {
  return aws()
    .findAllKeyValuePairs()
    .flatMap((pairs) => pairs.findItems())
    .find((item) => item.findLabel()?.getElement().textContent === label)
    ?.findValue()
    ?.getElement();
}

export function requiredElement<T>(element: T | null | undefined): T {
  if (element == null) throw new Error('Expected a Cloudscape test wrapper or element');
  return element;
}
