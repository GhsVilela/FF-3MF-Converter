import { expect, test } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/four-color.3mf');
const multiPlateFixture = path.resolve('tests/fixtures/multi-plate-preview.3mf');

test('converts a four-colour project through the UI', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('FlashForge');

  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'File analysis' })).toBeVisible();
  await expect(page.getByText('Choose the target')).toBeVisible();

  // The default target for a four-colour source is the AD5X.
  await expect(page.getByRole('button', { name: /^FlashForge AD5X/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: /Convert for FlashForge AD5X/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Your Flash Studio project is ready' }),
  ).toBeVisible({ timeout: 60_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download .3mf' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/_ad5x\.3mf$/);

  await expect(page.getByText('Conversion report')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});

test('shows and navigates the plate preview carousel', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(multiPlateFixture);
  await expect(page.getByRole('heading', { name: 'File analysis' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Build plate preview' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Preview of plate 1/ })).toBeVisible();
  await expect(page.getByText('Plate 1 of 3')).toBeVisible();

  await page.getByRole('button', { name: 'Next plate' }).click();
  await expect(page.getByRole('img', { name: /Preview of plate 2/ })).toBeVisible();
  await expect(page.getByText('Plate 2 of 3')).toBeVisible();

  await page.getByRole('button', { name: 'Previous plate' }).click();
  await expect(page.getByText('Plate 1 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Show plate 3' }).click();
  await expect(page.getByText('Plate 3 of 3')).toBeVisible();
});

test('rejects a non-3MF file with a clear message', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(page.getByText('Only .3mf files are supported.')).toBeVisible();
});
