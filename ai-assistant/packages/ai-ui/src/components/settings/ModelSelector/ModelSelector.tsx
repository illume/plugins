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

import {
  getDefaultConfig,
  getProviderById,
  getProviderFields,
  modelProviders,
} from '@headlamp-k8s/ai-common/providers/catalog';
import {
  type CommandRunner,
  detectCopilotChatModels,
  detectCopilotProvider,
  DetectedProvider,
  detectGhCliAvailable,
  detectProviders,
  GH_CLI_AUTH_SENTINEL,
  refreshGitHubToken,
} from '@headlamp-k8s/ai-common/providers/detectProvider';
import {
  deleteProviderConfig,
  getActiveConfig,
  isSameStoredConfig,
  ProviderSettings,
  SavedConfigurations,
  saveProviderConfig,
  saveTermsAcceptance,
  StoredProviderConfig,
} from '@headlamp-k8s/ai-common/providers/savedConfigs';
import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  FormHelperText,
  Grid,
  IconButton,
  Link as MuiLink,
  Menu,
  MenuItem,
  Paper,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Autocomplete } from '@mui/material';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DefaultDialog } from '../../defaults/DefaultSlots/DefaultSlots';
import TermsDialog from '../TermsDialog/TermsDialog';

/** Props for the ProviderSelectionDialog that lets users pick an AI provider. */
interface ProviderSelectionDialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Callback invoked when the dialog is dismissed. */
  onClose: () => void;
  /** Callback invoked when the user selects a provider by its ID. */
  onSelectProvider: (providerId: string) => void;
  /** Component used to render the dialog shell. Falls back to MUI Dialog. */
  DialogSlot?: React.ElementType;
}

/**
 * Returns a provider setting as a form-safe string.
 *
 * @param config - Provider settings to read.
 * @param fieldName - Setting key to retrieve.
 * @returns String or number values converted to text, otherwise an empty string.
 */
function getStringSetting(config: ProviderSettings, fieldName: string): string {
  const value = config[fieldName];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * Checks whether a provider setting contains a form value.
 *
 * @param config - Provider settings to inspect.
 * @param fieldName - Setting key to check.
 * @returns Whether the value is neither absent nor an empty string.
 */
function hasSettingValue(config: ProviderSettings, fieldName: string): boolean {
  const value = config[fieldName];
  return value !== undefined && value !== null && value !== '';
}

/**
 * Renders the dialog used to choose a provider for a new configuration.
 *
 * @param props - Provider selection dialog properties.
 * @returns Provider selection dialog UI.
 */
function ProviderSelectionDialog({
  open,
  onClose,
  onSelectProvider,
  DialogSlot = DefaultDialog,
}: ProviderSelectionDialogProps) {
  const { t } = useTranslation();
  return (
    <DialogSlot open={open} onClose={onClose} maxWidth="md">
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Icon icon="mdi:plus-circle" width="24px" height="24px" />
          <Typography variant="h6" component="span">
            {t('Select Provider')}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
          {t('Select a provider to add a new configuration')}
        </Typography>
        <Grid container spacing={2}>
          {modelProviders.map(provider => (
            <Grid item key={provider.id} xs={6} md={3}>
              <Paper
                aria-label={t('Configure {{provider}}', { provider: t(provider.name) })}
                role="button"
                tabIndex={0}
                sx={{
                  p: 2,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: 'divider',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  transition: 'all 0.2s',
                  '&:hover': {
                    borderColor: 'primary.main',
                    boxShadow: 2,
                  },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: 2,
                  },
                }}
                onClick={() => {
                  onSelectProvider(provider.id);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectProvider(provider.id);
                  }
                }}
              >
                <Icon icon={provider.icon} width="32px" height="32px" />
                <Typography variant="body1" sx={{ mt: 1, fontWeight: 'medium' }}>
                  {t(provider.name)}
                </Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancel')}</Button>
      </DialogActions>
    </DialogSlot>
  );
}

// Configuration dialog component
/** Props for the ConfigurationDialog that edits provider-specific settings. */
interface ConfigurationDialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Callback invoked when the dialog is dismissed. */
  onClose: () => void;
  /** The ID of the AI provider being configured. */
  providerId: string;
  /** Current provider configuration key-value map. */
  config: ProviderSettings;
  /** Callback invoked when configuration values change. */
  onConfigChange: (config: ProviderSettings) => void;
  /** Display name for this configuration. */
  configName: string;
  /** Callback invoked when the configuration name is changed. */
  onConfigNameChange?: (name: string) => void;
  /** Callback invoked when the user saves, with flag indicating default status. */
  onSave?: (makeDefault: boolean) => void;
  /** Component used to render the dialog shell. Falls back to MUI Dialog. */
  DialogSlot?: React.ElementType;
  /** Optional CommandRunner for CLI-based per-provider auto-detection. */
  commandRunner?: CommandRunner;
}

/**
 * Renders provider-specific configuration fields and auto-detection controls.
 *
 * @param props - Configuration dialog properties.
 * @returns Provider configuration dialog UI.
 */
function ConfigurationDialog({
  open,
  onClose,
  providerId,
  config,
  onConfigChange,
  configName,
  onConfigNameChange,
  onSave,
  DialogSlot = DefaultDialog,
  commandRunner,
}: ConfigurationDialogProps) {
  const { t } = useTranslation();
  const provider = getProviderById(providerId);
  const fields = getProviderFields(providerId);
  const [initialRender, setInitialRender] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectStatus, setDetectStatus] = useState<{
    kind: 'success' | 'error';
    text: string;
    hint?: ReactNode;
  } | null>(null);
  const [liveModelOptions, setLiveModelOptions] = useState<string[]>([]);

  const isDetectSupported =
    providerId === 'copilot' || providerId === 'azure' || providerId === 'local';

  // Reset detect state when dialog opens/provider changes
  useEffect(() => {
    setDetectStatus(null);
    setIsDetecting(false);
    setLiveModelOptions([]);
  }, [open, providerId]);

  // Live Copilot model fetching when dialog opens with a token
  useEffect(() => {
    if (!open || providerId !== 'copilot' || !commandRunner) return;
    const storedKey = config.apiKey;
    const isSentinel = storedKey === GH_CLI_AUTH_SENTINEL;
    const typedKey = typeof storedKey === 'string' && !isSentinel ? storedKey : undefined;
    if (!isSentinel && !typedKey) return;
    if (typedKey && typedKey.length < 30) return;

    let cancelled = false;
    /**
     * Fetches live Copilot model identifiers for the current token.
     *
     * @returns Promise that settles after model discovery completes or is ignored.
     */
    const run = async () => {
      try {
        const token = typedKey ?? (await refreshGitHubToken(commandRunner));
        if (!token || cancelled) return;
        const models = await detectCopilotChatModels(token);
        if (!cancelled && models && models.length > 0) {
          setLiveModelOptions(models.map(m => m.id));
        }
      } catch {
        // CORS or auth failure — keep static options
      }
    };
    const delay = typedKey ? 600 : 0;
    const timer = setTimeout(run, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, providerId, config.apiKey, commandRunner]);

  /**
   * Detects provider settings and applies them to the dialog.
   *
   * @returns Promise that settles after detection and status updates complete.
   */
  const handleDetect = async () => {
    if (!commandRunner || !isDetectSupported) return;
    setIsDetecting(true);
    setDetectStatus(null);
    try {
      let detected: DetectedProvider | null = null;
      if (providerId === 'copilot') {
        detected = await detectCopilotProvider(commandRunner);
      }
      if (detected) {
        onConfigChange({ ...config, ...detected.config });
        if (
          onConfigNameChange &&
          (!configName || configName === provider?.name || configName === providerId)
        ) {
          onConfigNameChange(detected.displayName || provider?.name || providerId);
        }
        const detectedApiKey = detected.config.apiKey;
        if (detected.config.model && detectedApiKey) {
          const models = await detectCopilotChatModels(
            detectedApiKey === GH_CLI_AUTH_SENTINEL
              ? (await refreshGitHubToken(commandRunner)) ?? ''
              : detectedApiKey
          );
          if (models && models.length > 0) setLiveModelOptions(models.map(m => m.id));
        }
        setDetectStatus({ kind: 'success', text: t('Detected and applied provider settings.') });
      } else {
        let hint: ReactNode | undefined;
        if (providerId === 'copilot') {
          const ghAvailable = await detectGhCliAvailable(commandRunner);
          if (!ghAvailable) {
            hint = (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                {t(
                  'GitHub CLI (gh) does not appear to be installed. Install it to enable GitHub Copilot auto-detection:'
                )}{' '}
                <MuiLink
                  href="https://cli.github.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="caption"
                >
                  {t('Get started with GitHub CLI')}
                </MuiLink>
              </Typography>
            );
          }
        }
        setDetectStatus({
          kind: 'error',
          text: t('No detectable settings found for this provider in your environment.'),
          hint,
        });
      }
    } catch {
      setDetectStatus({
        kind: 'error',
        text: t('Auto-detection failed unexpectedly. Please try again.'),
      });
    } finally {
      setIsDetecting(false);
    }
  };

  /**
   * Updates one provider setting while preserving the remaining dialog values.
   *
   * @param fieldName - Setting key to update.
   * @param value - New setting value.
   * @returns No value.
   */
  const handleFieldChange = (fieldName: string, value: unknown): void => {
    // Update the config with the new field value
    onConfigChange({
      ...config,
      [fieldName]: value,
    });

    // If we're changing a model identifier field and have a standard auto-generated name,
    // this will trigger the useEffect to update the name
    // The useEffect will handle the name update based on the configName pattern
  };

  // Generate a name on initial render if no name is provided
  useEffect(() => {
    // Only set the name if it's an initial render and no name has been set
    if (onConfigNameChange && provider && initialRender && !configName) {
      // Simply use the provider name as the initial configuration name
      const name = provider.name || providerId;
      onConfigNameChange(name);
      setInitialRender(false);
    }
  }, [providerId, configName, onConfigNameChange, provider, initialRender]);

  const isValid = provider?.fields.every(
    field => !field.required || hasSettingValue(config, field.name)
  );

  return (
    <DialogSlot open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          {provider && <Icon icon={provider.icon} width="24px" height="24px" />}
          <Typography variant="h6" component="span">
            {provider
              ? t('Configure {{provider}}', { provider: t(provider.name) })
              : t('Configure Provider')}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        {provider && (
          <Box sx={{ p: 1 }}>
            <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
              {provider.description ? t(provider.description) : null}
            </Typography>

            {onConfigNameChange && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  {t('Configuration Name')}
                </Typography>
                <TextField
                  value={configName}
                  onChange={e => {
                    onConfigNameChange(e.target.value);
                  }}
                  size="small"
                  fullWidth
                  placeholder={t('Give this configuration a name')}
                  helperText={t('A friendly name to identify this configuration')}
                />
              </Box>
            )}

            <Grid container spacing={2}>
              {fields.map(field => (
                <Grid item xs={12} md={6} key={field.name}>
                  {field.type === 'select' && field.name === 'model' ? (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        {t(field.label)}
                        {field.required && (
                          <Box component="span" sx={{ color: 'error.main' }}>
                            {' '}
                            *
                          </Box>
                        )}
                      </Typography>
                      <Autocomplete
                        freeSolo
                        options={
                          liveModelOptions.length > 0 ? liveModelOptions : field.options || []
                        }
                        value={getStringSetting(config, field.name)}
                        onChange={(_, newValue) => {
                          handleFieldChange(field.name, newValue || '');
                        }}
                        onInputChange={(_, newInputValue) => {
                          handleFieldChange(field.name, newInputValue);
                        }}
                        renderInput={params => (
                          <TextField
                            {...params}
                            fullWidth
                            size="small"
                            placeholder={t(
                              'Enter or select model name (e.g., gpt-4, claude-3-opus, custom-model)'
                            )}
                            helperText={
                              getStringSetting(config, field.name)
                                ? field.options?.includes(getStringSetting(config, field.name))
                                  ? t('Using model: {{model}}', {
                                      model: getStringSetting(config, field.name),
                                    })
                                  : t('Using custom model: {{model}}', {
                                      model: getStringSetting(config, field.name),
                                    })
                                : t('Enter a model name or select from the dropdown')
                            }
                            required={field.required}
                            InputProps={{
                              ...params.InputProps,
                              startAdornment:
                                getStringSetting(config, field.name) &&
                                !field.options?.includes(getStringSetting(config, field.name)) ? (
                                  <Box sx={{ mr: 1 }}>
                                    <Chip
                                      label={t('Custom')}
                                      size="small"
                                      color="primary"
                                      variant="outlined"
                                      sx={{ fontSize: '0.7rem', height: '20px' }}
                                    />
                                  </Box>
                                ) : null,
                              endAdornment: getStringSetting(config, field.name) ? (
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    const defaultModel = field.default || field.options?.[0] || '';
                                    handleFieldChange(field.name, defaultModel);
                                  }}
                                  title={t('Reset to default model')}
                                >
                                  <Icon icon="mdi:restore" width="16px" />
                                </IconButton>
                              ) : null,
                            }}
                          />
                        )}
                      />
                      {field.description && <FormHelperText>{t(field.description)}</FormHelperText>}
                    </Box>
                  ) : field.type === 'select' ? (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        {t(field.label)}
                        {field.required && (
                          <Box component="span" sx={{ color: 'error.main' }}>
                            {' '}
                            *
                          </Box>
                        )}
                      </Typography>
                      <Select
                        value={getStringSetting(config, field.name)}
                        onChange={e => handleFieldChange(field.name, e.target.value)}
                        fullWidth
                        size="small"
                        displayEmpty
                        inputProps={{
                          'aria-label': t(field.label),
                          'aria-required': field.required,
                        }}
                      >
                        <MenuItem value="" disabled>
                          <em>{t('Select {{label}}', { label: t(field.label) })}</em>
                        </MenuItem>
                        {field.options?.map(option => (
                          <MenuItem key={option} value={option}>
                            {option}
                          </MenuItem>
                        ))}
                      </Select>
                      {field.description && <FormHelperText>{t(field.description)}</FormHelperText>}
                    </Box>
                  ) : field.type === 'number' ? (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        {t(field.label)}
                        {field.required && (
                          <Box component="span" sx={{ color: 'error.main' }}>
                            {' '}
                            *
                          </Box>
                        )}
                      </Typography>
                      <TextField
                        type="number"
                        value={getStringSetting(config, field.name)}
                        onChange={e => handleFieldChange(field.name, e.target.value)}
                        fullWidth
                        size="small"
                        placeholder={field.placeholder ? t(field.placeholder) : undefined}
                        inputProps={{ step: 0.1 }}
                        required={field.required}
                      />
                      {field.description && <FormHelperText>{t(field.description)}</FormHelperText>}
                    </Box>
                  ) : (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        {t(field.label)}
                        {field.required && (
                          <Box component="span" sx={{ color: 'error.main' }}>
                            {' '}
                            *
                          </Box>
                        )}
                      </Typography>
                      <TextField
                        type={field.name.toLowerCase().includes('key') ? 'password' : 'text'}
                        value={getStringSetting(config, field.name)}
                        onChange={e => handleFieldChange(field.name, e.target.value)}
                        fullWidth
                        size="small"
                        placeholder={field.placeholder ? t(field.placeholder) : undefined}
                        required={field.required}
                        autoComplete={field.name.toLowerCase().includes('key') ? 'off' : undefined}
                      />
                      {field.description && <FormHelperText>{t(field.description)}</FormHelperText>}
                    </Box>
                  )}
                </Grid>
              ))}
            </Grid>

            {/* Show only this model switch - only show if multiple models are available */}
            {(() => {
              // Get all available models for this provider
              const modelField = fields.find(field => field.name === 'model');
              const availableModels = modelField?.options || [];
              const hasCustomModel = Boolean(
                config.model && !availableModels.includes(config.model)
              );
              const totalModels = availableModels.length + (hasCustomModel ? 1 : 0);

              // Only show the switch if there are multiple models available
              if (totalModels > 1) {
                return (
                  <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.showOnlyThisModel === true}
                          onChange={e => {
                            handleFieldChange('showOnlyThisModel', e.target.checked);
                          }}
                          size="small"
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2">
                            {t('Show only this model in chat window')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t(
                              'When enabled, only this specific model will appear in the chat selector, hiding other models from this provider.'
                            )}
                          </Typography>
                        </Box>
                      }
                    />
                  </Box>
                );
              }
              return null;
            })()}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" color={isValid ? 'success.main' : 'error.main'}>
            {isValid ? t('Configuration is valid.') : t('Please fill in all required fields.')}
          </Typography>
          {detectStatus && (
            <Box sx={{ mt: 0.5 }}>
              <Typography
                variant="caption"
                color={detectStatus.kind === 'success' ? 'success.main' : 'error.main'}
                display="block"
              >
                {detectStatus.text}
              </Typography>
              {detectStatus.hint}
            </Box>
          )}
        </Box>
        {commandRunner && isDetectSupported && (
          <Button
            variant="outlined"
            startIcon={
              isDetecting ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <Icon icon="mdi:magnify" />
              )
            }
            onClick={handleDetect}
            disabled={isDetecting}
          >
            {isDetecting ? t('Auto Detecting...') : t('Auto Detect')}
          </Button>
        )}
        <Button onClick={onClose} disabled={isDetecting}>
          {t('Cancel')}
        </Button>
        {onSave && (
          <Button
            variant="contained"
            color="primary"
            onClick={() => onSave(true)}
            disabled={!isValid || isDetecting}
          >
            {t('Save')}
          </Button>
        )}
      </DialogActions>
    </DialogSlot>
  );
}

/** Props for the ModelSelector component that manages AI provider configurations. */
export interface ModelSelectorProps {
  /** ID of the currently selected AI provider. */
  selectedProvider: string;
  /** Current provider configuration key-value map. */
  config: ProviderSettings;
  /** All saved provider configurations. */
  savedConfigs: SavedConfigurations;
  /** Optional display name of the active configuration. */
  configName?: string;
  /** Whether the component is rendered in the settings/config view. */
  isConfigView?: boolean;
  /** Callback invoked when the provider selection or configuration changes. */
  onChange?: (changes: {
    providerId: string;
    config: ProviderSettings;
    displayName: string;
    savedConfigs?: SavedConfigurations;
  }) => void;
  /** Callback invoked when the user accepts provider terms of service. */
  onTermsAccept?: (updatedConfigs: SavedConfigurations) => void;
  /**
   * Callback invoked when auto-detection discovers providers.
   * If provided, an "Auto Detect" button is shown next to "Add Provider".
   */
  onAutoDetect?: () => void;
  /** Whether auto-detection is currently in progress. */
  autoDetecting?: boolean;
  /** Component used to render dialog shells. Falls back to MUI Dialog. */
  DialogSlot?: React.ElementType;
  /**
   * Called with detected providers when "Auto Detect All" completes.
   * The parent is responsible for showing a selection dialog and saving chosen providers.
   */
  onAutoDetectResults?: (providers: DetectedProvider[]) => void;
  /** CommandRunner injected by the host app for CLI-based auto-detection. */
  commandRunner?: CommandRunner;
}

/**
 * Manages saved AI provider configurations and provider setup dialogs.
 *
 * @param props - Model selector properties.
 * @returns Provider configuration management UI.
 */
export default function ModelSelector({
  selectedProvider,
  config,
  savedConfigs,
  configName = '',
  isConfigView = false,
  onChange,
  onTermsAccept,
  onAutoDetect,
  autoDetecting = false,
  DialogSlot = DefaultDialog,
  onAutoDetectResults,
  commandRunner,
}: ModelSelectorProps) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogProviderId, setDialogProviderId] = useState('');
  const [dialogConfig, setDialogConfig] = useState<ProviderSettings>({});
  const [dialogConfigName, setDialogConfigName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // New state for provider selection dialog
  const [providerSelectionOpen, setProviderSelectionOpen] = useState(false);

  // State for terms dialog
  const [termsDialogOpen, setTermsDialogOpen] = useState(false);

  // State for the 3-dot menu
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedConfigIndex, setSelectedConfigIndex] = useState<number | null>(null);
  const openMenu = Boolean(anchorEl);

  /**
   * Checks whether assistant terms have been accepted.
   *
   * @returns Whether terms acceptance is persisted.
   */
  const hasAcceptedTerms = (): boolean => {
    return savedConfigs?.termsAccepted || false;
  };

  /**
   * Persists terms acceptance through the parent callback.
   *
   * @returns No value.
   */
  const acceptTerms = (): void => {
    if (onTermsAccept) {
      const updatedConfigs = saveTermsAcceptance(savedConfigs);
      onTermsAccept(updatedConfigs);
    }
  };

  /**
   * Compares provider settings using the shared stored-configuration identity rules.
   *
   * @param config1 - First provider settings object.
   * @param config2 - Second provider settings object.
   * @returns Whether both settings represent the same selected provider configuration.
   */
  function areConfigsSimilar(config1: ProviderSettings, config2: ProviderSettings): boolean {
    return isSameStoredConfig(
      { providerId: selectedProvider, config: config1 },
      { providerId: selectedProvider, config: config2 }
    );
  }

  /**
   * Opens the configuration dialog with existing or default provider settings.
   *
   * @param providerId - Provider to configure.
   * @param isNewConfig - Whether to create a separate saved configuration.
   * @returns No value.
   */
  const handleOpenDialog = (providerId: string, isNewConfig = false): void => {
    setDialogProviderId(providerId);

    // Get provider info to access its name
    const providerInfo = getProviderById(providerId);
    const providerName = providerInfo?.name || providerId;

    // If this is editing the currently selected provider, use its config
    if (providerId === selectedProvider && !isNewConfig) {
      setDialogConfig({ ...config });
      setDialogConfigName(configName);
    } else {
      // For a new config or a different provider, use default config
      const defaultConfig = getDefaultConfig(providerId);
      setDialogConfig({ ...defaultConfig });

      // Generate a unique name for this configuration

      // Check if there are existing configurations for this provider
      const existingConfigsForProvider = savedConfigs?.providers?.filter(
        p => p.providerId === providerId
      );

      if (existingConfigsForProvider && existingConfigsForProvider.length > 0) {
        // Find the highest number used in existing configurations
        let maxNumber = 0;
        const regex = new RegExp(`^${providerName}\\s+(\\d+)$`);

        existingConfigsForProvider.forEach(p => {
          if (p.displayName) {
            const match = p.displayName.match(regex);
            if (match && match[1]) {
              const num = parseInt(match[1], 10);
              if (!isNaN(num) && num > maxNumber) {
                maxNumber = num;
              }
            }
          }
        });

        // Use the next available number
        setDialogConfigName(`${providerName} ${maxNumber + 1}`);
      } else {
        // Use the provider name as the initial configuration name for the first instance
        setDialogConfigName(providerName);
      }
    }

    setDialogOpen(true);
  };

  /** Closes the provider configuration dialog. @returns No value. */
  const handleCloseDialog = (): void => {
    setDialogOpen(false);
  };

  /**
   * Applies and saves the current dialog configuration.
   *
   * @param makeDefault - Whether the saved configuration becomes the default.
   * @returns No value.
   */
  const handleSaveDialog = (makeDefault: boolean): void => {
    // Apply the changes from dialog to the main config
    handleProviderChange(dialogProviderId);
    handleConfigChange(dialogConfig);
    handleConfigNameChange(dialogConfigName);

    // Save the configuration - also pass the display name
    handleSaveConfig(dialogProviderId, dialogConfig, makeDefault, dialogConfigName);

    // Close dialog
    setDialogOpen(false);
  };

  /**
   * Replaces the configuration being edited.
   *
   * @param newConfig - Updated provider settings.
   * @returns No value.
   */
  const handleDialogConfigChange = (newConfig: ProviderSettings): void => {
    setDialogConfig(newConfig);
  };

  /**
   * Updates the display name being edited.
   *
   * @param name - New display name.
   * @returns No value.
   */
  const handleDialogConfigNameChange = (name: string): void => {
    setDialogConfigName(name);
  };

  /**
   * Starts a new configuration for a selected provider.
   *
   * @param providerId - Selected provider identifier.
   * @returns No value.
   */
  const handleProviderSelection = (providerId: string): void => {
    setProviderSelectionOpen(false);
    // Always treat selection from the provider dialog as a new configuration
    handleOpenDialog(providerId, true);
  };

  /** Opens terms or provider selection for the add-provider flow. @returns No value. */
  const handleAddProviderClick = (): void => {
    // Check if this is the first provider and terms haven't been accepted
    const isFirstProvider = !savedConfigs?.providers?.length;

    if (isFirstProvider && !hasAcceptedTerms()) {
      setTermsDialogOpen(true);
    } else {
      setProviderSelectionOpen(true);
    }
  };

  /** Accepts terms and advances to provider selection. @returns No value. */
  const handleTermsAccept = (): void => {
    acceptTerms();
    setTermsDialogOpen(false);
    setProviderSelectionOpen(true);
  };

  /** Closes the terms dialog without accepting. @returns No value. */
  const handleTermsClose = (): void => {
    setTermsDialogOpen(false);
  };

  /** Closes the saved-configuration action menu. @returns No value. */
  const handleCloseMenu = (): void => {
    setAnchorEl(null);
  };

  /**
   * Runs full auto-detection and surfaces results to the parent.
   *
   * @returns Promise that settles after detection completes or is skipped.
   */
  const handleDetectAllProviders = async (): Promise<void> => {
    if (!commandRunner || !onAutoDetectResults) return;
    try {
      const detected = await detectProviders(savedConfigs?.providers || [], [], commandRunner);
      if (detected.length > 0) {
        setProviderSelectionOpen(false);
        onAutoDetectResults(detected);
      }
    } catch {
      // Silently ignore — caller can show error via onAutoDetectResults([]) pattern
    }
  };

  // Menu handling

  /**
   * Selects saved settings or defaults for a provider.
   *
   * @param providerId - Provider identifier to select.
   * @returns No value.
   */
  const handleProviderChange = (providerId: string): void => {
    // Try to find an existing config for this provider
    const existingConfig = savedConfigs?.providers?.find(p => p.providerId === providerId);

    if (existingConfig) {
      // Use existing config
      if (onChange) {
        onChange({
          providerId,
          config: { ...existingConfig.config },
          displayName: existingConfig.displayName || '',
        });
      }
    } else {
      // Reset config to defaults when changing to a new provider
      if (onChange) {
        onChange({
          providerId,
          config: getDefaultConfig(providerId),
          displayName: '',
        });
      }
    }
  };

  /**
   * Reports provider setting changes to the parent.
   *
   * @param newConfig - Updated provider settings.
   * @returns No value.
   */
  const handleConfigChange = (newConfig: ProviderSettings): void => {
    if (onChange) {
      onChange({
        providerId: selectedProvider,
        config: newConfig,
        displayName: configName,
      });
    }
  };

  /**
   * Saves provider settings and reports the new saved collection.
   *
   * @param providerId - Provider identifier to save.
   * @param config - Provider settings to save.
   * @param makeDefault - Whether this configuration becomes the default.
   * @param displayName - Optional display name override.
   * @returns No value.
   */
  const handleSaveConfig = (
    providerId: string,
    config: ProviderSettings,
    makeDefault: boolean,
    displayName?: string
  ): void => {
    // Save the configuration with the display name from dialog or existing one
    const updatedConfigs = saveProviderConfig(
      savedConfigs,
      providerId,
      config,
      makeDefault,
      displayName || configName
    );

    // Notify parent of changes
    if (onChange) {
      onChange({
        providerId,
        config,
        displayName: displayName || configName,
        savedConfigs: updatedConfigs,
      });
    }
  };

  /**
   * Selects a saved provider configuration.
   *
   * @param config - Saved configuration to activate.
   * @returns No value.
   */
  const handleSelectSavedConfig = (config: StoredProviderConfig): void => {
    if (onChange) {
      onChange({
        providerId: config.providerId,
        config: { ...config.config },
        displayName: config.displayName || '',
      });
    }
  };

  /**
   * Reports a configuration display-name change.
   *
   * @param name - New display name.
   * @returns No value.
   */
  const handleConfigNameChange = (name: string): void => {
    if (onChange) {
      onChange({
        providerId: selectedProvider,
        config,
        displayName: name,
      });
    }
  };

  /**
   * Deletes a saved configuration and selects a valid replacement when needed.
   *
   * @param providerId - Provider that owns the configuration.
   * @param configToDelete - Provider settings that identify the saved entry.
   * @returns No value.
   */
  const handleDeleteConfig = (providerId: string, configToDelete: ProviderSettings): void => {
    const updatedConfigs = deleteProviderConfig(savedConfigs, providerId, configToDelete);

    // If we're deleting the currently active config, we need to update our local state
    if (providerId === selectedProvider && areConfigsSimilar(configToDelete, config)) {
      // Find the new active provider
      const newActiveConfig = getActiveConfig(updatedConfigs);
      if (newActiveConfig && onChange) {
        onChange({
          providerId: newActiveConfig.providerId,
          config: { ...newActiveConfig.config },
          displayName: newActiveConfig.displayName || '',
          savedConfigs: updatedConfigs,
        });
      } else if (onChange) {
        // No configs left, reset to defaults
        onChange({
          providerId: 'openai',
          config: getDefaultConfig('openai'),
          displayName: '',
          savedConfigs: updatedConfigs,
        });
      }
    } else if (onChange) {
      // Not deleting the active config, just update the saved configs
      onChange({
        providerId: selectedProvider,
        config,
        displayName: configName,
        savedConfigs: updatedConfigs,
      });
    }
  };

  return (
    <Box sx={{ width: '100%' }}>
      {/* Configured Providers Section */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle1">
            {!savedConfigs?.providers?.length
              ? t('No Configured Providers')
              : t('Configured Providers')}
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<Icon icon="mdi:plus-circle" />}
            onClick={handleAddProviderClick}
          >
            {t('Add Provider')}
          </Button>
          {(onAutoDetect || (commandRunner && onAutoDetectResults)) && (
            <Button
              variant="outlined"
              startIcon={
                autoDetecting ? (
                  <CircularProgress
                    size={20}
                    color="inherit"
                    aria-label={t('Detecting providers')}
                  />
                ) : (
                  <Icon icon="mdi:magnify-scan" />
                )
              }
              onClick={onAutoDetect ?? handleDetectAllProviders}
              disabled={autoDetecting}
              aria-busy={autoDetecting}
              sx={{ ml: 1 }}
            >
              {autoDetecting ? t('Detecting…') : t('Auto Detect')}
            </Button>
          )}
        </Box>

        {!savedConfigs?.providers?.length ? (
          <Paper
            sx={{
              p: 3,
              mb: 3,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              borderStyle: 'dashed',
              borderWidth: 1,
              borderColor: 'divider',
            }}
          >
            <Icon icon="mdi:robot-confused" width="48px" height="48px" style={{ opacity: 0.6 }} />
            <Typography variant="body1" sx={{ mt: 2, mb: 1 }}>
              {t('No AI providers configured yet')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t('Click "Add Provider" to configure your first AI provider')}
            </Typography>
          </Paper>
        ) : (
          <Grid container spacing={2}>
            {savedConfigs?.providers?.map((savedConfig, index) => {
              const isActive =
                savedConfig.providerId === selectedProvider &&
                areConfigsSimilar(savedConfig.config, config);

              // Find provider info for icon
              const savedProvider = getProviderById(savedConfig.providerId);

              return (
                <Grid item key={index} xs={6} md={4} lg={3}>
                  <Paper
                    aria-label={
                      isConfigView
                        ? undefined
                        : t('Select {{provider}}', {
                            provider:
                              savedConfig.displayName ||
                              (savedProvider?.name ? t(savedProvider.name) : undefined) ||
                              savedConfig.providerId,
                          })
                    }
                    role={isConfigView ? undefined : 'button'}
                    tabIndex={isConfigView ? undefined : 0}
                    elevation={isActive ? 3 : 1}
                    sx={{
                      p: 2,
                      cursor: isConfigView ? 'default' : 'pointer',
                      border: isActive ? '2px solid' : '1px solid',
                      borderColor: isActive ? 'primary.main' : 'divider',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      position: 'relative',
                      transition: 'all 0.2s',
                      '&:hover': {
                        borderColor: 'primary.light',
                        boxShadow: isConfigView ? 0 : 1,
                      },
                      '&:focus-visible': {
                        outline: '2px solid',
                        outlineColor: 'primary.main',
                        outlineOffset: 2,
                      },
                    }}
                    onClick={() => {
                      if (!isConfigView) {
                        handleSelectSavedConfig(savedConfig);
                      }
                    }}
                    onKeyDown={event => {
                      if (!isConfigView && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        handleSelectSavedConfig(savedConfig);
                      }
                    }}
                  >
                    <Box
                      sx={{
                        width: '100%',
                        display: 'flex',
                        justifyContent: 'space-between',
                        mb: 1,
                      }}
                    >
                      <Box>
                        {savedConfigs && index === (savedConfigs.defaultProviderIndex ?? 0) && (
                          <Chip
                            label={t('Default')}
                            size="small"
                            color="primary"
                            sx={{ fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>
                      <IconButton
                        size="small"
                        aria-label={t('More options')}
                        aria-haspopup="menu"
                        aria-expanded={openMenu && selectedConfigIndex === index}
                        onClick={e => {
                          e.stopPropagation();
                          setAnchorEl(e.currentTarget);
                          setSelectedConfigIndex(index);
                        }}
                      >
                        <Icon icon="mdi:dots-vertical" width="16px" />
                      </IconButton>
                    </Box>

                    <Icon
                      icon={savedProvider?.icon || 'mdi:robot'}
                      width="32px"
                      height="32px"
                      style={{ marginBottom: '8px' }}
                    />
                    <Typography variant="body1" sx={{ fontWeight: 'medium', textAlign: 'center' }}>
                      {savedConfig.displayName ||
                        (savedProvider?.name ? t(savedProvider.name) : undefined) ||
                        savedConfig.providerId}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" align="center">
                      {savedConfig.config.model || savedConfig.config.deploymentName ? (
                        <Box>
                          {savedConfig.config.model || savedConfig.config.deploymentName}
                          {savedConfig.config.showOnlyThisModel === true && (
                            <Box
                              component="span"
                              sx={{ color: 'primary.main', fontWeight: 'medium' }}
                            >
                              {' • '}
                              {t('Only this model')}
                            </Box>
                          )}
                        </Box>
                      ) : (
                        'Configuration'
                      )}
                    </Typography>

                    <Menu
                      anchorEl={anchorEl}
                      open={openMenu && selectedConfigIndex === index}
                      onClose={handleCloseMenu}
                      MenuListProps={{
                        'aria-labelledby': 'basic-button',
                      }}
                    >
                      <MenuItem
                        onClick={e => {
                          e.stopPropagation();
                          handleCloseMenu();
                          if (
                            selectedConfigIndex !== null &&
                            savedConfigs?.providers?.[selectedConfigIndex]
                          ) {
                            const selectedSavedConfig =
                              savedConfigs?.providers?.[selectedConfigIndex];
                            // Use false for isNewConfig to indicate we're editing an existing config
                            handleOpenDialog(selectedSavedConfig.providerId, false);
                            // Pre-select this saved config
                            setDialogConfig({ ...selectedSavedConfig.config });
                            setDialogConfigName(selectedSavedConfig.displayName || '');
                          }
                        }}
                      >
                        <Icon icon="mdi:pencil" width="16px" style={{ marginRight: 8 }} />
                        {t('Edit')}
                      </MenuItem>
                      <MenuItem
                        onClick={e => {
                          e.stopPropagation();
                          handleCloseMenu();
                          // Handle make default action using selectedConfigIndex
                          if (
                            selectedConfigIndex !== null &&
                            savedConfigs?.providers?.[selectedConfigIndex]
                          ) {
                            const selectedSavedConfig = savedConfigs.providers[selectedConfigIndex];
                            handleProviderChange(selectedSavedConfig.providerId);
                            handleConfigChange(selectedSavedConfig.config);
                            // Pass the display name to ensure we're setting the correct config as default
                            handleSaveConfig(
                              selectedSavedConfig.providerId,
                              selectedSavedConfig.config,
                              true,
                              selectedSavedConfig.displayName
                            );
                          }
                        }}
                      >
                        <Icon icon="mdi:star" width="16px" style={{ marginRight: 8 }} />
                        {t('Make Default')}
                      </MenuItem>
                      <MenuItem
                        onClick={e => {
                          e.stopPropagation();
                          handleCloseMenu();
                          // Handle delete action using selectedConfigIndex
                          if (
                            selectedConfigIndex !== null &&
                            savedConfigs?.providers?.[selectedConfigIndex]
                          ) {
                            setShowDeleteConfirm(true);
                          }
                        }}
                        sx={{ color: 'error.main' }}
                      >
                        <Icon icon="mdi:trash-can" width="16px" style={{ marginRight: 8 }} />
                        {t('Delete')}
                      </MenuItem>
                    </Menu>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Box>

      {/* Terms Dialog */}
      <TermsDialog open={termsDialogOpen} onClose={handleTermsClose} onAccept={handleTermsAccept} />

      {/* Provider Selection Dialog */}
      <ProviderSelectionDialog
        open={providerSelectionOpen}
        onClose={() => setProviderSelectionOpen(false)}
        onSelectProvider={handleProviderSelection}
        DialogSlot={DialogSlot}
      />

      {/* Configuration Dialog */}
      <ConfigurationDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        providerId={dialogProviderId}
        config={dialogConfig}
        onConfigChange={handleDialogConfigChange}
        configName={dialogConfigName}
        onConfigNameChange={handleDialogConfigNameChange}
        onSave={handleSaveDialog}
        DialogSlot={DialogSlot}
        commandRunner={commandRunner}
      />

      <DialogSlot
        open={showDeleteConfirm}
        aria-labelledby="delete-configuration-title"
        aria-describedby="delete-configuration-description"
        onClose={() => {
          setShowDeleteConfirm(false);
          setSelectedConfigIndex(null);
        }}
      >
        <DialogTitle id="delete-configuration-title">{t('Delete Configuration')}</DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-configuration-description">
            {t('Are you sure you want to delete this configuration?')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setShowDeleteConfirm(false);
              setSelectedConfigIndex(null);
            }}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => {
              if (selectedConfigIndex !== null && savedConfigs?.providers?.[selectedConfigIndex]) {
                const selectedSavedConfig = savedConfigs.providers[selectedConfigIndex];
                handleDeleteConfig(selectedSavedConfig.providerId, selectedSavedConfig.config);
              }
              setShowDeleteConfirm(false);
              setSelectedConfigIndex(null);
            }}
            color="error"
            variant="contained"
          >
            {t('Delete')}
          </Button>
        </DialogActions>
      </DialogSlot>
    </Box>
  );
}
