import pauseIcon from '@iconify/icons-mdi/pause';
import playIcon from '@iconify/icons-mdi/play';
import { addIcon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import store from '@kinvolk/headlamp-plugin/lib/redux/stores/store';
import type { Meta, StoryObj } from '@storybook/react';
import { delay, http, HttpResponse } from 'msw';
import { useEffect, useMemo } from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, useHistory } from 'react-router-dom';
import { expect, userEvent, within } from 'storybook/test';
import { getConfigStore } from '../../../util';
import { GenericMetricsChart } from './GenericMetricsChart';

addIcon('mdi:pause', pauseIcon);
addIcon('mdi:play', playIcon);

interface StoryArgs {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet';
}

function MarkerStory({ kind }: StoryArgs) {
  const history = useHistory();
  const resource = useMemo(() => {
    const Resource = K8s.ResourceClasses[kind];
    return new Resource(
      {
        ...Resource.getBaseObject(),
        apiVersion: 'apps/v1',
        kind,
        metadata: {
          name: 'web',
          namespace: 'apps',
          uid: `${kind}-uid`,
          resourceVersion: '1',
          creationTimestamp: '2026-11-13T18:00:00Z',
        },
        spec: {
          selector: { matchLabels: { app: 'web' } },
          updateStrategy: {
            type: 'RollingUpdate',
            rollingUpdate: { partition: 0, maxUnavailable: 1 },
          },
          template: { spec: { containers: [], nodeName: '' } },
        },
        status: {},
      },
      'revision-chart-story'
    );
  }, [kind]);
  useEffect(() => {
    getConfigStore().set({
      'revision-chart-story': {
        isMetricsEnabled: true,
        autoDetect: false,
        address: 'monitoring/prometheus:9090',
        defaultTimespan: '6h',
        defaultResolution: 'high',
      },
    });
    history.replace('/c/revision-chart-story/deployments/apps/web');
  }, [history]);
  return (
    <GenericMetricsChart
      resource={resource}
      cpuQuery="cpu"
      memoryQuery="memory"
      networkRxQuery="receive"
      networkTxQuery="transmit"
      filesystemReadQuery="read"
      filesystemWriteQuery="write"
    />
  );
}

function revisions(kind: StoryArgs['kind']) {
  const now = Date.now();
  return [1, 2].map(revision => ({
    apiVersion: 'apps/v1',
    kind: kind === 'Deployment' ? 'ReplicaSet' : 'ControllerRevision',
    metadata: {
      name: `web-${revision}`,
      namespace: 'apps',
      uid: `${kind}-${revision}`,
      labels: { app: 'web' },
      creationTimestamp: new Date(now - (revision === 1 ? 4 : 1) * 3600000).toISOString(),
      annotations: { 'deployment.kubernetes.io/revision': String(revision) },
      ownerReferences: [{ apiVersion: 'apps/v1', kind, name: 'web', uid: `${kind}-uid` }],
    },
    revision,
    spec: { template: { spec: { containers: [] } } },
    data: { spec: { template: { spec: { containers: [] } } } },
    status: {},
  }));
}

const historyHandlers = [
  http.get(/\/replicasets/, () =>
    HttpResponse.json({
      kind: 'ReplicaSetList',
      metadata: { resourceVersion: '1' },
      items: revisions('Deployment'),
    })
  ),
  http.get(/\/controllerrevisions/, () =>
    HttpResponse.json({
      kind: 'ControllerRevisionList',
      metadata: { resourceVersion: '1' },
      items: [...revisions('StatefulSet'), ...revisions('DaemonSet')],
    })
  ),
];

const metricsHandler = http.get(/\/api\/v1\/query_range/, ({ request }) => {
  const params = new URL(request.url).searchParams;
  const start = Number(params.get('start'));
  const end = Number(params.get('end'));
  const scale =
    params.get('query') === 'memory' ? 1024 ** 3 : params.get('query') === 'cpu' ? 1 : 1024 ** 2;
  return HttpResponse.json({
    status: 'success',
    data: {
      result: [
        {
          metric: {},
          values: Array.from({ length: 31 }, (_, index) => [
            start + ((end - start) * index) / 30,
            String(
              scale *
                (start + ((end - start) * index) / 30 < end - 3600
                  ? 0.3 + Math.sin(index / 3) * 0.05
                  : 0.65 + Math.sin(index / 3) * 0.1)
            ),
          ]),
        },
      ],
    },
  });
});

async function selectRange({ canvasElement }: { canvasElement: HTMLElement }) {
  const canvas = within(canvasElement);
  await userEvent.click(
    await canvas.findByRole('combobox', { name: 'Timespan' }, { timeout: 15000 })
  );
  await userEvent.click(
    await within(canvasElement.ownerDocument.body).findByRole('option', { name: '6 hours' })
  );
}

const meta = {
  title: 'Charts/WorkloadRevisionMarkers',
  args: { kind: 'Deployment' },
  decorators: [
    Story => (
      <Provider store={store}>
        <MemoryRouter>
          <Story />
        </MemoryRouter>
      </Provider>
    ),
  ],
  parameters: {
    msw: {
      handlers: {
        story: [metricsHandler, ...historyHandlers],
        translations: [
          http.get(/\/plugins\/prometheus\/locales\/.*\/translation\.json/, () =>
            HttpResponse.json({})
          ),
        ],
      },
    },
  },
  render: args => <MarkerStory {...args} />,
} satisfies Meta<StoryArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Deployment: Story = {
  play: async context => {
    await selectRange(context);
    await expect(
      await within(context.canvasElement).findByText('r2', {}, { timeout: 15000 })
    ).toBeVisible();
  },
};
export const StatefulSet: Story = { ...Deployment, args: { kind: 'StatefulSet' } };
export const DaemonSet: Story = { ...Deployment, args: { kind: 'DaemonSet' } };
export const MarkerTooltip: Story = {
  play: async context => {
    await selectRange(context);
    const canvas = within(context.canvasElement);
    const label = await canvas.findByText('r2', {}, { timeout: 15000 });
    const marker = canvas.getByRole('img', { name: 'r2' });
    const line = marker.querySelector('line');
    if (!line) throw new Error('Missing marker line');
    for (const element of [label, line]) {
      const bounds = element.getBoundingClientRect();
      await userEvent.pointer({
        target: element,
        coords: { clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 },
      });
      await expect(
        await within(context.canvasElement.ownerDocument.body).findByRole('tooltip')
      ).toHaveTextContent('not rollout completion');
    }
  },
};
export const Loading: Story = {
  play: selectRange,
  parameters: {
    msw: {
      handlers: {
        story: [
          metricsHandler,
          http.get(/\/replicasets/, async () => {
            await delay('infinite');
            return HttpResponse.json({});
          }),
        ],
      },
    },
  },
};
export const ForbiddenHistory: Story = {
  play: selectRange,
  parameters: {
    msw: {
      handlers: {
        story: [
          metricsHandler,
          http.get(/\/replicasets/, () =>
            HttpResponse.json({ message: 'Forbidden' }, { status: 403 })
          ),
        ],
      },
    },
  },
};
export const EmptyHistory: Story = {
  play: selectRange,
  parameters: {
    msw: {
      handlers: {
        story: [
          metricsHandler,
          http.get(/\/replicasets/, () => HttpResponse.json({ kind: 'ReplicaSetList', items: [] })),
        ],
      },
    },
  },
};
