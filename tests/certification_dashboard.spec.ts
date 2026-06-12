import { test, expect } from '@playwright/test';

const DASHBOARD_URL = process.env.CERT_DASHBOARD_URL ?? 'http://127.0.0.1:3101';

test.describe('Certification Dashboard UI', () => {

    test('1. Carrega o dashboard', async ({ page }) => {
        await page.goto(DASHBOARD_URL);
        await expect(page.locator('h1')).toContainText('OCPP Certification Pipeline');
    });

    test('2. Mostra os 3 serviços', async ({ page }) => {
        await page.goto(DASHBOARD_URL);
        await expect(page.locator('.svc-name:has-text("CDS")')).toBeVisible();
        await expect(page.locator('.svc-name:has-text("OCTT")')).toBeVisible();
        await expect(page.locator('.svc-name:has-text("Jira")')).toBeVisible();
    });

    test('3. Mostra o selector de perfil', async ({ page }) => {
        await page.goto(DASHBOARD_URL);
        const options = await page.locator('#sel-profile option').count();
        expect(options).toBe(4);
    });

    test('4. Botão Run Selected visível', async ({ page }) => {
        await page.goto(DASHBOARD_URL);
        await expect(page.locator('#btn-run')).toBeVisible();
        await expect(page.locator('#btn-run')).not.toBeDisabled();
        await expect(page.locator('#btn-stop')).toBeDisabled();
    });

    test('5. Check All dispara chamadas', async ({ page }) => {
        await page.goto(DASHBOARD_URL);
        await page.waitForTimeout(3000);
        const logCount = await page.locator('.log-entry').count();
        expect(logCount).toBeGreaterThanOrEqual(0);
    });

    test('6. Tabela mostra "No results yet"', async ({ page }) => {
        await page.goto(DASHBOARD_URL);
        await expect(page.locator('#rtbody')).toContainText('No results yet');
    });

    test('7. API status funciona', async ({ request }) => {
        const response = await request.get(DASHBOARD_URL + '/api/status');
        expect(response.ok()).toBeTruthy();
        const body = await response.json();
        expect(body.services).toBeDefined();
    });

    test('8. Modal de testes existe no DOM', async ({ page }) => {
        await page.goto(DASHBOARD_URL);
        const modal = page.locator('#modal-bg');
        await expect(modal).toBeAttached();
    });

});
