import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const screenshotsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');

test.describe.serial('AI Assistant on KWOK', () => {
  test.beforeAll(() => {
    fs.mkdirSync(screenshotsDir, { recursive: true });
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

    const kubernetesTool = page.getByRole('checkbox', {
      name: 'Enable or disable Kubernetes API Request',
    });
    await expect(kubernetesTool).toBeChecked();
    await kubernetesTool.uncheck();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('pluginConfigs')))
      .toContain('"enabledTools":[]');
    await page.reload();
    await expect(kubernetesTool).not.toBeChecked();
    await kubernetesTool.check();

    await page.getByRole('textbox', { name: 'Namespace' }).fill('ai-e2e');
    await page.getByRole('textbox', { name: 'Service name' }).fill('holmes-e2e');
    await page.getByRole('spinbutton', { name: 'Port' }).fill('8080');
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

    const warningEvent = page.getByRole('row').filter({ hasText: 'checkout-crashloop' });
    await expect(warningEvent).toContainText('BackOff');
    await expect(warningEvent.getByRole('button', { name: 'Diagnose with AI' })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '07-overview-proactive-events.png'),
      fullPage: true,
    });

    await warningEvent.getByRole('button', { name: 'Diagnose with AI' }).click();
    const proactiveDiagnosis = page.getByRole('region', { name: 'Proactive Diagnosis' });
    await expect(proactiveDiagnosis).toBeVisible();
    await expect(
      proactiveDiagnosis.getByRole('heading', { name: 'Event Diagnosis' }).first()
    ).toBeVisible();
    await expect(
      proactiveDiagnosis.getByRole('heading', { name: 'Root cause analysis' }).first()
    ).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '08-proactive-event-diagnosis.png'),
      fullPage: true,
    });

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
    await expect(page.getByRole('heading', { name: 'No Configured Providers' })).toBeVisible();

    await page.getByRole('button', { name: 'AI Assistant' }).click();
    await page.getByLabel('Assistant mode').click();
    await page.getByRole('option', { name: 'Chat' }).click();
    await expect(page.getByRole('heading', { name: 'AI Assistant Setup Required' })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '09-no-provider-setup.png'),
      fullPage: true,
    });
  });
});
