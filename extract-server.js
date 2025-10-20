const { chromium } = require('playwright');
const express = require('express');
const app = express();

// Basic CORS support so the browser UI can reach this server from file:// or other origins
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

app.post('/extract-with-playwright', async (req, res) => {
    try {
        const { url, waitTime } = req.body;
        const effectiveWait = Number.isFinite(waitTime) ? waitTime : 3000;
        const navigationTimeout = Math.max(effectiveWait + 10000, 45000);
        
        const browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(navigationTimeout);
        
        console.log(`Navigating to: ${url}`);
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });
        } catch (navError) {
            if (navError.name === 'TimeoutError') {
                console.warn('Navigation timed out waiting for DOMContentLoaded:', navError.message);
            } else {
                throw navError;
            }
        }
        
        // Try to wait for network to settle, but don't fail if it never does
        try {
            await page.waitForLoadState('networkidle', { timeout: Math.min(navigationTimeout, 15000) });
        } catch (idleError) {
            console.warn('Network idle state not reached within timeout, continuing extraction.');
        }
        
        // Wait for dynamic content
        console.log(`Waiting ${effectiveWait}ms for dynamic content...`);
        await page.waitForTimeout(effectiveWait);
        
        // Get HTML
        const html = await page.content();
        await context.close();
        await browser.close();
        
        res.json({ success: true, html });
    } catch (error) {
        console.error('Playwright error:', error);
        res.json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3050;
app.listen(PORT, () => {
    console.log(`🚀 Playwright extraction server running on port ${PORT}`);
    console.log('Ready to extract JavaScript-heavy content!');
});
