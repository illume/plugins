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
    await page.screenshot({
      path: path.join(screenshotsDir, '02-mock-settings.png'),
      fullPage: true,
    });
    await page.waitForTimeout(750);

    await page.goto('/c/main');
    await page.getByRole('button', { name: 'AI Assistant' }).click();
    await expect(page.getByText('AI Assistant (preview)', { exact: true })).toBeVisible();

    await page.getByLabel('Ask AI').fill('What is a Pod?');
    await page.getByLabel('Ask AI').press('Enter');

    await expect(page.getByText(/Kubernetes resource managed by the API server/i)).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '03-mock-model-chat.png'),
      fullPage: true,
    });

    await page.goto('/settings/plugins/%40headlamp-k8s%2Fai-assistant');
    await page.getByText('Developer Options', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Mock Testing Agent' }).check();
    await expect(page.getByRole('checkbox', { name: 'Mock Testing Agent' })).toBeChecked();
    await page.waitForTimeout(750);

    await page.goto('/c/main');
    await page.getByRole('button', { name: 'AI Assistant' }).click();

    await expect(page.getByLabel('Ask Holmes (Agent Mode)')).toBeVisible();
    await page.getByLabel('Ask Holmes (Agent Mode)').fill('why is my pod failing');
    await page.getByLabel('Ask Holmes (Agent Mode)').press('Enter');

    await expect(page.getByText(/nginx-abc123.*CrashLoopBackOff/i)).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, '04-mock-agent-diagnosis.png'),
      fullPage: true,
    });
  });
});
