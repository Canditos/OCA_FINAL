import { chromium } from "playwright";
import { log } from "../routes/logs.routes.js";

let activeAuthPromise: Promise<void> = Promise.resolve();

export async function authenticateViaKeypad(pin: string = "111111", connectorId: string = "3") {
    // Chain onto the active promise to serialize executions
    const nextAuth = activeAuthPromise.then(async () => {
        const SUT_URL = process.env.SUT_URL || 'http://localhost:3011/';
        log("info", `[SUT Automation] Launching browser to automate Keypad at: ${SUT_URL}`, "sut");
        
        const browser = await chromium.launch({ headless: true });
        
        try {
            const page = await browser.newPage();
            
            await page.goto(SUT_URL);
            
            log("info", `[SUT Automation] Selecting Outlet ${connectorId}...`, "sut");
            await page.locator(`[data-testid="outlet-${connectorId}-name"]`).click();
            
            log("info", `[SUT Automation] Selecting PIN authentication...`, "sut");
            await page.getByText('PIN', { exact: true }).click();
            
            log("info", `[SUT Automation] Entering PIN: ${pin}...`, "sut");
            await page.waitForSelector('[data-testid="1-pin-button"]', { state: 'visible', timeout: 10000 });
            for (const char of pin) {
                await page.click(`[data-testid="${char}-pin-button"]`);
                await page.waitForTimeout(200); 
            }
            
            log("info", `[SUT Automation] Confirming PIN...`, "sut");
            await page.click('[data-testid="confirm-btn"]');
            
            await page.waitForTimeout(2000);
            log("info", `[SUT Automation] Authentication sequence completed successfully.`, "sut");
        } catch (err: any) {
            log("error", `[SUT Automation] Failed: ${err.message}`, "sut");
            throw err;
        } finally {
            await browser.close();
        }
    }).catch(err => {
        log("error", `[SUT Automation] Auth queue step failed: ${err.message}`, "sut");
    });

    activeAuthPromise = nextAuth;
    return nextAuth;
}
