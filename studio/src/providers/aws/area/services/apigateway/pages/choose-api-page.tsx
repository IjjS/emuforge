import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { ScreenPageProps } from '../../../screens';
import { apiChoices } from '../api-choices';
import type { ApiRow } from '../apis-api';
import { PagedChoice } from '../components/paged-choice';
import { createApiPath, restApiPath, v2ApiPath } from '../format';

export type ApiChoiceDestination =
  { model: 'rest'; part: 'resources' | 'stages' } | { model: 'v2'; part: 'routes' | 'integrations' | 'stages' };

interface ChooseApiPageProps extends ScreenPageProps {
  name: string;
  destination: ApiChoiceDestination;
}

export function ChooseApiPage({ connection, name, destination: { model, part } }: ChooseApiPageProps) {
  useShowsResources('APIs');
  const navigate = useNavigate();
  const handleFollow = useFollow();
  const [selected, setSelected] = useState<ApiRow>();
  const [empty, setEmpty] = useState(false);
  const [opening, setOpening] = useState(0);
  const choice = useRef<HTMLDivElement>(null);
  const things = model === 'rest' ? 'REST APIs' : 'HTTP or WebSocket APIs';
  const source = apiChoices(connection.engineOrigin, model);

  useEffect(() => {
    const trigger = choice.current?.querySelector('button[aria-haspopup="dialog"]');
    if (trigger === undefined || trigger === null) return;

    // Select requests its first page once. Its trigger exposes subsequent openings even when focus stays inside.
    let opened = false;
    const observer = new MutationObserver(() => {
      if (trigger.getAttribute('aria-expanded') !== 'true') return;
      if (opened) setOpening((previous) => previous + 1);
      opened = true;
    });
    observer.observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] });
    return () => observer.disconnect();
  }, []);

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={`${name} belong to an API. Choose the API to open them.`}>
        {name}
      </Header>
      <Container>
        <SpaceBetween size="m">
          <FormField label="API">
            <div ref={choice}>
              <PagedChoice
                source={{
                  ...source,
                  key: [...source.key, opening],
                  read: async (endpoint, text, token, signal) => {
                    if (token === undefined) setEmpty(false);
                    const page = await source.read(endpoint, text, token, signal);
                    if (token === undefined && !signal.aborted) {
                      setEmpty(page.items.length === 0 && page.next === undefined);
                    }
                    return page;
                  },
                }}
                connection={connection}
                things={things}
                placeholder="Choose an API"
                value={selected}
                onChange={setSelected}
              />
            </div>
          </FormField>
          {empty ? (
            <Box textAlign="center">
              <SpaceBetween size="xs">
                <Box variant="strong">No {things}</Box>
                <Box variant="p">The emulator holds none.</Box>
                <Button href={createApiPath} onFollow={handleFollow}>
                  Create API
                </Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Button
              variant="primary"
              disabled={selected === undefined}
              onClick={() => {
                if (selected === undefined) return;
                const path = model === 'rest' ? restApiPath : v2ApiPath;
                void navigate(path(selected.id, part));
              }}
            >
              Open
            </Button>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}
