import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockObservabilityApi } from './mock-observability-api';

const screenshotsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');

test.describe.serial('AI Assistant on KWOK', () => {
  test.beforeAll(() => {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  });

  test('configures and executes native read-only observability tools', async ({ page }) => {
    const grafanaUrl = process.env.E2E_GRAFANA_URL;
    const prometheusUrl = process.env.E2E_PROMETHEUS_URL;
    test.skip(
      !grafanaUrl || !prometheusUrl,
      'The observability scenario requires runner-managed Grafana and Prometheus services'
    );
    const api = await startMockObservabilityApi();
    const azureRequests: string[] = [];
    try {
      await page.route('https://management.azure.com/**', route => {
        azureRequests.push(route.request().url());
        return route.fulfill({
          status: route.request().method() === 'OPTIONS' ? 204 : 200,
          contentType: 'application/json',
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'authorization, content-type',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
          },
          body:
            route.request().method() === 'OPTIONS'
              ? undefined
              : JSON.stringify({ value: [], changes: [] }),
        });
      });
      await page.goto('/settings/plugins/%40headlamp-k8s%2Fai-assistant');
      for (const [provider, url] of Object.entries(api.urls)) {
        const name =
          provider === 'azureMonitor'
            ? 'Azure Monitor and AKS'
            : provider.charAt(0).toUpperCase() + provider.slice(1);
        await page.getByRole('textbox', { name: `${name} URL` }).fill(url);
      }
      await page.getByRole('group', { name: 'Datadog' }).getByLabel('API Key').fill('datadog-api');
      await page
        .getByRole('group', { name: 'Datadog' })
        .getByLabel('Application Key')
        .fill('datadog-app');
      await page
        .getByRole('group', { name: 'Splunk' })
        .getByLabel('Access Token')
        .fill('splunk-token');
      await page
        .getByRole('group', { name: 'Grafana' })
        .getByLabel('Service Account Token')
        .fill('grafana-token');
      await page
        .getByRole('group', { name: 'Prometheus' })
        .getByLabel('HTTP Token')
        .fill('prometheus-token');
      await page
        .getByRole('group', { name: 'Azure Monitor and AKS' })
        .getByLabel('Logs Access Token')
        .fill('azure-monitor-token');
      await page
        .getByRole('group', { name: 'Azure Monitor and AKS' })
        .getByLabel('Resource Manager Token')
        .fill('azure-management-token');

      for (const toolName of [
        'Datadog Read',
        'Splunk Read',
        'Grafana Read',
        'Prometheus Read',
        'Azure Monitor Traces Read',
      ]) {
        const toolToggle = page.getByRole('checkbox', {
          name: `Enable or disable ${toolName}`,
        });
        await expect(toolToggle).toBeChecked();
        await toolToggle.uncheck();
        await expect(toolToggle).not.toBeChecked();
        await toolToggle.check();
        await expect(toolToggle).toBeChecked();
      }
      await expect
        .poll(() =>
          page.evaluate(() => {
            const configs = JSON.parse(localStorage.getItem('pluginConfigs') ?? '{}');
            return configs['@headlamp-k8s/ai-assistant']?.enabledTools?.sort();
          })
        )
        .toEqual(
          [
            'kubernetes_api_request',
            'datadog_read',
            'splunk_read',
            'grafana_read',
            'prometheus_read',
            'azure_monitor_traces_read',
            'azure_metrics_read',
            'azure_resource_health_read',
            'azure_application_insights_read',
            'azure_diagnostics_read',
            'azure_control_plane_logs_read',
            'azure_network_config_read',
            'azure_cost_capacity_read',
            'azure_security_posture_read',
            'azure_deployment_changes_read',
          ].sort()
        );
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('pluginConfigs')))
        .toContain(api.urls.prometheus);

      await page.getByText('Developer Options', { exact: true }).click();
      await page.getByRole('checkbox', { name: 'Mock Testing Model' }).check();
      await page.getByRole('button', { name: 'AI Assistant' }).click();
      await page.getByLabel('Assistant mode').click();
      await page.getByRole('option', { name: 'Chat' }).click();
      const promptInput = page.locator('#deployment-ai-prompt');
      await promptInput.fill('E2E query all observability providers');
      await promptInput.press('Enter');
      await page.getByRole('button', { name: 'Execute 5 Tools' }).click();

      await expect.poll(() => api.requests.length).toBeGreaterThanOrEqual(5);
      expect(api.requests.find(request => request.provider === 'datadog')).toMatchObject({
        method: 'POST',
        datadogApiKey: 'datadog-api',
        datadogApplicationKey: 'datadog-app',
      });
      expect(api.requests.find(request => request.provider === 'splunk')).toMatchObject({
        method: 'POST',
        authorization: 'Splunk splunk-token',
      });
      expect(api.requests.find(request => request.provider === 'grafana')).toMatchObject({
        method: 'GET',
        path: '/api/search?type=dash-db&query=Kubernetes&limit=100',
        authorization: ['Bearer', 'grafana-token'].join(' '),
      });
      expect(api.requests.find(request => request.provider === 'prometheus')).toMatchObject({
        method: 'GET',
        path: '/api/v1/query?query=up',
        authorization: ['Bearer', 'prometheus-token'].join(' '),
      });
      const azureMonitorRequest = api.requests.find(request => request.provider === 'azureMonitor');
      expect(azureMonitorRequest).toMatchObject({
        method: 'POST',
        path: '/v1/workspaces/workspace-id/query',
        authorization: ['Bearer', 'azure-monitor-token'].join(' '),
      });
      expect(JSON.parse(azureMonitorRequest?.body ?? '{}')).toMatchObject({
        query: expect.stringContaining('AppRequests'),
      });
      expect(api.successfulUpstreams).toEqual(expect.arrayContaining(['grafana', 'prometheus']));

      await promptInput.fill('E2E query Azure AKS troubleshooting sources');
      await promptInput.press('Enter');
      await page.getByRole('button', { name: 'Execute 9 Tools' }).click();

      await expect.poll(() => azureRequests.length).toBeGreaterThanOrEqual(7);
      await expect
        .poll(() => api.requests.filter(request => request.provider === 'azureMonitor').length)
        .toBeGreaterThanOrEqual(3);
      expect(azureRequests).toEqual(
        expect.arrayContaining([
          expect.stringContaining('/providers/microsoft.insights/metrics'),
          expect.stringContaining(
            '/providers/Microsoft.ResourceHealth/availabilityStatuses/current'
          ),
          expect.stringContaining('/providers/microsoft.insights/diagnosticSettings'),
          expect.stringContaining('/effectiveRouteTable'),
          expect.stringContaining('/agentPools'),
          expect.stringContaining('/providers/Microsoft.Security/assessments'),
          expect.stringContaining('/providers/Microsoft.ResourceGraph/resourceChanges'),
        ])
      );
    } finally {
      await api.close();
    }
  });

  test('covers the main assistant scenarios', async ({ page }) => {
    await page.goto('/c/main/nodes');

    const tokenLogin = page.getByRole('button', { name: 'Use A Token' });
    if (await tokenLogin.isVisible()) {
      const token = process.env.HEADLAMP_TOKEN;
      expect(
        token,
        'HEADLAMP_TOKEN must be set when Headlamp requires authentication'
      ).toBeTruthy();
      await tokenLogin.click();
      await page.getByRole('textbox', { name: 'ID token' }).fill(token!);
      await page.getByRole('button', { name: 'Authenticate' }).click();
    }

    await expect(page.getByText('kwok-worker', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI Assistant' })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '01-kwok-cluster.png'),
      fullPage: true,
    });

    await page.goto('/settings/plugins/%40headlamp-k8s%2Fai-assistant');

    await expect(page.getByText('Developer Options', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No Configured Providers' })).toBeVisible();

    const previewFeatures = page.getByRole('checkbox', { name: 'Preview Features' });
    await expect(previewFeatures).toBeChecked();
    await previewFeatures.uncheck();
    await expect(page.getByRole('button', { name: 'AI Assistant' })).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('pluginConfigs')))
      .toContain('"previewEnabled":false');
    await page.reload();
    await expect(previewFeatures).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'AI Assistant' })).toBeHidden();
    await previewFeatures.check();
    await expect(page.getByRole('button', { name: 'AI Assistant' })).toBeVisible();

    await page.getByText('Developer Options', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Mock Testing Model' }).check();

    await expect(page.getByRole('checkbox', { name: 'Mock Testing Model' })).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Configured Providers' })).toBeVisible();
    await expect(page.getByText('Mock Testing Model', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Default', { exact: true })).toBeVisible();

    const fakeMCP = page.getByRole('checkbox', { name: 'Fake MCP Server' });
    await fakeMCP.check();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('pluginConfigs')))
      .toContain('"enableFakeMCP":true');
    await page.reload();
    await expect(fakeMCP).toBeChecked();
    await page.screenshot({
      path: path.join(screenshotsDir, '10-mock-mcp-settings.png'),
      fullPage: true,
    });

    const mockSkillContent = `---
name: mock-pod-troubleshooting
description: Diagnose unhealthy Kubernetes pods using events and logs
version: 1.0.0
tags: [kubernetes, troubleshooting]
---
# Mock Pod Troubleshooting

Inspect pod status, recent events, and container logs before recommending a fix.`;
    await page.route(
      'https://api.github.com/repos/headlamp-k8s/mock-skills/git/trees/e2e?recursive=1',
      route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            truncated: false,
            tree: [
              {
                type: 'blob',
                path: 'skills/pod-troubleshooting/SKILL.md',
                size: Buffer.byteLength(mockSkillContent),
              },
            ],
          }),
        })
    );
    await page.route(
      'https://raw.githubusercontent.com/headlamp-k8s/mock-skills/e2e/skills/pod-troubleshooting/SKILL.md',
      route => route.fulfill({ status: 200, contentType: 'text/markdown', body: mockSkillContent })
    );
    await page.getByRole('button', { name: 'Add Repository' }).click();
    await page
      .getByRole('textbox', { name: 'Repository URL' })
      .fill('https://github.com/headlamp-k8s/mock-skills');
    await page.getByRole('textbox', { name: 'Ref (branch, tag, or SHA)' }).fill('e2e');
    await page.getByRole('textbox', { name: 'Subdirectory' }).fill('skills');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.getByRole('button', { name: 'View Loaded Skills' }).click();
    await expect(page.getByRole('heading', { name: 'Loaded Skills' })).toBeVisible();
    await expect(page.getByText('mock-pod-troubleshooting')).toBeVisible();
    await expect(page.getByText(/Diagnose unhealthy Kubernetes pods/)).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    const kubernetesTool = page.getByRole('checkbox', {
      name: 'Enable or disable Kubernetes API Request',
    });
    await expect(kubernetesTool).toBeChecked();
    await kubernetesTool.uncheck();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('pluginConfigs')))
      .toContain(
        '"enabledTools":["datadog_read","splunk_read","grafana_read","prometheus_read","azure_monitor_traces_read","azure_metrics_read","azure_resource_health_read","azure_application_insights_read","azure_diagnostics_read","azure_control_plane_logs_read","azure_network_config_read","azure_cost_capacity_read","azure_security_posture_read","azure_deployment_changes_read"]'
      );
    await page.reload();
    await expect(kubernetesTool).not.toBeChecked();
    await kubernetesTool.check();

    await page.getByRole('textbox', { name: 'Namespace' }).fill('ai-e2e');
    await page.getByRole('textbox', { name: 'Service name' }).fill('holmes-e2e');
    const holmesPort = page.getByRole('spinbutton', { name: 'Port' });
    await holmesPort.fill('8080');
    await holmesPort.press('Tab');
    await expect(holmesPort).toHaveValue('8080');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('pluginConfigs')))
      .toContain('"holmesPort":8080');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Namespace' })).toHaveValue('ai-e2e');
    await expect(page.getByRole('textbox', { name: 'Service name' })).toHaveValue('holmes-e2e');
    await expect(page.getByRole('spinbutton', { name: 'Port' })).toHaveValue('8080');
    await expect(kubernetesTool).toBeChecked();
    await page.screenshot({
      path: path.join(screenshotsDir, '02-mock-settings.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: 'AI Assistant' }).click();
    await expect(page.getByText('AI Assistant (preview)', { exact: true })).toBeVisible();
    await page.getByLabel('Assistant mode').click();
    await page.getByRole('option', { name: 'Chat' }).click();
    await expect(page.getByLabel('Provider and model')).toContainText('default');

    const promptInput = page.locator('#deployment-ai-prompt');
    await expect(page.getByLabel('Ask AI')).toBeVisible();
    await expect(promptInput).toBeEnabled();
    await promptInput.fill('What is a Pod?');
    await promptInput.press('Enter');

    await expect(page.getByText(/Kubernetes resource managed by the API server/i)).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '03-mock-model-chat.png'),
      fullPage: true,
    });

    await promptInput.fill('List all Pod in demo');
    await promptInput.press('Enter');

    await expect(page.getByText(/kubectl get Pod -n demo/i)).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '05-mock-model-kubectl-guidance.png'),
      fullPage: true,
    });

    await page
      .getByRole('complementary', { name: 'AI Assistant panel' })
      .getByRole('button', { name: 'Close' })
      .click();
    await page.getByRole('checkbox', { name: 'Mock Testing Agent' }).check();
    await expect(page.getByRole('checkbox', { name: 'Mock Testing Agent' })).toBeChecked();

    await page.getByRole('button', { name: 'AI Assistant' }).click();
    await page.getByLabel('Assistant mode').click();
    await page.getByRole('option', { name: 'Holmes Agent' }).click();
    await expect(page.getByLabel('Ask Holmes (Agent Mode)')).toBeEnabled();

    await page
      .getByRole('complementary', { name: 'AI Assistant panel' })
      .getByRole('button', { name: 'Close' })
      .click();
    await page.goto('/c/main');

    await page.getByRole('button', { name: 'AI Assistant' }).click();

    await expect(promptInput).toBeVisible();
    await promptInput.fill('why is my pod failing');
    await promptInput.press('Enter');

    await expect(page.getByText(/nginx-abc123.*CrashLoopBackOff/i).last()).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '04-mock-agent-diagnosis.png'),
      fullPage: true,
    });

    await promptInput.fill('what is running in my cluster');
    await promptInput.press('Enter');

    await expect(page.getByText(/Everything looks healthy/i).last()).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '06-mock-agent-cluster-exploration.png'),
      fullPage: true,
    });

    await page
      .getByRole('complementary', { name: 'AI Assistant panel' })
      .getByRole('button', { name: 'Close' })
      .click();
    await page.goto('/settings/plugins/%40headlamp-k8s%2Fai-assistant');
    await page.getByRole('checkbox', { name: 'Mock Testing Model' }).uncheck();
    await page.getByRole('checkbox', { name: 'Mock Testing Agent' }).uncheck();
    await expect(page.getByRole('heading', { name: 'No Configured Providers' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('pluginConfigs')))
      .toContain('"enableMockAgent":false');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'No Configured Providers' })).toBeVisible();

    await page.getByRole('button', { name: 'AI Assistant' }).click();
    await expect(page.getByRole('heading', { name: 'AI Assistant Setup Required' })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '09-no-provider-setup.png'),
      fullPage: true,
    });
  });

  test('navigates resource links within Headlamp', async ({ context, page }) => {
    await page.goto('/c/main/nodes');

    const tokenLogin = page.getByRole('button', { name: 'Use A Token' });
    if (await tokenLogin.isVisible()) {
      const token = process.env.HEADLAMP_TOKEN;
      expect(
        token,
        'HEADLAMP_TOKEN must be set when Headlamp requires authentication'
      ).toBeTruthy();
      await tokenLogin.click();
      await page.getByRole('textbox', { name: 'ID token' }).fill(token!);
      await page.getByRole('button', { name: 'Authenticate' }).click();
    }

    await page.goto('/settings/plugins/%40headlamp-k8s%2Fai-assistant');
    await page.getByText('Developer Options', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Mock Testing Model' }).check();
    await page.getByRole('checkbox', { name: /Test Mode/ }).check();
    await page.getByRole('button', { name: 'AI Assistant' }).click();

    await page.getByRole('button', { name: 'Add Test Response' }).click();
    await page
      .getByRole('textbox', { name: 'Response Content' })
      .fill(
        '[web](https://headlamp/resource-details?cluster=main&kind=Deployment&resource=web&ns=demo)'
      );
    await page.getByRole('button', { name: 'Add Response' }).click();

    const resourceLink = page.getByRole('link', { name: 'web', exact: true });
    await expect(resourceLink).not.toHaveAttribute('target', '_blank');
    const pageCount = context.pages().length;
    await resourceLink.click();
    await expect(page).toHaveURL(/\/c\/main\/deployments\/demo\/web$/);
    await expect.poll(() => context.pages().length).toBe(pageCount);
  });
});
