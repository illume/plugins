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

import type {
  ObservabilityConfig,
  ObservabilityProviderConfig,
} from '@headlamp-k8s/ai-common/tools/observability/ObservabilityTools';
import { Box, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface ObservabilitySettingsProps {
  config?: ObservabilityConfig;
  onChange: (config: ObservabilityConfig) => void;
}

const PROVIDERS: Array<{
  id: keyof ObservabilityConfig;
  name: string;
  defaultUrl: string;
  fields: Array<{ key: keyof ObservabilityProviderConfig; label: string; secret?: boolean }>;
}> = [
  {
    id: 'datadog',
    name: 'Datadog',
    defaultUrl: 'https://api.datadoghq.com',
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
    defaultUrl: '',
    fields: [
      { key: 'token', label: 'HTTP Token', secret: true },
      { key: 'organizationId', label: 'Tenant / Organization ID' },
    ],
  },
];

/** Settings for native dependency-free observability API tools. */
export function ObservabilitySettings({
  config = {},
  onChange,
}: ObservabilitySettingsProps): React.ReactElement {
  const { t } = useTranslation();
  const translateFieldLabel = (label: string): string => {
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
  };

  const update = (
    provider: keyof ObservabilityConfig,
    key: keyof ObservabilityProviderConfig,
    value: string
  ): void => {
    const defaultUrl = PROVIDERS.find(item => item.id === provider)?.defaultUrl;
    onChange({
      ...config,
      [provider]: {
        ...(defaultUrl && !config[provider]?.baseUrl ? { baseUrl: defaultUrl } : {}),
        ...config[provider],
        [key]: value,
      },
    });
  };

  return (
    <Box>
      <Typography variant="h6">{t('Observability Data Sources')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'Configure native read-only tools. They connect directly to provider HTTP APIs and require no MCP server or local executable.'
        )}
      </Typography>
      <Box display="flex" flexDirection="column" gap={3}>
        {PROVIDERS.map(provider => {
          const providerConfig = config[provider.id] ?? {};
          return (
            <Box key={provider.id}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                {provider.name}
              </Typography>
              <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={2}>
                <TextField
                  label={t('{{provider}} URL', { provider: provider.name })}
                  value={providerConfig.baseUrl ?? provider.defaultUrl}
                  onChange={event => update(provider.id, 'baseUrl', event.target.value)}
                  placeholder={provider.defaultUrl || `https://${provider.id}.example.com`}
                  fullWidth
                />
                {provider.fields.map(field => (
                  <TextField
                    key={field.key}
                    label={translateFieldLabel(field.label)}
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
