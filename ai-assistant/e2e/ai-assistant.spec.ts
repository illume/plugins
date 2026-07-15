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

    await expect(page.getByText('kwok-worker', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI Assistant' })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '01-kwok-cluster.png'),
      fullPage: true,
    });

    await page.goto('/settings/plugins/%40headlamp-k8s%2Fai-assistant');

    await expect(page.getByText('Developer Options', { exact: true })).toBeVisible();
    await page.getByText('Developer Options', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Mock Testing Model' }).check();

    await expect(page.getByRole('checkbox', { name: 'Mock Testing Model' })).toBeChecked();
    await expect(page.getByRole('heading', { name: 'No Configured Providers' })).toBeHidden();
    await page.screenshot({
      path: path.join(screenshotsDir, '02-mock-settings.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: 'AI Assistant' }).click();
    await expect(page.getByText('AI Assistant (preview)', { exact: true })).toBeVisible();
    await page.getByLabel('Assistant mode').click();
    await page.getByRole('option', { name: 'Chat' }).click();
    await page.waitForTimeout(500);

    const promptInput = page.locator('#deployment-ai-prompt');
    await expect(page.getByLabel('Ask AI')).toBeVisible();
    await promptInput.fill('What is a Pod?');
    await promptInput.press('Enter');

    await expect(page.getByText(/Kubernetes resource managed by the API server/i)).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '03-mock-model-chat.png'),
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

    await expect(promptInput).toBeVisible();
    await promptInput.fill('why is my pod failing');
    await promptInput.press('Enter');

    await expect(page.getByText(/nginx-abc123.*CrashLoopBackOff/i).last()).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '04-mock-agent-diagnosis.png'),
      fullPage: true,
    });
  });
});
