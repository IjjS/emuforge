import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs, { type TabsProps } from '@cloudscape-design/components/tabs';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { OPERATIONS, type Topic } from '../api';
import { DeleteTopicDialog } from '../components/delete-topic-dialog';
import { PublishTab } from '../components/publish-tab';
import type { FilterPolicyRecovery } from '../components/subscription-settings';
import { SubscriptionsTab, type SubscriptionsTabProps } from '../components/subscriptions-tab';
import {
  TopicOperationUnavailable,
  TopicSettings,
  type TopicSettingsOperation,
  type TopicSettingsProps,
} from '../components/topic-settings';
import {
  NONE,
  publishTabHref,
  settingsTabHref,
  TAB_PARAMETER,
  tabOf,
  topicHref,
  topicName,
  TOPICS_PATH,
} from '../format';
import { EMPTY_FORM, type PublishForm, type PublishResult } from '../publish-form';
import {
  failureOf,
  useDeleteTopic,
  usePageSignal,
  useSetSubscriptionSetting,
  useSetTopicSetting,
  useTagTopic,
  useTopic,
  useTopicTags,
  useUntagTopic,
} from '../queries';

// A topic's page, S3 (issue 536, design task 1 step 2, task 3 step 1, task 5 step 2): its header with "Refresh" and
// "Delete", "Topic details" from `GetTopicAttributes`, then the tabs addressed by the query
// of the topic’s one address, so the page stays mounted across them and keeps the publish
// form's text and its last result. A topic the emulator does not hold shows "Topic not found" in their place.

const REFRESHED = 'Topic refreshed';
const ARN_LABEL = 'ARN';

function FilterPolicyFocusAction({ recovery }: { recovery: FilterPolicyRecovery }) {
  const { signal, focus } = recovery;
  const subscribe = useCallback(
    (notify: () => void) => {
      signal.addEventListener('abort', notify);
      return () => signal.removeEventListener('abort', notify);
    },
    [signal],
  );
  const open = useSyncExternalStore(subscribe, () => !signal.aborted);
  return open ? <Button onClick={focus}>Return to filter policy</Button> : null;
}

/** "Topic details". */
function TopicDetails({ topic }: { topic: Topic }) {
  const name = topicName(topic.arn);
  const items: { label: string; value: ReactNode }[] = [
    { label: ARN_LABEL, value: <CopyValue label={ARN_LABEL} value={topic.arn} kind="address" none={NONE} /> },
    { label: 'Type', value: <ValueText kind="fixed" value={topic.fifo ? 'FIFO' : 'Standard'} /> },
    { label: 'Display name', value: <ValueText kind="text" value={topic.displayName} none={NONE} /> },
  ];
  if (topic.fifo) {
    items.push({
      label: 'Content-based deduplication',
      value: <ValueText kind="fixed" value={topic.contentBasedDeduplication ? 'On' : 'Off'} />,
    });
  }
  items.push({
    label: 'Subscriptions',
    value: (
      <ValueText
        kind="fixed"
        value={`${String(topic.confirmed ?? 0)} confirmed, ${String(topic.pending ?? 0)} pending`}
      />
    ),
  });
  return (
    <Container header={<Header variant="h2">Topic details</Header>}>
      <KeyValuePairs columns={2} minColumnWidth={300} items={items} ariaLabel={`Details of ${name}`} />
    </Container>
  );
}

/** "Topic not found", with Cloudscape's empty-state pattern, in the place of the details and the tabs. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Topic not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no topic with this ARN.
          </Box>
          <Link href={TOPICS_PATH} onFollow={handleFollow}>
            View topics
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

interface TopicTabsProps extends Pick<SubscriptionsTabProps, 'onSaveSetting' | 'settingsSave'> {
  topic: Topic;
  settings: ReactNode;
  arn: string;
  connection: AreaConnection;
  onTopicChanged: () => void;
  form: PublishForm;
  onFormChange: (form: PublishForm) => void;
  result: PublishResult | undefined;
  onResultChange: (result: PublishResult | undefined) => void;
}

/** Choosing a topic tab changes only the query. */
function TopicTabs({
  topic,
  settings,
  arn,
  connection,
  onTopicChanged,
  onSaveSetting,
  settingsSave,
  form,
  onFormChange,
  result,
  onResultChange,
}: TopicTabsProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const active = tabOf(searchParams.get(TAB_PARAMETER));
  const handleChange = useCallback(
    ({ detail }: { detail: TabsProps.ChangeDetail }) => {
      if (detail.activeTabHref !== undefined) {
        void navigate(detail.activeTabHref);
      }
    },
    [navigate],
  );
  const tabs: TabsProps.Tab[] = [
    {
      id: 'subscriptions',
      label: 'Subscriptions',
      href: topicHref(arn),
      content: (
        <SubscriptionsTab
          topicArn={arn}
          topicName={topicName(arn)}
          connection={connection}
          onTopicChanged={onTopicChanged}
          onSaveSetting={onSaveSetting}
          settingsSave={settingsSave}
        />
      ),
    },
    {
      id: 'publish',
      label: 'Publish',
      href: publishTabHref(arn),
      content: (
        <PublishTab
          topicArn={arn}
          fifo={topic.fifo}
          contentBasedDeduplication={topic.contentBasedDeduplication}
          connection={connection}
          form={form}
          onFormChange={onFormChange}
          result={result}
          onResultChange={onResultChange}
        />
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      href: settingsTabHref(arn),
      content: settings,
    },
  ];
  return (
    <Tabs
      tabs={tabs}
      activeTabId={active}
      onChange={handleChange}
      keyboardActivationMode="manual"
      ariaLabel="Topic tabs"
    />
  );
}

/**
 * `/aws/sns/topics/topic/{arn}`: the topic `arn`, read on every opening and refresh, and after each action that
 * changes it. A failed read is read again once the connection is connected again, so after an emulator restart the
 * page shows "Topic not found".
 */
export function TopicPage({ connection, params }: ScreenPageProps) {
  useShowsResources('topics');
  const arn = params['arn'] ?? '';
  const name = topicName(arn);
  const client = useQueryClient();
  const [announcement, announce] = useAnnouncer();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const [searchParams] = useSearchParams();
  const inSettings = tabOf(searchParams.get(TAB_PARAMETER)) === 'settings';
  const endpoint = connection.engineOrigin;
  const scope = JSON.stringify([endpoint, arn]);
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    currentScope.current = scope;
  }, [scope]);
  const [unavailableOperations, setUnavailableOperations] = useState<ReadonlySet<string>>(() => new Set());
  const operationKey = (operation: string) => JSON.stringify([scope, operation]);
  const rememberUnavailable = (operation: string) => {
    const key = operationKey(operation);
    setUnavailableOperations((current) => new Set([...current, key]));
  };
  const attributesUnavailable = inSettings && unavailableOperations.has(operationKey(OPERATIONS.getTopicAttributes));
  const reading = useTopic(endpoint, arn, !attributesUnavailable);
  const { value: read, failure, refresh } = reading;
  const topic = read?.found === true ? read.topic : undefined;
  const tagsUnavailable = unavailableOperations.has(operationKey(OPERATIONS.listTagsForResource));
  const tags = useTopicTags(
    endpoint,
    arn,
    inSettings && topic !== undefined && !attributesUnavailable && !tagsUnavailable,
  );
  const operationUnavailable = attributesUnavailable || (inSettings && failure?.kind === 'not-implemented');
  if (inSettings && !attributesUnavailable && failure?.kind === 'not-implemented') {
    rememberUnavailable(OPERATIONS.getTopicAttributes);
  }
  if (inSettings && !tagsUnavailable && tags.failure?.kind === 'not-implemented') {
    rememberUnavailable(OPERATIONS.listTagsForResource);
  }

  const setTopicSetting = useSetTopicSetting(endpoint);
  const tagTopic = useTagTopic(endpoint);
  const untagTopic = useUntagTopic(endpoint);
  const writes = [OPERATIONS.setTopicAttributes, OPERATIONS.tagResource, OPERATIONS.untagResource] as const;
  const activeWrites = useRef(new Set<string>());
  const [pendingWrites, setPendingWrites] = useState<ReadonlySet<string>>(() => new Set());
  const removeTopic = useDeleteTopic(endpoint);
  const saveSetting = useSetSubscriptionSetting(connection.engineOrigin, arn);
  const savingSetting = useRef(false);
  const [pendingSetting, setPendingSetting] = useState<SubscriptionsTabProps['settingsSave']['pending']>();
  const [unavailableArns, setUnavailableArns] = useState<ReadonlySet<string>>(() => new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<PublishForm>(EMPTY_FORM);
  const [result, setResult] = useState<PublishResult>();
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'topic');

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const [refreshing, setRefreshing] = useState(false);
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const failureLine = failureState?.firstText;
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  if (refreshing && read !== undefined && !reading.loading) {
    setRefreshing(false);
    announce(REFRESHED);
  } else if (refreshing && failure !== undefined) {
    setRefreshing(false);
  }
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (failure !== undefined || wasDown)) {
      setWasDown(false);
      if (!operationUnavailable) {
        refresh();
      }
    }
  }

  /** The topic, its subscriptions and their deliveries read again. */
  const readAgain = useCallback(() => {
    refresh();
    void client.invalidateQueries({ queryKey: ['aws', 'sns', 'subscriptions', arn] });
    void client.invalidateQueries({ queryKey: ['aws', 'sns', 'delivery'] });
  }, [refresh, client, arn]);

  const handleRefresh = () => {
    if (operationUnavailable) {
      return;
    }
    setRefreshing(true);
    readAgain();
  };

  const writeTopic = async (
    operation: TopicSettingsOperation,
    write: (signal: AbortSignal) => Promise<void>,
    success: string,
    action: string,
  ): ReturnType<TopicSettingsProps['onSaveSetting']> => {
    const key = operationKey(operation);
    if (activeWrites.current.has(key) || unavailableOperations.has(key)) {
      return { saved: false };
    }

    const signal = pageSignal();
    activeWrites.current.add(key);
    setPendingWrites(new Set(activeWrites.current));
    try {
      await write(signal);
      if (signal.aborted || currentScope.current !== scope) {
        return { saved: false };
      }
      flash.show([{ type: 'success', content: success }]);
      return { saved: true };
    } catch (error) {
      if (signal.aborted) {
        return { saved: false };
      }
      const failure = failureOf(error, operation);
      const item = actionFailureItem(failure, action, endpoint);
      if (currentScope.current === scope) {
        flash.show([item]);
      }
      if (failure.kind === 'not-implemented') {
        rememberUnavailable(operation);
        return { saved: false };
      }
      return { saved: false, error: item };
    } finally {
      activeWrites.current.delete(key);
      if (!signal.aborted) {
        setPendingWrites(new Set(activeWrites.current));
      }
    }
  };

  const handleSaveTopicSetting: TopicSettingsProps['onSaveSetting'] = (setting) => {
    const name = setting.name === 'DisplayName' ? 'Display name' : 'Access policy';
    return writeTopic(
      OPERATIONS.setTopicAttributes,
      (signal) => setTopicSetting(arn, setting, signal),
      `${name} saved.`,
      `Save ${name.toLowerCase()}`,
    );
  };

  const handleSaveTag: TopicSettingsProps['onSaveTag'] = (tag) =>
    writeTopic(OPERATIONS.tagResource, (signal) => tagTopic(arn, tag, signal), 'Tag saved.', 'Save tag');

  const handleRemoveTag: TopicSettingsProps['onRemoveTag'] = (key) =>
    writeTopic(OPERATIONS.untagResource, (signal) => untagTopic(arn, key, signal), 'Tag removed.', 'Remove tag');

  const handleSaveSetting: SubscriptionsTabProps['onSaveSetting'] = async (subscriptionArn, setting, recovery) => {
    if (savingSetting.current || unavailableArns.has(subscriptionArn)) {
      return false;
    }
    const signal = pageSignal();
    savingSetting.current = true;
    setPendingSetting({ arn: subscriptionArn, setting });
    try {
      await saveSetting(subscriptionArn, setting, signal);
      if (!signal.aborted) {
        flash.show([
          {
            type: 'success',
            header: 'Subscription settings updated',
            content: <ValueText kind="address" value={subscriptionArn} />,
          },
        ]);
      }
      return !signal.aborted;
    } catch (error) {
      if (!signal.aborted) {
        const failure = failureOf(error, OPERATIONS.setSubscriptionAttributes);
        if (failure.kind === 'not-implemented') {
          setUnavailableArns((current) => new Set([...current, subscriptionArn]));
        }
        const item = actionFailureItem(failure, 'Save subscription settings', connection.engineOrigin);
        const editor = item.type === 'error' && recovery?.signal.aborted === false ? recovery : undefined;
        editor?.showError(item.content ?? item.header);
        flash.show([
          {
            ...item,
            content: (
              <SpaceBetween size="xxs">
                <Box>{item.content} </Box>
                <ValueText kind="address" value={subscriptionArn} />
                {editor !== undefined && <FilterPolicyFocusAction recovery={editor} />}
              </SpaceBetween>
            ),
          },
        ]);
      }
      return false;
    } finally {
      savingSetting.current = false;
      if (!signal.aborted) {
        setPendingSetting(undefined);
      }
    }
  };

  const handleDelete = () => {
    const signal = pageSignal();
    setDeleting(true);
    removeTopic(arn, signal).then(
      () => {
        if (signal.aborted) {
          return;
        }
        flash.handOver(TOPICS_PATH, [{ type: 'success', content: `Deleted topic ${name}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) {
          return;
        }
        setDeleting(false);
        setDeleteOpen(false);
        flash.show([
          actionFailureItem(failureOf(error, OPERATIONS.deleteTopic), `Delete topic ${name}`, connection.engineOrigin),
        ]);
      },
    );
  };

  let content;
  if (operationUnavailable) {
    content = (
      <Container>
        <TopicOperationUnavailable operation={OPERATIONS.getTopicAttributes} />
      </Container>
    );
  } else if (failureState !== undefined) {
    content = (
      <Container>
        {inSettings && failure?.kind === 'access-denied' ? (
          <SpaceBetween size="xxs">
            <StatusIndicator type="error">{failureState.first}</StatusIndicator>
            <Box>{failureState.detail}</Box>
          </SpaceBetween>
        ) : (
          <ReadFailure state={failureState} onRetry={refresh} />
        )}
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading topic</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (topic === undefined) {
    content = <NotFound />;
  } else {
    content = (
      <SpaceBetween size="l">
        <TopicDetails topic={topic} />
        <TopicTabs
          topic={topic}
          settings={
            <TopicSettings
              key={scope}
              topic={topic}
              connection={connection}
              tags={tags}
              unavailable={
                new Set(
                  [...writes, OPERATIONS.listTagsForResource].filter((operation) =>
                    unavailableOperations.has(operationKey(operation)),
                  ),
                )
              }
              pending={new Set(writes.filter((operation) => pendingWrites.has(operationKey(operation))))}
              onSaveSetting={handleSaveTopicSetting}
              onSaveTag={handleSaveTag}
              onRemoveTag={handleRemoveTag}
            />
          }
          arn={arn}
          connection={connection}
          onTopicChanged={readAgain}
          onSaveSetting={handleSaveSetting}
          settingsSave={{ pending: pendingSetting, unavailableArns }}
          form={form}
          onFormChange={setForm}
          result={result}
          onResultChange={setResult}
        />
      </SpaceBetween>
    );
  }

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh"
                  disabled={operationUnavailable}
                  onClick={handleRefresh}
                />
                {topic !== undefined && (
                  <Button
                    onClick={() => {
                      setDeleteOpen(true);
                    }}
                  >
                    Delete
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={name} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      <DeleteTopicDialog
        visible={deleteOpen}
        name={name}
        pending={deleting}
        onConfirm={handleDelete}
        onDismiss={() => {
          setDeleteOpen(false);
        }}
      />
      {announcement}
    </>
  );
}
