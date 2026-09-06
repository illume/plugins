/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { CommandRunner } from '@headlamp-k8s/ai-common/providers/detectProvider';
import {
  type AzureObservabilityEndpoint,
  discoverAzureObservabilityEndpoints,
} from '@headlamp-k8s/ai-common/tools/observability/AzureObservabilityDiscovery';
import type {
  ObservabilityConfig,
  ObservabilityProviderConfig,
} from '@headlamp-k8s/ai-common/tools/observability/ObservabilityTools';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ObservabilitySettingsProps {
  /** Current native observability configuration. */
  config?: ObservabilityConfig;
  /** Called with the complete configuration after an edit. */
  onChange: (config: ObservabilityConfig) => void;
  /** Optional desktop command runner used to discover managed Azure endpoints. */
  commandRunner?: CommandRunner;
}

const PROVIDERS: Array<{
  /** Configuration key for the provider. */
  id: keyof ObservabilityConfig;
  /** Provider name shown in settings. */
  name: string;
  /** Initial endpoint shown and persisted when another field changes. */
  defaultUrl: string;
  /** Provider-specific credential and tenant fields. */
  fields: Array<{
    /** Provider configuration property. */
    key: keyof ObservabilityProviderConfig;
    /** Human-readable field label. */
    label: string;
    /** Whether the input must conceal its value. */
    secret?: boolean;
  }>;
}> = [
  {
    id: 'datadog',
    name: 'Datadog',
    defaultUrl: '',
    fields: [
      { key: 'apiKey', label: 'API Key', secret: true },
      { key: 'applicationKey', label: 'Application Key', secret: true },
    ],
  },
  {
    id: 'splunk',
    name: 'Splunk',
    defaultUrl: '',
    fields: [
      { key: 'token', label: 'Access Token', secret: true },
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', secret: true },
    ],
  },
  {
    id: 'grafana',
    name: 'Grafana',
    defaultUrl: '',
    fields: [
      { key: 'token', label: 'Service Account Token', secret: true },
      { key: 'organizationId', label: 'Organization ID' },
    ],
  },
  {
    id: 'prometheus',
    name: 'Prometheus',
    defaultUrl: 'http://localhost:9090',
    fields: [
      { key: 'token', label: 'HTTP Token', secret: true },
      { key: 'organizationId', label: 'Tenant / Organization ID' },
    ],
  },
  {
    id: 'azureMonitor',
    name: 'Azure Monitor Traces',
    defaultUrl: '',
    fields: [{ key: 'token', label: 'Access Token', secret: true }],
  },
];

/**
 * Translates a provider field label while keeping every dynamic key extractable.
 *
 * @param t - Active i18next translation function.
 * @param label - Provider field label configured above.
 * @returns Translated field label.
 */
function translateFieldLabel(t: TFunction, label: string): string {
  switch (label) {
    case 'API Key':
      return t('API Key');
    case 'Application Key':
      return t('Application Key');
    case 'Access Token':
      return t('Access Token');
    case 'Username':
      return t('Username');
    case 'Password':
      return t('Password');
    case 'Service Account Token':
      return t('Service Account Token');
    case 'Organization ID':
      return t('Organization ID');
    case 'HTTP Token':
      return t('HTTP Token');
    case 'Tenant / Organization ID':
      return t('Tenant / Organization ID');
    default:
      return label;
  }
}

/**
 * Renders settings for native dependency-free observability API tools.
 *
 * @param props - Current configuration and change callback.
 * @returns The observability settings panel.
 */
export function ObservabilitySettings({
  config = {},
  onChange,
  commandRunner,
}: ObservabilitySettingsProps): React.ReactElement {
  const { t } = useTranslation();
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<AzureObservabilityEndpoint[]>([]);
  const [discoveryNotice, setDiscoveryNotice] = useState<{
    message: string;
    severity: 'info' | 'error';
  }>();

  /**
   * Updates one provider setting without discarding sibling settings.
   *
   * @param provider - Provider configuration key.
   * @param key - Provider setting to update.
   * @param value - New field value.
   * @returns No value.
   */
  const update = (
    provider: keyof ObservabilityConfig,
    key: keyof ObservabilityProviderConfig,
    value: string
  ): void => {
    onChange({
      ...config,
      [provider]: {
        ...config[provider],
        [key]: value,
      },
    });
  };

  /**
   * Queries the active Azure CLI subscription for managed observability resources.
   *
   * @returns A promise that settles after discovery state is updated.
   */
  const discoverFromAzure = async (): Promise<void> => {
    if (!commandRunner) return;
    setDiscovering(true);
    setDiscoveryNotice(undefined);
    try {
      const endpoints = await discoverAzureObservabilityEndpoints(commandRunner);
      setDiscovered(endpoints);
      if (endpoints.length === 0) {
        setDiscoveryNotice({
          message: t('No managed Grafana, Prometheus, or Log Analytics resources were found.'),
          severity: 'info',
        });
      }
    } catch (error) {
      setDiscovered([]);
      setDiscoveryNotice({
        message: error instanceof Error ? error.message : t('Azure discovery failed.'),
        severity: 'error',
      });
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <Box>
      <Typography variant="h6">{t('Observability Data Sources')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'Configure native read-only tools. They connect directly to provider HTTP APIs and require no MCP server or local executable.'
        )}
      </Typography>
      {commandRunner && (
        <Box sx={{ mb: 3 }}>
          <Button
            variant="outlined"
            onClick={discoverFromAzure}
            disabled={discovering}
            startIcon={discovering ? <CircularProgress size={16} /> : undefined}
          >
            {t('Discover from Azure CLI')}
          </Button>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            {t(
              'Uses the active az login to find URLs across accessible subscriptions. Choose a result to apply it; credentials are never imported.'
            )}
          </Typography>
          {discoveryNotice && (
            <Alert severity={discoveryNotice.severity} sx={{ mt: 1 }}>
              {discoveryNotice.message}
            </Alert>
          )}
          {discovered.length > 0 && (
            <Box
              display="flex"
              flexDirection="column"
              alignItems="flex-start"
              gap={1}
              sx={{ mt: 1 }}
            >
              {discovered.map(endpoint => (
                <Button
                  key={`${endpoint.provider}:${endpoint.subscriptionId}:${endpoint.resourceGroup}:${endpoint.name}`}
                  size="small"
                  onClick={() => update(endpoint.provider, 'baseUrl', endpoint.url)}
                >
                  {t('Use {{name}} ({{resourceGroup}}, {{subscriptionId}}) for {{provider}}', {
                    name: endpoint.name,
                    resourceGroup: endpoint.resourceGroup,
                    subscriptionId: endpoint.subscriptionId,
                    provider:
                      endpoint.provider === 'grafana'
                        ? 'Grafana'
                        : endpoint.provider === 'prometheus'
                        ? 'Prometheus'
                        : 'Azure Monitor Traces',
                  })}
                </Button>
              ))}
            </Box>
          )}
        </Box>
      )}
      <Box display="flex" flexDirection="column" gap={3}>
        {PROVIDERS.map(provider => {
          const providerConfig = config[provider.id] ?? {};
          return (
            <Box key={provider.id} role="group" aria-label={provider.name}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                {provider.name}
              </Typography>
              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={2}>
                <TextField
                  label={t('{{provider}} URL', { provider: provider.name })}
                  value={providerConfig.baseUrl ?? ''}
                  onChange={event => update(provider.id, 'baseUrl', event.target.value)}
                  placeholder={provider.defaultUrl || `https://${provider.id}.example.com`}
                  fullWidth
                />
                {provider.defaultUrl && !providerConfig.baseUrl && (
                  <Button
                    variant="outlined"
                    onClick={() => update(provider.id, 'baseUrl', provider.defaultUrl)}
                  >
                    {t('Use')} {provider.defaultUrl}
                  </Button>
                )}
                {provider.fields.map(field => (
                  <TextField
                    key={field.key}
                    label={translateFieldLabel(t, field.label)}
                    type={field.secret ? 'password' : 'text'}
                    value={providerConfig[field.key] ?? ''}
                    onChange={event => update(provider.id, field.key, event.target.value)}
                    autoComplete="off"
                    fullWidth
                  />
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
