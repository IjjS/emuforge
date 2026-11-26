import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'Event Functions',
        path: '/aws/lambda/functions',
        listedBy: 'ListFunctions',
      },
      {
        label: 'Layers',
        path: '/aws/lambda/layers',
        listedBy: 'ListLayers',
      },
      {
        label: 'Aliases',
        path: '/aws/lambda/aliases',
        listedBy: 'ListAliases',
        listedInside: '/aws/lambda/functions',
        shownIn: {
          entry: '/aws/lambda/functions',
          place: 'the "Versions and aliases" tab of a function',
        },
      },
      {
        label: 'Capacity providers',
        path: '/aws/lambda/capacity-providers',
        listedBy: 'ListCapacityProviders',
      },
      {
        label: 'Code signing configs',
        path: '/aws/lambda/code-signing-configs',
        listedBy: 'ListCodeSigningConfigs',
      },
      {
        label: 'Durable executions',
        path: '/aws/lambda/durable-executions',
        listedBy: 'ListDurableExecutionsByFunction',
        listedInside: '/aws/lambda/functions',
      },
      {
        label: 'Event source mappings',
        path: '/aws/lambda/event-source-mappings',
        listedBy: 'ListEventSourceMappings',
        shownIn: {
          entry: '/aws/lambda/functions',
          place: 'the "Event sources" tab of a function',
        },
      },
      {
        label: 'Function event invoke configs',
        path: '/aws/lambda/function-event-invoke-configs',
        listedBy: 'ListFunctionEventInvokeConfigs',
        listedInside: '/aws/lambda/functions',
      },
      {
        label: 'Function url configs',
        path: '/aws/lambda/function-url-configs',
        listedBy: 'ListFunctionUrlConfigs',
        listedInside: '/aws/lambda/functions',
      },
      {
        label: 'Layer versions',
        path: '/aws/lambda/layer-versions',
        listedBy: 'ListLayerVersions',
        listedInside: '/aws/lambda/layers',
        shownIn: {
          entry: '/aws/lambda/layers',
          place: 'the "Versions" table of a layer selected on the Layers screen',
        },
      },
      {
        label: 'Provisioned concurrency configs',
        path: '/aws/lambda/provisioned-concurrency-configs',
        listedBy: 'ListProvisionedConcurrencyConfigs',
        listedInside: '/aws/lambda/functions',
      },
      {
        label: 'Versions',
        path: '/aws/lambda/versions',
        listedBy: 'ListVersionsByFunction',
        listedInside: '/aws/lambda/functions',
        shownIn: {
          entry: '/aws/lambda/functions',
          place: 'the "Versions and aliases" tab of a function',
        },
      },
    ],
  },
];
