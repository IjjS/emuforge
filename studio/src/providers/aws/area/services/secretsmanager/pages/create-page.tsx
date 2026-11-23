import Alert from '@cloudscape-design/components/alert';
import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { LifecycleFeedback } from '../components/lifecycle/lifecycle-feedback';
import { hasValue, secretValueInput, type SecretDraft } from '../components/lifecycle/secret-draft';
import { SecretValueFields } from '../components/lifecycle/secret-value-fields';
import { useLifecycleAction } from '../components/lifecycle/use-lifecycle-action';
import { CREATE_SECRET, createSecret, GET_RANDOM_PASSWORD, getRandomPassword } from '../lifecycle-api';
import { SECRETS_PATH, secretPath } from '../paths';
import { useRefreshSecretReads } from '../queries';

interface TagDraft {
  Key: string;
  Value: string;
}

export function CreateSecretPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('secrets');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const refresh = useRefreshSecretReads();
  const action = useLifecycleAction(connection);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [keyArn, setKeyArn] = useState('');
  const [tags, setTags] = useState<TagDraft[]>([]);
  const [draft, setDraft] = useState<SecretDraft>({ format: 'string', text: '' });
  const [asking, setAsking] = useState(false);

  const busy = action.pending !== undefined;
  const ready = name.trim() !== '' && hasValue(draft) && tags.every((tag) => tag.Key.trim() !== '');
  const dirty =
    name !== '' ||
    description !== '' ||
    keyArn !== '' ||
    tags.length !== 0 ||
    draft.format !== 'string' ||
    hasValue(draft);

  const handleCancel = () => {
    if (dirty) setAsking(true);
    else void navigate(SECRETS_PATH);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    void action.run(
      CREATE_SECRET,
      async (endpoint, signal) =>
        createSecret(
          endpoint,
          {
            Name: name,
            Description: description || undefined,
            KmsKeyId: keyArn.trim() || undefined,
            Tags: tags.length === 0 ? undefined : tags,
            ...(await secretValueInput(draft, signal)),
          },
          signal,
        ),
      (result, endpoint) => {
        const createdName = result.Name ?? name;
        flash.handOver(secretPath(createdName), [{ type: 'success', content: `Secret ${createdName} was stored.` }]);
        refresh(endpoint, createdName);
      },
    );
  };

  const handleGenerate = () => {
    void action.run(
      GET_RANDOM_PASSWORD,
      (endpoint, signal) => getRandomPassword(endpoint, {}, signal),
      (result) => {
        if (result.RandomPassword === undefined) throw new Error('No password returned.');
        setDraft({ format: 'string', text: result.RandomPassword });
      },
    );
  };

  const handleTagChange = (index: number, field: keyof TagDraft, value: string) => {
    setTags((current) => current.map((tag, at) => (at === index ? { ...tag, [field]: value } : tag)));
  };

  return (
    <SpaceBetween size="l">
      <Header variant="h1">Store a secret</Header>
      <form onSubmit={handleSubmit}>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" formAction="none" disabled={busy} onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={action.pending === CREATE_SECRET}
                disabled={!ready || busy || action.disabled(CREATE_SECRET)}
              >
                Store a secret
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Secret details</Header>}>
              <SpaceBetween size="m">
                <FormField label="Secret name">
                  <Input
                    value={name}
                    disabled={busy}
                    autoComplete={false}
                    onChange={({ detail }) => setName(detail.value)}
                  />
                </FormField>
                <FormField label="Description" constraintText="Optional">
                  <Textarea
                    value={description}
                    disabled={busy}
                    onChange={({ detail }) => setDescription(detail.value)}
                  />
                </FormField>
                <FormField
                  label="KMS key ARN"
                  description="Use an existing KMS key in your local emulator."
                  constraintText="Optional"
                >
                  <Input value={keyArn} disabled={busy} onChange={({ detail }) => setKeyArn(detail.value)} />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Secret value</Header>}>
              <SecretValueFields
                value={draft}
                disabled={busy}
                onChange={setDraft}
                generate={
                  <Button
                    formAction="none"
                    loading={action.pending === GET_RANDOM_PASSWORD}
                    disabled={busy || action.disabled(GET_RANDOM_PASSWORD)}
                    onClick={handleGenerate}
                  >
                    Generate password
                  </Button>
                }
              />
            </Container>
            <Container header={<Header variant="h2">Tags</Header>}>
              <AttributeEditor
                items={tags}
                addButtonText="Add tag"
                removeButtonText="Remove"
                disableAddButton={busy}
                isItemRemovable={() => !busy}
                onAddButtonClick={() => setTags((current) => [...current, { Key: '', Value: '' }])}
                onRemoveButtonClick={({ detail }) =>
                  setTags((current) => current.filter((_, at) => at !== detail.itemIndex))
                }
                definition={[
                  {
                    label: 'Key',
                    control: (tag, index) => (
                      <Input
                        value={tag?.Key ?? ''}
                        disabled={busy}
                        onChange={({ detail }) => handleTagChange(index, 'Key', detail.value)}
                      />
                    ),
                  },
                  {
                    label: 'Value',
                    control: (tag, index) => (
                      <Input
                        value={tag?.Value ?? ''}
                        disabled={busy}
                        onChange={({ detail }) => handleTagChange(index, 'Value', detail.value)}
                      />
                    ),
                  },
                ]}
              />
            </Container>
            {Array.from(action.unavailable, (operation) => (
              <Alert key={operation} type="info" header="Not implemented by the emulator">
                The emulator answered 501 Not Implemented for {operation}.
              </Alert>
            ))}
            {action.failure?.kind !== 'not-implemented' && (
              <LifecycleFeedback action={action} connection={connection} what="Secret operation" />
            )}
          </SpaceBetween>
        </Form>
      </form>
      <DiscardDialog
        visible={asking}
        onAnswer={(answer) => {
          setAsking(false);
          if (answer === 'discard') void navigate(SECRETS_PATH);
        }}
      />
    </SpaceBetween>
  );
}
