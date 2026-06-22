import { test, expect } from '@playwright/test';

// Default to the dashboard where the charger is accessible, or use an environment variable
const SUT_URL = process.env.SUT_URL || 'http://localhost:3011/';

test.describe('SUT Authentication Mechanism (Invalid ID)', () => {
    
    test('Authenticate via Keypad (Outlet 3, PIN 222222)', async ({ page }) => {
        console.log(`[SUT Auth] Navigating to Physical Charger UI at: ${SUT_URL}`);
        
        // Navigate to the Physical Charger UI
        await page.goto(SUT_URL);
        
        // 1. Select Outlet 3
        console.log('[SUT Auth] Selecting Outlet 3 (CCS)...');
        // The DOM has a data-testid="outlet-3-name" with text "CCS"
        await page.locator('[data-testid="outlet-3-name"]').click();
        
        // 2. Select PIN as authentication method
        console.log('[SUT Auth] Selecting PIN authentication...');
        // We use a case-insensitive regex to find the pin text
        await page.getByText(/pin/i, { exact: true }).click();
        
        // 3. Enter PIN '222222'
        console.log('[SUT Auth] Entering PIN: 222222...');
        // Wait for the keypad to appear before clicking
        await page.waitForSelector('[data-testid="2-pin-button"]', { state: 'visible', timeout: 10000 });
        for (let i = 0; i < 6; i++) {
            await page.click('[data-testid="2-pin-button"]');
            // Adding a slight delay between presses mimicking real human interaction
            await page.waitForTimeout(200); 
        }
        
        // 4. Confirm
        console.log('[SUT Auth] Confirming PIN...');
        await page.click('[data-testid="confirm-btn"]');
        
        // Wait briefly to allow the UI to process the confirmation and trigger backend actions
        await page.waitForTimeout(2000);
        console.log('[SUT Auth] Authentication sequence completed.');
    });

});
