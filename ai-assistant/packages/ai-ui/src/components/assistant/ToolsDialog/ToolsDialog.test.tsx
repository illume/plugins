import type { MCPToolsConfig } from '@headlamp-k8s/ai-common/mcp/types';
import type { DialogProps } from '@mui/material';
import { Dialog } from '@mui/material';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { runAxe } from '../../../testing/runAxe';
import type { DesktopApi, ElectronMCPApi } from '../../../types/electron';
import { ToolsDialog, type ToolsDialogProps } from './ToolsDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      key.replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));
vi.mock('@iconify/react', () => ({
  Icon: ({ icon, ...props }: { icon: string; 'aria-hidden'?: boolean | 'true' | 'false' }) => (
    <span data-icon={icon} {...props} />
  ),
}));

afterEach(() => {
  cleanup();
  delete window.desktopApi;
});

const toolsConfig: MCPToolsConfig = {
  'cluster-inspector': {
    get_pods: { enabled: true, usageCount: 12 },
    get_logs: { enabled: false, usageCount: 3 },
  },
  metrics: {
    top_pods: { enabled: true, usageCount: 7 },
  },
};

function TestDialog(props: DialogProps): React.ReactElement {
  return <Dialog {...props} TransitionProps={{ timeout: 0 }} />;
}

function installDesktopApi(
  config: MCPToolsConfig = structuredClone(toolsConfig),
  overrides: Partial<ElectronMCPApi> = {}
): ElectronMCPApi {
  const mcp: ElectronMCPApi = {
    executeTool: vi.fn(),
    getStatus: vi.fn(),
    resetClient: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    getToolsConfig: vi.fn().mockResolvedValue({ success: true, config }),
    updateToolsConfig: vi.fn().mockResolvedValue({ success: true }),
    setToolEnabled: vi.fn(),
    getToolStats: vi.fn(),
    ...overrides,
  };
  const desktopApi: DesktopApi = {
    send: vi.fn(),
    receive: vi.fn(),
    removeListener: vi.fn(),
    mcp,
  };
  window.desktopApi = desktopApi;
  return mcp;
}

function renderDialog(overrides: Partial<ToolsDialogProps> = {}): ToolsDialogProps {
  const props: ToolsDialogProps = {
    open: true,
    onClose: vi.fn(),
    enabledTools: ['kubernetes_api_request'],
    onToolsChange: vi.fn(),
    DialogSlot: TestDialog,
    ...overrides,
  };
  render(<ToolsDialog {...props} />);
  return props;
}

async function waitForTools(): Promise<void> {
  const summary = await screen.findByRole('button', { name: 'cluster-inspector (2 tools)' });
  await waitFor(() => expect(summary.getAttribute('aria-expanded')).toBe('true'));
  await screen.findByLabelText('Enable cluster-inspector__get_pods');
}

it('loads Storybook-shaped MCP data and has no axe violations', async () => {
  installDesktopApi();
  renderDialog();
  expect(screen.getByRole('status').textContent).toContain('Loading MCP tools...');
  await waitForTools();
  expect(screen.getByLabelText('Enable cluster-inspector__get_pods')).toHaveProperty(
    'checked',
    true
  );
  expect(screen.getByLabelText('Enable cluster-inspector__get_logs')).toHaveProperty(
    'checked',
    false
  );
  expect(screen.getByLabelText('Enable all tools from cluster-inspector')).toHaveProperty(
    'checked',
    false
  );
  await expect(runAxe()).resolves.toEqual([]);
});

it('filters MCP tools and reports empty search results', async () => {
  installDesktopApi();
  renderDialog();
  await waitForTools();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search MCP tools' }), {
    target: { value: 'top_pods' },
  });
  expect(screen.queryByText('cluster-inspector (2 tools)')).toBeNull();
  expect(screen.getByText('metrics (1 tool)')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search MCP tools' }), {
    target: { value: 'missing' },
  });
  expect(screen.getByText('No tools match your search query.')).toBeTruthy();
});

it('collapses and reopens a server and skips persistence when settings are unchanged', async () => {
  const mcp = installDesktopApi();
  const props = renderDialog();
  await waitForTools();
  const summary = screen.getByRole('button', { name: 'cluster-inspector (2 tools)' });
  fireEvent.click(summary);
  expect(summary.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(summary);
  expect(summary.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mcp.updateToolsConfig).not.toHaveBeenCalled();
  expect(props.onToolsChange).toHaveBeenCalledWith(['kubernetes_api_request']);
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it('shows a successful empty MCP config and can enable a regular tool', async () => {
  const mcp = installDesktopApi({});
  const props = renderDialog({ enabledTools: [] });
  expect(
    await screen.findByText(
      'No MCP tools available. Connect to MCP servers to see available tools.'
    )
  ).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByLabelText('Enable kubernetes_api_request'));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mcp.updateToolsConfig).not.toHaveBeenCalled();
  expect(props.onToolsChange).toHaveBeenCalledWith(['kubernetes_api_request']);
});

it('toggles individual, server, and regular tools before persisting once', async () => {
  const mcp = installDesktopApi();
  const props = renderDialog();
  await waitForTools();
  fireEvent.click(screen.getByLabelText('Enable cluster-inspector__get_logs'));
  expect(screen.getByLabelText('Enable all tools from cluster-inspector')).toHaveProperty(
    'checked',
    true
  );
  fireEvent.click(screen.getByLabelText('Enable all tools from cluster-inspector'));
  fireEvent.click(screen.getByLabelText('Enable kubernetes_api_request'));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(mcp.updateToolsConfig).toHaveBeenCalledTimes(1));
  expect(mcp.updateToolsConfig).toHaveBeenCalledWith(
    expect.objectContaining({
      'cluster-inspector': expect.objectContaining({
        get_pods: expect.objectContaining({ enabled: false }),
        get_logs: expect.objectContaining({ enabled: false }),
      }),
    })
  );
  expect(props.onToolsChange).toHaveBeenCalledWith([]);
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it('cancels edits and resynchronizes enabled tools from props', async () => {
  installDesktopApi();
  const onClose = vi.fn();
  const onToolsChange = vi.fn();
  const { rerender } = render(
    <ToolsDialog
      open
      onClose={onClose}
      enabledTools={[]}
      onToolsChange={onToolsChange}
      DialogSlot={TestDialog}
    />
  );
  await waitForTools();
  rerender(
    <ToolsDialog
      open
      onClose={onClose}
      enabledTools={['kubernetes_api_request']}
      onToolsChange={onToolsChange}
      DialogSlot={TestDialog}
    />
  );
  expect(screen.getByText('1 built-in tool enabled')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Enable cluster-inspector__get_pods'));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onToolsChange).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('keeps previously discovered tools enabled when refreshed config omits them', async () => {
  const mcp = installDesktopApi();
  const props: ToolsDialogProps = {
    open: true,
    onClose: vi.fn(),
    enabledTools: [],
    onToolsChange: vi.fn(),
    DialogSlot: TestDialog,
  };
  const { rerender } = render(<ToolsDialog {...props} />);
  await waitForTools();
  vi.mocked(mcp.getToolsConfig).mockResolvedValue({ success: true, config: {} });
  rerender(<ToolsDialog {...props} open={false} />);
  rerender(<ToolsDialog {...props} />);
  const summary = await screen.findByRole('button', { name: 'cluster-inspector (2 tools)' });
  fireEvent.click(summary);
  expect(await screen.findByLabelText('Enable cluster-inspector__get_logs')).toHaveProperty(
    'checked',
    true
  );
});

it('ignores a stale load response after the dialog is reopened', async () => {
  let resolveFirstLoad: (value: { success: true; config: MCPToolsConfig }) => void = () => {};
  const firstLoad = new Promise<{ success: true; config: MCPToolsConfig }>(resolve => {
    resolveFirstLoad = resolve;
  });
  const mcp = installDesktopApi({}, { getToolsConfig: vi.fn().mockReturnValueOnce(firstLoad) });
  const props: ToolsDialogProps = {
    open: true,
    onClose: vi.fn(),
    enabledTools: [],
    onToolsChange: vi.fn(),
    DialogSlot: TestDialog,
  };
  const { rerender } = render(<ToolsDialog {...props} />);
  rerender(<ToolsDialog {...props} open={false} />);
  vi.mocked(mcp.getToolsConfig).mockResolvedValue({ success: true, config: toolsConfig });
  rerender(<ToolsDialog {...props} />);
  await waitForTools();
  resolveFirstLoad({ success: true, config: {} });
  await Promise.resolve();
  expect(screen.getByRole('button', { name: 'cluster-inspector (2 tools)' })).toBeTruthy();
});

it('keeps the dialog open and regular changes uncommitted when MCP save fails', async () => {
  installDesktopApi(toolsConfig, {
    updateToolsConfig: vi.fn().mockResolvedValue({ success: false }),
  });
  const props = renderDialog();
  await waitForTools();
  fireEvent.click(screen.getByLabelText('Enable cluster-inspector__get_pods'));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Failed to save MCP tool settings.'
  );
  expect(props.onToolsChange).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
});

it('reports a host callback failure without closing the dialog', async () => {
  installDesktopApi({});
  const props = renderDialog({
    onToolsChange: vi.fn(() => {
      throw new Error('host settings rejected');
    }),
  });
  await screen.findByText('No MCP tools available. Connect to MCP servers to see available tools.');
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Failed to save tool settings.');
  expect(props.onClose).not.toHaveBeenCalled();
});

it('reports unavailable and rejected MCP loads without crashing', async () => {
  const props = renderDialog();
  expect((await screen.findByRole('alert')).textContent).toContain('Failed to load MCP tools.');
  expect(
    screen.getByText('No MCP tools available. Connect to MCP servers to see available tools.')
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(props.onToolsChange).toHaveBeenCalledWith(['kubernetes_api_request']);
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it.each([
  vi.fn().mockResolvedValue({ success: false, error: 'host rejected load' }),
  vi.fn().mockRejectedValue(new Error('bridge disconnected')),
])('reports an available bridge load failure', async getToolsConfig => {
  installDesktopApi({}, { getToolsConfig });
  renderDialog();
  expect((await screen.findByRole('alert')).textContent).toContain('Failed to load MCP tools.');
  expect(
    screen.getByText('No MCP tools available. Connect to MCP servers to see available tools.')
  ).toBeTruthy();
});
