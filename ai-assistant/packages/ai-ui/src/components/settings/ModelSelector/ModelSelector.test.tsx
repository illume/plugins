/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {
  CommandRunner,
  DetectedProvider,
} from '@headlamp-k8s/ai-common/providers/detectProvider';
import type { SavedConfigurations } from '@headlamp-k8s/ai-common/providers/savedConfigs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAxe } from '../../../testing/runAxe';
import ModelSelector, { type ModelSelectorProps } from './ModelSelector';
import {
  autoDetectingArgs,
  emptyArgs,
  withAutoDetectArgs,
  withCopilotProviderArgs,
  withMultipleProvidersArgs,
} from './ModelSelector.stories';

const detectionMocks = vi.hoisted(() => ({
  detectCopilotChatModels: vi.fn(),
  detectCopilotProvider: vi.fn(),
  detectGhCliAvailable: vi.fn(),
  detectProviders: vi.fn(),
  refreshGitHubToken: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options
        ? key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
            String(options[name] ?? `{{${name}}}`)
          )
        : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('@headlamp-k8s/ai-common/providers/detectProvider', async importOriginal => ({
  ...(await importOriginal<typeof import('@headlamp-k8s/ai-common/providers/detectProvider')>()),
  ...detectionMocks,
}));

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: { icon: string }) => <span aria-hidden="true" data-icon={icon} />,
}));

function renderSelector(args: ModelSelectorProps, overrides: Partial<ModelSelectorProps> = {}) {
  const props = { ...args, ...overrides };
  return render(
    <main>
      <ModelSelector {...props} />
    </main>
  );
}

function openProviderMenu(index = 0): void {
  fireEvent.click(screen.getAllByRole('button', { name: 'More options' })[index]);
}

async function openEditDialog(index = 0): Promise<void> {
  openProviderMenu(index);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
}

const commandRunner: CommandRunner = vi.fn(async () => ({ stdout: '', exitCode: 0 }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  detectionMocks.detectCopilotChatModels.mockResolvedValue([]);
  detectionMocks.detectCopilotProvider.mockResolvedValue(null);
  detectionMocks.detectGhCliAvailable.mockResolvedValue(true);
  detectionMocks.detectProviders.mockResolvedValue([]);
  detectionMocks.refreshGitHubToken.mockResolvedValue('refreshed-token');
});

describe('ModelSelector static states', () => {
  it('renders the empty Storybook state without axe violations', async () => {
    renderSelector(emptyArgs);

    expect(screen.getByText('No AI providers configured yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Auto Detect' })).toBeNull();
    await expect(runAxe()).resolves.toEqual([]);
  });

  it('renders saved provider data from the multiple-provider story', () => {
    renderSelector(withMultipleProvidersArgs);

    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('GitHub Copilot')).toBeTruthy();
    expect(screen.getByText('Ollama (llama3)')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
  });

  it('renders the external auto-detect story and invokes its callback', () => {
    const onAutoDetect = vi.fn();
    renderSelector(withAutoDetectArgs, { onAutoDetect });

    fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));

    expect(onAutoDetect).toHaveBeenCalledOnce();
  });

  it('exposes busy state for the detecting story', async () => {
    renderSelector(autoDetectingArgs);

    const button = screen.getByRole('button', { name: 'Detecting…' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
    await expect(runAxe()).resolves.toEqual([]);
  });

  it('selects saved providers by keyboard outside config view', () => {
    const onChange = vi.fn();
    renderSelector(withMultipleProvidersArgs, { isConfigView: false, onChange });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Select GitHub Copilot' }), {
      key: 'Enter',
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'copilot', displayName: 'GitHub Copilot' })
    );
  });

  it('does not expose provider cards as buttons in config view', () => {
    renderSelector(withMultipleProvidersArgs);

    expect(screen.queryByRole('button', { name: 'Select OpenAI' })).toBeNull();
  });

  it('handles Space selection and missing change callbacks safely', () => {
    renderSelector(withMultipleProvidersArgs, { isConfigView: false, onChange: undefined });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Select OpenAI' }), { key: ' ' });
    fireEvent.click(screen.getAllByRole('button', { name: 'More options' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make Default' }));

    expect(screen.getByText('Configured Providers')).toBeTruthy();
  });

  it('renders fallback labels for an unknown provider without model metadata', async () => {
    renderSelector(withMultipleProvidersArgs, {
      selectedProvider: 'custom',
      config: {},
      savedConfigs: {
        providers: [{ providerId: 'custom', config: {} }],
      },
    });

    expect(screen.getByText('custom')).toBeTruthy();
    expect(screen.getByText('Configuration')).toBeTruthy();

    await openEditDialog();
    expect(screen.getByRole('heading', { name: 'Configure Provider' })).toBeTruthy();
  });
});

describe('ModelSelector terms and provider selection', () => {
  it('requires terms before adding the first provider and closes on cancel', async () => {
    renderSelector(emptyArgs);
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }));

    expect(screen.getAllByRole('heading', { name: /AI Assistant Terms/ })).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /AI Assistant Terms/ })).toBeNull()
    );
  });

  it('accepts terms and advances to the keyboard-accessible provider dialog', async () => {
    const onTermsAccept = vi.fn();
    renderSelector(emptyArgs, { onTermsAccept });
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand and accept/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept & Continue' }));

    expect(onTermsAccept).toHaveBeenCalledWith(expect.objectContaining({ termsAccepted: true }));
    const providerButton = await screen.findByRole('button', { name: 'Configure OpenAI' });
    await expect(runAxe(screen.getByRole('dialog', { name: 'Select Provider' }))).resolves.toEqual(
      []
    );

    fireEvent.keyDown(providerButton, { key: ' ' });
    expect(await screen.findByRole('heading', { name: 'Configure OpenAI' })).toBeTruthy();
  });

  it('opens provider selection immediately after terms were accepted', async () => {
    renderSelector({ ...emptyArgs, savedConfigs: { providers: [], termsAccepted: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }));

    expect(await screen.findByRole('heading', { name: 'Select Provider' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Select Provider' })).toBeNull()
    );
  });

  it('advances after accepting terms when no persistence callback is supplied', async () => {
    renderSelector(emptyArgs, { onTermsAccept: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand and accept/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept & Continue' }));

    const anthropicButton = await screen.findByRole('button', { name: 'Configure Anthropic' });
    fireEvent.keyDown(anthropicButton, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'Configure Anthropic' })).toBeTruthy();
  });

  it('generates the next numbered name for another provider configuration', async () => {
    const savedConfigs: SavedConfigurations = {
      termsAccepted: true,
      providers: [
        { providerId: 'openai', displayName: 'OpenAI', config: { apiKey: 'one', model: 'gpt-4o' } },
        {
          providerId: 'openai',
          displayName: 'OpenAI 2',
          config: { apiKey: 'two', model: 'gpt-4o' },
        },
      ],
    };
    renderSelector(withMultipleProvidersArgs, { savedConfigs });
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Configure OpenAI' }));

    expect(screen.getByDisplayValue('OpenAI 3')).toBeTruthy();
  });
});

describe('ModelSelector saved configuration actions', () => {
  it('opens only the selected card menu and passes axe', async () => {
    renderSelector(withMultipleProvidersArgs);
    openProviderMenu(1);

    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getAllByRole('menuitem', { name: 'Edit' })).toHaveLength(1);
    await expect(runAxe(screen.getByRole('menu'))).resolves.toEqual([]);
  });

  it('opens and closes the edit dialog with the saved display name', async () => {
    renderSelector(withMultipleProvidersArgs);
    await openEditDialog(1);

    expect(screen.getByRole('heading', { name: 'Configure GitHub Copilot' })).toBeTruthy();
    expect(screen.getByDisplayValue('GitHub Copilot')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Configure GitHub Copilot' })).toBeNull()
    );
  });

  it('makes the selected saved configuration the default', async () => {
    const onChange = vi.fn();
    renderSelector(withMultipleProvidersArgs, { onChange });
    openProviderMenu(1);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Make Default' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'copilot',
        savedConfigs: expect.objectContaining({ defaultProviderIndex: 1 }),
      })
    );
  });

  it('deletes the active provider and selects the remaining default', async () => {
    const onChange = vi.fn();
    renderSelector(withCopilotProviderArgs, { onChange });
    openProviderMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    expect(screen.getByRole('dialog', { name: 'Delete Configuration' })).toBeTruthy();
    await expect(runAxe()).resolves.toEqual([]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai', savedConfigs: expect.any(Object) })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete Configuration' })).toBeNull()
    );
  });

  it('selects the next saved configuration after deleting the active one', async () => {
    const onChange = vi.fn();
    renderSelector(withMultipleProvidersArgs, { onChange });
    openProviderMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'copilot', displayName: 'GitHub Copilot' })
    );
  });

  it('deletes an inactive provider without changing the active settings', async () => {
    const onChange = vi.fn();
    renderSelector(withMultipleProvidersArgs, { onChange });
    openProviderMenu(1);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai', config: withMultipleProvidersArgs.config })
    );
  });

  it('cancels deletion without reporting changes', async () => {
    const onChange = vi.fn();
    renderSelector(withCopilotProviderArgs, { onChange });
    openProviderMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete Configuration' })).toBeNull()
    );
  });
});

describe('ModelSelector configuration editing', () => {
  it('disables save until required values are present', async () => {
    renderSelector({ ...emptyArgs, savedConfigs: { providers: [], termsAccepted: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Configure OpenAI' }));

    expect(screen.getByText('Please fill in all required fields.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('edits a config name, model, visibility switch, and saves', async () => {
    const onChange = vi.fn();
    renderSelector(withMultipleProvidersArgs, { onChange });
    await openEditDialog();

    fireEvent.change(screen.getByPlaceholderText('Give this configuration a name'), {
      target: { value: 'Primary OpenAI' },
    });
    const modelInput = screen.getByPlaceholderText(/Enter or select model name/);
    fireEvent.change(modelInput, { target: { value: 'custom-model' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Show only this model/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Primary OpenAI' })
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ model: 'custom-model', showOnlyThisModel: true }),
      })
    );
  });

  it('resets a custom model to the provider default', async () => {
    renderSelector(withMultipleProvidersArgs, {
      config: { apiKey: 'sk-example', model: 'custom-model' },
      savedConfigs: {
        ...withMultipleProvidersArgs.savedConfigs,
        providers: [
          {
            providerId: 'openai',
            displayName: 'OpenAI',
            config: { apiKey: 'sk-example', model: 'custom-model' },
          },
        ],
      },
    });
    await openEditDialog();

    fireEvent.click(screen.getByTitle('Reset to default model'));

    await waitFor(() => expect(screen.getByDisplayValue('gpt-4.1')).toBeTruthy());
  });
});

describe('ModelSelector auto-detection', () => {
  it('runs built-in provider detection when no external callback is supplied', async () => {
    const detected: DetectedProvider[] = [
      {
        providerId: 'local',
        source: 'Ollama',
        config: { baseUrl: 'http://localhost:11434', model: 'llama3' },
        displayName: 'Ollama',
      },
    ];
    detectionMocks.detectProviders.mockResolvedValue(detected);
    const onAutoDetectResults = vi.fn();
    renderSelector(emptyArgs, { commandRunner, onAutoDetectResults });

    fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));

    await waitFor(() => expect(onAutoDetectResults).toHaveBeenCalledWith(detected));
  });

  it('does not report empty or rejected built-in detection', async () => {
    const onAutoDetectResults = vi.fn();
    renderSelector(emptyArgs, { commandRunner, onAutoDetectResults });
    fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));
    await waitFor(() => expect(detectionMocks.detectProviders).toHaveBeenCalled());
    expect(onAutoDetectResults).not.toHaveBeenCalled();

    detectionMocks.detectProviders.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));
    await waitFor(() => expect(detectionMocks.detectProviders).toHaveBeenCalledTimes(2));
    expect(onAutoDetectResults).not.toHaveBeenCalled();
  });

  it('applies detected Copilot settings and fetches models with a refreshed token', async () => {
    detectionMocks.detectCopilotProvider.mockResolvedValue({
      providerId: 'copilot',
      source: 'GitHub CLI',
      config: { apiKey: '__GH_CLI_AUTH__', model: 'gpt-4o' },
      displayName: 'Detected Copilot',
    });
    detectionMocks.detectCopilotChatModels.mockResolvedValue([
      { id: 'gpt-5', name: 'GPT-5', version: '1' },
    ]);
    renderSelector(withCopilotProviderArgs, { commandRunner });
    await openEditDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));

    expect(await screen.findByText('Detected and applied provider settings.')).toBeTruthy();
    expect(detectionMocks.refreshGitHubToken).toHaveBeenCalledWith(commandRunner);
    expect(detectionMocks.detectCopilotChatModels).toHaveBeenCalledWith('refreshed-token');
  });

  it('uses a detected literal token without refreshing GitHub authentication', async () => {
    detectionMocks.detectCopilotProvider.mockResolvedValue({
      providerId: 'copilot',
      source: 'Environment',
      config: { apiKey: 'literal-detected-token', model: 'gpt-4o' },
      displayName: '',
    });
    renderSelector(withCopilotProviderArgs, { commandRunner });
    await openEditDialog();
    await waitFor(() => expect(detectionMocks.refreshGitHubToken).toHaveBeenCalled());
    vi.clearAllMocks();
    detectionMocks.detectCopilotProvider.mockResolvedValue({
      providerId: 'copilot',
      source: 'Environment',
      config: { apiKey: 'literal-detected-token', model: 'gpt-4o' },
      displayName: '',
    });
    detectionMocks.detectCopilotChatModels.mockResolvedValue([]);

    fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));

    await waitFor(() =>
      expect(detectionMocks.detectCopilotChatModels).toHaveBeenCalledWith('literal-detected-token')
    );
    expect(detectionMocks.refreshGitHubToken).not.toHaveBeenCalled();
  });

  it('loads live Copilot models from a sufficiently long typed token', async () => {
    const typedToken = 'github-token-that-is-longer-than-thirty-characters';
    const args: ModelSelectorProps = {
      ...withCopilotProviderArgs,
      config: { apiKey: typedToken, model: 'gpt-4o' },
      savedConfigs: {
        ...withCopilotProviderArgs.savedConfigs,
        providers: [
          {
            providerId: 'copilot',
            displayName: 'GitHub Copilot',
            config: { apiKey: typedToken, model: 'gpt-4o' },
          },
        ],
      },
    };
    detectionMocks.detectCopilotChatModels.mockResolvedValue([
      { id: 'live-model', name: 'Live Model', version: '1' },
    ]);
    renderSelector(args, { commandRunner });
    await openEditDialog();

    await waitFor(
      () => expect(detectionMocks.detectCopilotChatModels).toHaveBeenCalledWith(typedToken),
      { timeout: 1200 }
    );
  });

  it('does not fetch live models for short typed tokens or failed token refresh', async () => {
    const shortTokenArgs: ModelSelectorProps = {
      ...withCopilotProviderArgs,
      config: { apiKey: 'short-token', model: 'gpt-4o' },
      savedConfigs: {
        ...withCopilotProviderArgs.savedConfigs,
        providers: [
          {
            providerId: 'copilot',
            displayName: 'GitHub Copilot',
            config: { apiKey: 'short-token', model: 'gpt-4o' },
          },
        ],
      },
    };
    renderSelector(shortTokenArgs, { commandRunner });
    await openEditDialog();
    expect(detectionMocks.detectCopilotChatModels).not.toHaveBeenCalled();

    cleanup();
    vi.clearAllMocks();
    detectionMocks.refreshGitHubToken.mockResolvedValue(null);
    renderSelector(withCopilotProviderArgs, { commandRunner });
    await openEditDialog();
    await waitFor(() => expect(detectionMocks.refreshGitHubToken).toHaveBeenCalled());
    expect(detectionMocks.detectCopilotChatModels).not.toHaveBeenCalled();
  });

  it('shows installation guidance when Copilot and GitHub CLI are unavailable', async () => {
    detectionMocks.detectGhCliAvailable.mockResolvedValue(false);
    renderSelector(withCopilotProviderArgs, { commandRunner });
    await openEditDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));

    expect(await screen.findByText(/No detectable settings found/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Get started with GitHub CLI' })).toBeTruthy();
  });

  it('reports missing settings without an install hint when GitHub CLI is available', async () => {
    renderSelector(withCopilotProviderArgs, { commandRunner });
    await openEditDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));

    expect(await screen.findByText(/No detectable settings found/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Get started with GitHub CLI' })).toBeNull();
  });

  it('shows an error when provider detection rejects', async () => {
    detectionMocks.detectCopilotProvider.mockRejectedValue(new Error('offline'));
    renderSelector(withCopilotProviderArgs, { commandRunner });
    await openEditDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));

    expect(
      await screen.findByText('Auto-detection failed unexpectedly. Please try again.')
    ).toBeTruthy();
  });
});
