import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import TagEditor from '@cloudscape-design/components/tag-editor';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import type { ReactNode, RefObject } from 'react';

import './create-role.css';
import type { Policy } from '../api';
import { TAGS_MAX, type EditorTag, type Messages } from './create-role-rules';

// Step 3 of "Create role", "Name, review, and create" (issue 82, requirement R6.5): "Role details", the review of
// the two earlier steps with "Edit", and "Add tags" with Cloudscape's tag editor. The trust policy is the text that
// will be sent; every value is rendered as text.

const STEP_1_INCOMPLETE = 'Step 1 is not complete.';

export interface ReviewStepProps {
  name: string;
  description: string;
  tags: readonly EditorTag[];
  onChange: (change: { name?: string; description?: string; tags?: readonly EditorTag[] }) => void;
  /** The trust policy that will be sent; `undefined` while step 1 is not complete. */
  trustPolicy: string | undefined;
  policies: readonly Policy[];
  onEdit: (step: 1 | 2) => void;
  messages: Messages;
  /** The fields of step 3 that focus can be moved to, and the tag editor's holder. */
  nameRef: RefObject<InputProps.Ref | null>;
  descriptionRef: RefObject<TextareaProps.Ref | null>;
  tagsRef: RefObject<HTMLDivElement | null>;
  /** The failure of "Create role", above the wizard's buttons. */
  failure: ReactNode;
}

/** Step 3's content. */
export function ReviewStep({
  name,
  description,
  tags,
  onChange,
  trustPolicy,
  policies,
  onEdit,
  messages,
  nameRef,
  descriptionRef,
  tagsRef,
  failure,
}: ReviewStepProps) {
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Role details</Header>}>
        <SpaceBetween size="l">
          <FormField label="Role name" errorText={messages.name}>
            <Input
              ref={nameRef}
              value={name}
              onChange={({ detail }) => {
                onChange({ name: detail.value });
              }}
            />
          </FormField>
          <FormField label="Description" errorText={messages.description}>
            <Textarea
              ref={descriptionRef}
              value={description}
              onChange={({ detail }) => {
                onChange({ description: detail.value });
              }}
            />
          </FormField>
        </SpaceBetween>
      </Container>
      <Container
        header={
          <Header
            variant="h2"
            actions={
              <Button
                onClick={() => {
                  onEdit(1);
                }}
              >
                Edit
              </Button>
            }
          >
            Step 1: Select trusted entities
          </Header>
        }
      >
        {trustPolicy === undefined ? (
          <Box variant="p">{STEP_1_INCOMPLETE}</Box>
        ) : (
          <Box variant="code" display="block">
            <span className="aws-area-policy-text">{trustPolicy}</span>
          </Box>
        )}
      </Container>
      <Table<Policy>
        variant="container"
        items={[...policies]}
        trackBy="arn"
        columnDefinitions={[
          { id: 'name', header: 'Policy name', isRowHeader: true, cell: (policy) => policy.name },
          { id: 'type', header: 'Type', cell: (policy) => policy.type },
        ]}
        ariaLabels={{ tableLabel: 'Chosen policies' }}
        empty={
          <Box textAlign="center" color="inherit">
            No policies selected
          </Box>
        }
        header={
          <Header
            variant="h2"
            actions={
              <Button
                onClick={() => {
                  onEdit(2);
                }}
              >
                Edit
              </Button>
            }
          >
            Step 2: Add permissions
          </Header>
        }
      />
      <Container header={<Header variant="h2">Add tags</Header>}>
        <div ref={tagsRef}>
          <TagEditor
            tags={tags}
            tagLimit={TAGS_MAX}
            onChange={({ detail }) => {
              onChange({ tags: detail.tags.map(({ key, value, existing }) => ({ key, value, existing })) });
            }}
          />
        </div>
      </Container>
      {failure}
    </SpaceBetween>
  );
}
