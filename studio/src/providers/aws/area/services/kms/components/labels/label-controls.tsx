import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactNode } from 'react';

import { AreaModal } from '../../../../components/area-modal';
import type { AreaConnection } from '../../../../components/emulator-line';
import { ReadFailure } from '../../../../components/failure-states';
import type { TokenListing } from '../../../../components/use-token-listing';
import { readFailureState } from '../../queries';

export function LabelPagination<T>({ listing, label }: { listing: TokenListing<T>; label: string }) {
  if (listing.pagesCount === 1 && !listing.openEnd) return null;
  return (
    <Pagination
      currentPageIndex={listing.currentPage}
      pagesCount={listing.pagesCount}
      openEnd={listing.openEnd}
      disabled={listing.loading}
      ariaLabels={{
        paginationLabel: label,
        nextPageLabel: 'Next page',
        previousPageLabel: 'Previous page',
        pageLabel: (page) => `Page ${String(page)}`,
      }}
      onChange={({ detail }) => listing.goToPage(detail.currentPageIndex)}
    />
  );
}

export function LabelListEmpty<T>({
  listing,
  connection,
  name,
  onRetry,
}: {
  listing: TokenListing<T>;
  connection: AreaConnection;
  name: string;
  onRetry: () => void;
}) {
  if (listing.failure !== undefined) {
    const thing = `${name} (${listing.failure.operation})`;
    return <ReadFailure state={readFailureState(listing.failure, connection, thing)} onRetry={onRetry} />;
  }
  return (
    <Box textAlign="center" variant="strong">
      No {name}
      {listing.currentPage > 1 || listing.openEnd ? ' on this page' : ''}
    </Box>
  );
}

export function UnavailableActions({ operations }: { operations: readonly string[] }) {
  return operations.map((operation) => (
    <Alert key={operation} type="info" header="Not implemented by the emulator">
      The emulator answered 501 Not Implemented for {operation}.
    </Alert>
  ));
}

export function LabelRowActions({ children }: { children: ReactNode }) {
  return (
    <div onFocus={({ target }) => target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}>
      <SpaceBetween direction="horizontal" size="xs">
        {children}
      </SpaceBetween>
    </div>
  );
}

export function ConfirmLabelRemoval({
  title,
  body,
  word,
  disabled,
  pending,
  onConfirm,
  onDismiss,
}: {
  title: string;
  body: ReactNode;
  word: string;
  disabled: boolean;
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const [typed, setTyped] = useState('');
  const confirmed = typed === word;
  const handleConfirm = () => {
    if (confirmed && !disabled && !pending) onConfirm();
  };
  return (
    <LabelDialog
      title={title}
      submit={title}
      disabled={!confirmed || disabled}
      pending={pending}
      onSubmit={handleConfirm}
      onDismiss={onDismiss}
    >
      <Box variant="p">{body}</Box>
      <FormField label={`To confirm, type “${word}” in the field.`}>
        <Input
          value={typed}
          placeholder={word}
          onChange={({ detail }) => setTyped(detail.value)}
          onKeyDown={({ detail }) => {
            if (detail.key === 'Enter') handleConfirm();
          }}
        />
      </FormField>
    </LabelDialog>
  );
}

export function LabelDialog({
  title,
  submit,
  disabled,
  pending,
  onSubmit,
  onDismiss,
  children,
}: {
  title: string;
  submit: string;
  disabled: boolean;
  pending: boolean;
  onSubmit: () => void;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const handleDismiss = () => {
    if (!pending) onDismiss();
  };
  return (
    <AreaModal
      visible
      header={title}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!pending && disabled} loading={pending} onClick={onSubmit}>
              {submit}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">{children}</SpaceBetween>
    </AreaModal>
  );
}
