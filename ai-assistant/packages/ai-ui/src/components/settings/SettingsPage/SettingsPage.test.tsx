import type { SavedConfigurations } from '@headlamp-k8s/ai-common/providers/savedConfigs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAxe } from '../../../testing/runAxe';
import type { DeveloperSettingsProps } from '../DeveloperSettings/DeveloperSettings';
import type { ModelSelectorProps } from '../ModelSelector/ModelSelector';
import { SettingsPage, type SettingsPageProps } from './SettingsPage';
import {
  createMockStore,
  emptySettingsArgs,
  fullSettingsArgs,
  withProviderArgs,
} from './SettingsPage.stories';

const autoDetectMocks = vi.hoisted(() => ({
  useAutoDetect: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../AutoDetectProvider/AutoDetectProvider', () => ({
  useAutoDetect: autoDetectMocks.useAutoDetect,
  AutoDetectProvider: () => <section aria-label="Auto Detect Results" />,
}));

vi.mock('../ModelSelector/ModelSelector', () => ({
  default: (props: ModelSelectorProps) => (
    <section aria-label="Model Selector">
      <span data-testid="active-provider">{props.selectedProvider}</span>
      <span data-testid="active-name">{props.configName}</span>
      <span data-testid="saved-count">{props.savedConfigs.providers?.length ?? 0}</span>
      <button
        type="button"
        onClick={() =>
          props.onChange?.({
            providerId: 'anthropic',
            config: { apiKey: 'new-key', model: 'claude' },
            displayName: 'Anthropic',
          })
        }
      >
        Change Active
      </button>
      <button
        type="button"
        onClick={() =>
          props.onChange?.({
            providerId: 'copilot',
            config: { apiKey: 'token' },
            displayName: 'Copilot',
            savedConfigs: {
              providers: [{ providerId: 'copilot', config: { apiKey: 'token' } }],
            },
          })
        }
      >
        Save Provider
      </button>
      <button
        type="button"
        onClick={() => props.onTermsAccept?.({ providers: [], termsAccepted: true })}
      >
        Accept Terms
      </button>
    </section>
  ),
}));

vi.mock('../AIToolsSettings/AIToolsSettings', () => ({
  AIToolsSettings: ({ onToolToggle }: { onToolToggle: (id: string) => void }) => (
    <section aria-label="AI Tools">
      <button type="button" onClick={() => onToolToggle('web-search')}>
        Toggle Tool
      </button>
    </section>
  ),
}));

vi.mock('../MCPSettings/MCPSettings', () => ({
  MCPSettings: () => <section aria-label="MCP Settings" />,
}));

vi.mock('../SkillSettings/SkillSettings', () => ({
  SkillSettings: () => <section aria-label="Skill Settings" />,
}));

vi.mock('../HolmesAgentSettings/HolmesAgentSettings', () => ({
  HolmesAgentSettings: ({
    onConfigChange,
  }: {
    onConfigChange: (patch: Record<string, unknown>) => void;
  }) => (
    <section aria-label="Holmes Settings">
      <button type="button" onClick={() => onConfigChange({ holmesPort: 8080 })}>
        Change Holmes
      </button>
    </section>
  ),
}));

vi.mock('../DeveloperSettings/DeveloperSettings', () => ({
  DeveloperSettings: (props: DeveloperSettingsProps) => (
    <section aria-label="Developer Settings">
      <button
        type="button"
        onClick={() => props.onDevOptionsChange({ ...props.devOptions, enableMockAgent: true })}
      >
        Change Developer Options
      </button>
      <button
        type="button"
        onClick={() => props.onConfigsChange?.({ providers: [], termsAccepted: false })}
      >
        Change Developer Configs
      </button>
    </section>
  ),
}));

function renderSettings(args: SettingsPageProps, overrides: Partial<SettingsPageProps> = {}) {
  return render(
    <main>
      <SettingsPage {...args} {...overrides} />
    </main>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  autoDetectMocks.useAutoDetect.mockReturnValue({
    autoDetecting: false,
    handleAutoDetect: vi.fn(async () => undefined),
    detectedProviders: [],
    showDetectedDialog: false,
    setShowDetectedDialog: vi.fn(),
    handleAddDetectedProviders: vi.fn(),
    handleDismissDetectedProviders: vi.fn(),
  });
});

afterEach(cleanup);

describe('SettingsPage provider orchestration', () => {
  it('renders OpenAI defaults for the empty story without debug text and passes axe', async () => {
    renderSettings(emptySettingsArgs);

    expect(screen.getByTestId('active-provider').textContent).toBe('openai');
    expect(screen.queryByText('meow')).toBeNull();
    expect(screen.getByRole('region', { name: 'MCP Settings' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Skill Settings' })).toBeTruthy();
    await expect(runAxe()).resolves.toEqual([]);
  });

  it('initializes from the active saved provider', () => {
    renderSettings(withProviderArgs);

    expect(screen.getByTestId('active-provider').textContent).toBe('openai');
    expect(screen.getByTestId('active-name').textContent).toBe('OpenAI');
    expect(screen.getByTestId('saved-count').textContent).toBe('1');
  });

  it('synchronizes active state when the host replaces saved configs', async () => {
    const { rerender } = renderSettings(withProviderArgs);
    const copilotConfigs: SavedConfigurations = {
      providers: [
        {
          providerId: 'copilot',
          displayName: 'GitHub Copilot',
          config: { apiKey: 'token', model: 'gpt-4o' },
        },
      ],
      defaultProviderIndex: 0,
    };

    rerender(
      <main>
        <SettingsPage {...withProviderArgs} savedConfigs={copilotConfigs} />
      </main>
    );

    await waitFor(() => expect(screen.getByTestId('active-provider').textContent).toBe('copilot'));
    expect(screen.getByTestId('active-name').textContent).toBe('GitHub Copilot');
  });

  it('updates local active state without persisting when no collection is supplied', () => {
    const onConfigsChange = vi.fn();
    renderSettings(emptySettingsArgs, { onConfigsChange });

    fireEvent.click(screen.getByRole('button', { name: 'Change Active' }));

    expect(screen.getByTestId('active-provider').textContent).toBe('anthropic');
    expect(onConfigsChange).not.toHaveBeenCalled();
  });

  it('persists a saved collection supplied by the model selector', () => {
    const onConfigsChange = vi.fn();
    renderSettings(emptySettingsArgs, { onConfigsChange });

    fireEvent.click(screen.getByRole('button', { name: 'Save Provider' }));

    expect(onConfigsChange).toHaveBeenCalledWith({
      providers: [{ providerId: 'copilot', config: { apiKey: 'token' } }],
    });
    expect(screen.getByTestId('active-provider').textContent).toBe('copilot');
  });

  it('forwards terms acceptance only when the host callback exists', () => {
    const onTermsAccept = vi.fn();
    const { rerender } = renderSettings(emptySettingsArgs, { onTermsAccept });
    fireEvent.click(screen.getByRole('button', { name: 'Accept Terms' }));
    expect(onTermsAccept).toHaveBeenCalledWith({ providers: [], termsAccepted: true });

    rerender(
      <main>
        <SettingsPage {...emptySettingsArgs} onTermsAccept={undefined} />
      </main>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept Terms' }));
  });
});

describe('SettingsPage optional sections', () => {
  it('renders and wires the preview toggle', () => {
    const onPreviewChange = vi.fn();
    renderSettings(emptySettingsArgs, { onPreviewChange, previewEnabled: false });

    fireEvent.click(screen.getByRole('checkbox', { name: /Preview Features/ }));

    expect(onPreviewChange).toHaveBeenCalledWith(true);
  });

  it('defaults the preview toggle to enabled', () => {
    renderSettings(emptySettingsArgs, { onPreviewChange: vi.fn(), previewEnabled: undefined });
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: /Preview Features/ }).checked
    ).toBe(true);
  });

  it('renders test mode, toggles it, and resets a shown popover', () => {
    const onTestModeChange = vi.fn();
    const onResetPopover = vi.fn();
    renderSettings(emptySettingsArgs, {
      isTestMode: true,
      onTestModeChange,
      hasShownConfigPopover: true,
      onResetPopover,
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /Test Mode/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(onTestModeChange).toHaveBeenCalledWith(false);
    expect(onResetPopover).toHaveBeenCalledOnce();
    expect(screen.getByText(/has been shown and dismissed/)).toBeTruthy();
  });

  it('disables reset before the popover has been shown', () => {
    renderSettings(emptySettingsArgs, {
      isTestMode: true,
      onTestModeChange: vi.fn(),
      hasShownConfigPopover: false,
      onResetPopover: vi.fn(),
    });

    expect(screen.getByText(/will show when no AI providers/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reset' }).disabled).toBe(true);
  });

  it('renders tools only when all tool callbacks are present', () => {
    const onToolToggle = vi.fn();
    const { rerender } = renderSettings(emptySettingsArgs, { onToolToggle });
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Tool' }));
    expect(onToolToggle).toHaveBeenCalledWith('web-search');

    rerender(
      <main>
        <SettingsPage {...emptySettingsArgs} onToolToggle={undefined} />
      </main>
    );
    expect(screen.queryByRole('region', { name: 'AI Tools' })).toBeNull();
  });

  it('renders Holmes and AKS sections and forwards Holmes changes', () => {
    const onHolmesConfigChange = vi.fn();
    renderSettings(withProviderArgs, { onHolmesConfigChange });

    fireEvent.click(screen.getByRole('button', { name: 'Change Holmes' }));

    expect(onHolmesConfigChange).toHaveBeenCalledWith({ holmesPort: 8080 });
    expect(screen.getByRole('link', { name: /Learn how to install/ }).getAttribute('href')).toBe(
      withProviderArgs.aksDocUrl
    );
  });

  it('renders developer settings and forwards both callbacks', () => {
    const onDevOptionsChange = vi.fn();
    const onConfigsChange = vi.fn();
    renderSettings(emptySettingsArgs, {
      devOptions: {},
      onDevOptionsChange,
      onConfigsChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change Developer Options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change Developer Configs' }));

    expect(onDevOptionsChange).toHaveBeenCalledWith({ enableMockAgent: true });
    expect(onConfigsChange).toHaveBeenCalledWith({ providers: [], termsAccepted: false });
  });

  it('renders the full story without axe violations', async () => {
    renderSettings(fullSettingsArgs, {
      devOptions: { enableMockModel: true },
      onDevOptionsChange: vi.fn(),
    });

    await expect(runAxe()).resolves.toEqual([]);
  });
});

describe('SettingsPage auto-detect wiring', () => {
  it('passes host auto-detect dependencies to the hook', () => {
    const onDismissProviders = vi.fn();
    const configStore = createMockStore();
    renderSettings(emptySettingsArgs, {
      configStore,
      dismissedProviders: ['copilot'],
      onDismissProviders,
      commandRunner: null,
    });

    expect(autoDetectMocks.useAutoDetect).toHaveBeenCalledWith(
      expect.objectContaining({
        savedConfigs: emptySettingsArgs.savedConfigs,
        dismissedProviders: ['copilot'],
        onDismissProviders,
        commandRunner: null,
      })
    );
  });

  it('accepts an active configuration update from auto-detect', () => {
    renderSettings(emptySettingsArgs);
    const hookArgs = autoDetectMocks.useAutoDetect.mock.calls[0][0] as {
      onActiveConfigChange: (active: {
        providerId: string;
        config: Record<string, unknown>;
        displayName: string;
      }) => void;
    };

    act(() =>
      hookArgs.onActiveConfigChange({
        providerId: 'local',
        config: { model: 'llama3' },
        displayName: 'Ollama',
      })
    );

    expect(screen.getByTestId('active-provider').textContent).toBe('local');
  });
});
