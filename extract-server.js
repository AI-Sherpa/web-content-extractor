const { chromium } = require('playwright');
const express = require('express');
const app = express();

const CACHE_LIMIT = Number(process.env.PLAYWRIGHT_CACHE_LIMIT || 32);
const CACHE_TTL_MS = Number(process.env.PLAYWRIGHT_CACHE_TTL_MS || 2 * 60 * 1000);
const DEFAULT_USER_AGENT =
    process.env.PLAYWRIGHT_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_VIEWPORT = {
    width: Number(process.env.PLAYWRIGHT_VIEWPORT_WIDTH || 1365),
    height: Number(process.env.PLAYWRIGHT_VIEWPORT_HEIGHT || 768)
};
const DEFAULT_LOCALE = process.env.PLAYWRIGHT_LOCALE || 'en-US';
const DEFAULT_TIMEZONE = process.env.PLAYWRIGHT_TIMEZONE || 'America/Los_Angeles';
const DEFAULT_ACCEPT_LANGUAGE = process.env.PLAYWRIGHT_ACCEPT_LANGUAGE || 'en-US,en;q=0.9';
const DEFAULT_SEC_CH_UA =
    process.env.PLAYWRIGHT_SEC_CH_UA ||
    '"Chromium";v="124", "Google Chrome";v="124", "Not:A-Brand";v="99"';
const DEFAULT_SEC_CH_UA_PLATFORM =
    process.env.PLAYWRIGHT_SEC_CH_UA_PLATFORM || '"Windows"';

let browserPromise = null;
let isClosing = false;
const renderCache = new Map();

function normalizeHostname(value) {
    if (!value) {
        return '';
    }
    return value.toLowerCase().replace(/^www\./, '');
}

function getHostnameFromUrl(value) {
    try {
        const url = new URL(value);
        return normalizeHostname(url.hostname || '');
    } catch {
        return '';
    }
}

function isYouTubeHost(hostname) {
    const normalized = normalizeHostname(hostname);
    return (
        normalized === 'youtube.com' ||
        normalized.endsWith('.youtube.com') ||
        normalized === 'youtu.be'
    );
}

async function getBrowser() {
    if (isClosing) {
        throw new Error('Browser is shutting down, cannot handle new requests.');
    }
    if (!browserPromise) {
        console.log('Launching persistent Playwright browser instance...');
        browserPromise = chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }).catch(error => {
            browserPromise = null;
            throw error;
        });
    }
    return browserPromise;
}

async function closeBrowser() {
    if (!browserPromise) {
        return;
    }
    try {
        const browser = await browserPromise;
        await browser.close();
    } catch (error) {
        console.warn('Error closing Playwright browser:', error);
    } finally {
        browserPromise = null;
    }
}

async function warmPlaywrightBrowser() {
    let context = null;
    let page = null;
    try {
        const browser = await getBrowser();
        context = await browser.newContext({
            userAgent: DEFAULT_USER_AGENT,
            viewport: DEFAULT_VIEWPORT,
            locale: DEFAULT_LOCALE,
            timezoneId: DEFAULT_TIMEZONE
        });
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            if (!window.chrome) {
                window.chrome = { runtime: {} };
            }
        });
        await context.setExtraHTTPHeaders(buildBrowserHeaders('https://example.com/'));
        const page = await context.newPage();
        await page.goto('about:blank');
        await context.close();
        console.log('Playwright browser warmed and ready.');
    } catch (error) {
        console.warn('Browser warm-up failed:', error);
    }
}

function buildBrowserHeaders(targetUrl) {
    const headers = {
        'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
        'Sec-CH-UA': DEFAULT_SEC_CH_UA,
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': DEFAULT_SEC_CH_UA_PLATFORM
    };
    try {
        const parsed = new URL(targetUrl);
        headers.Referer = `${parsed.origin}/`;
    } catch {
        // ignore parse errors, fall back to defaults
    }
    return headers;
}

function buildCacheKey(mode, url) {
    return `${mode}::${url}`;
}

function readFromCache(mode, url) {
    const entry = renderCache.get(buildCacheKey(mode, url));
    if (!entry) {
        return null;
    }
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        renderCache.delete(buildCacheKey(mode, url));
        return null;
    }
    return entry.payload;
}

function writeToCache(mode, url, payload) {
    const key = buildCacheKey(mode, url);
    renderCache.set(key, { timestamp: Date.now(), payload });
    if (renderCache.size > CACHE_LIMIT) {
        const oldestKey = renderCache.keys().next().value;
        if (oldestKey) {
            renderCache.delete(oldestKey);
        }
    }
}

async function attemptYouTubeConsent(page) {
    const selectors = [
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button:has-text("Agree")',
        'button:has-text("Accept cookies")',
        '#introAgreeButton',
        '#accept-button',
        'form[action*="consent"] button[type="submit"]'
    ];

    const clickIfPresent = async locator => {
        try {
            const count = await locator.count();
            if (count > 0) {
                await locator.first().click({ timeout: 2000 });
                await page.waitForTimeout(500);
                return true;
            }
        } catch (error) {
            console.warn('Unable to click YouTube consent button:', error.message);
        }
        return false;
    };

    for (const selector of selectors) {
        if (await clickIfPresent(page.locator(selector))) {
            return true;
        }
    }

    const consentFrames = page.frames().filter(frame => /consent\.youtube\.com/i.test(frame.url()));
    for (const frame of consentFrames) {
        for (const selector of selectors) {
            if (await clickIfPresent(frame.locator(selector))) {
                return true;
            }
        }
    }

    return false;
}

async function enrichYouTubePage(page, timeoutMs) {
    const timeout = Math.max(4000, Math.min(timeoutMs || 12000, 15000));
    try {
        await page.waitForFunction(
            () => {
                const metadataEl = document.querySelector('ytd-watch-metadata');
                const headline = metadataEl?.querySelector('h1');
                const description = document.querySelector('#description');
                return (
                    (headline && headline.textContent && headline.textContent.trim().length > 0) ||
                    (description && description.textContent && description.textContent.trim().length > 0) ||
                    typeof window.ytInitialData !== 'undefined'
                );
            },
            { timeout }
        );
    } catch (error) {
        console.warn('YouTube metadata wait timed out:', error.message);
    }

    const metadata = await page.evaluate(() => {
        const getText = selector => {
            const element = document.querySelector(selector);
            if (!element) {
                return '';
            }
            const value = element.innerText || element.textContent || '';
            return value.trim();
        };

        const getMeta = (name, attr = 'name') => {
            const element = document.querySelector(`meta[${attr}="${name}"]`);
            return element?.content?.trim() || '';
        };

        const title =
            getText('h1.ytd-watch-metadata') ||
            getText('h1.title') ||
            getMeta('title') ||
            document.title ||
            '';
        const description =
            getText('#description') ||
            getMeta('description') ||
            '';
        const channel =
            getText('ytd-channel-name a') ||
            getMeta('author') ||
            '';
        const published = getMeta('datePublished', 'itemprop');
        const viewCount = getMeta('interactionCount', 'itemprop');
        const keywords = getMeta('keywords');

        let duration = '';
        try {
            duration = getMeta('duration', 'itemprop') || '';
        } catch {
            duration = '';
        }

        return {
            title,
            description,
            channel,
            published,
            viewCount,
            keywords,
            duration
        };
    });

    if (!metadata) {
        return null;
    }

    if (metadata.description && metadata.description.length > 4000) {
        metadata.description = `${metadata.description.slice(0, 4000)}…`;
    }

    await page.evaluate(data => {
        if (!data) {
            return;
        }

        const containerId = 'playwright-youtube-extracted';
        let container = document.getElementById(containerId);
        if (!container) {
            container = document.createElement('section');
            container.id = containerId;
            container.dataset.playwrightInserted = 'true';
            container.style.padding = '16px';
            container.style.margin = '24px auto';
            container.style.maxWidth = '960px';
            container.style.borderRadius = '12px';
            container.style.background = 'rgba(16, 163, 127, 0.08)';
            container.style.border = '1px solid rgba(16, 163, 127, 0.25)';
            container.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.18)';
            if (document.body) {
                document.body.prepend(container);
            }
        } else {
            container.innerHTML = '';
        }

        const heading = document.createElement('h2');
        heading.textContent = 'Playwright Captured Video Summary';
        heading.style.margin = '0 0 12px';
        heading.style.fontSize = '1.6rem';
        heading.style.fontWeight = '700';
        container.appendChild(heading);

        const summaryList = document.createElement('dl');
        summaryList.style.display = 'grid';
        summaryList.style.gridTemplateColumns = 'max-content 1fr';
        summaryList.style.columnGap = '16px';
        summaryList.style.rowGap = '8px';
        summaryList.style.margin = '0';
        summaryList.style.fontSize = '1rem';

        const entries = [
            ['Title', data.title],
            ['Channel', data.channel],
            ['Published', data.published],
            ['Views', data.viewCount],
            ['Duration', data.duration],
            ['Keywords', data.keywords]
        ];

        entries.forEach(([label, value]) => {
            if (!value) {
                return;
            }
            const dt = document.createElement('dt');
            dt.textContent = `${label}:`;
            dt.style.fontWeight = '600';
            const dd = document.createElement('dd');
            dd.textContent = value;
            dd.style.margin = '0';
            summaryList.appendChild(dt);
            summaryList.appendChild(dd);
        });

        if (summaryList.childElementCount) {
            container.appendChild(summaryList);
        }

        if (data.description) {
            const descriptionHeading = document.createElement('h3');
            descriptionHeading.textContent = 'Description';
            descriptionHeading.style.margin = '18px 0 8px';
            descriptionHeading.style.fontSize = '1.25rem';
            descriptionHeading.style.fontWeight = '600';
            container.appendChild(descriptionHeading);

            const descriptionParagraph = document.createElement('p');
            descriptionParagraph.textContent = data.description;
            descriptionParagraph.style.whiteSpace = 'pre-wrap';
            descriptionParagraph.style.lineHeight = '1.6';
            container.appendChild(descriptionParagraph);
        }

        const metadataPre = document.createElement('pre');
        metadataPre.dataset.playwrightYoutube = 'metadata';
        metadataPre.style.marginTop = '18px';
        metadataPre.style.padding = '12px';
        metadataPre.style.borderRadius = '10px';
        metadataPre.style.background = 'rgba(0, 0, 0, 0.55)';
        metadataPre.style.color = '#f8fafc';
        metadataPre.style.whiteSpace = 'pre-wrap';
        metadataPre.style.fontSize = '0.95rem';
        metadataPre.textContent = JSON.stringify(data, null, 2);
        container.appendChild(metadataPre);
    }, metadata);

    return metadata;
}

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

app.use(express.json({ limit: '2mb' }));

async function handleExtraction(req, res) {
    const { url, waitTime, mode: requestedMode, options = {} } = req.body || {};
    const targetUrl = typeof url === 'string' ? url.trim() : '';
    if (!targetUrl) {
        return res.json({ success: false, error: 'Missing url' });
    }

    const mode = requestedMode || (req.path.includes('/api/playwright/extract') ? 'embedded' : 'container');
    const rawWait = Number.isFinite(waitTime) ? waitTime : (mode === 'embedded' ? 800 : 1500);
    const minWait = mode === 'embedded' ? 200 : 350;
    const maxWait = mode === 'embedded' ? 1200 : 2000;
    const effectiveWait = Math.max(minWait, Math.min(rawWait, maxWait));

    const cachedPayload = options.useCache !== false ? readFromCache(mode, targetUrl) : null;
    if (cachedPayload) {
        return res.json({
            success: true,
            html: cachedPayload.html,
            metadata: cachedPayload.metadata || null,
            cached: true
        });
    }

    let context = null;
    let page = null;
    try {
        const browser = await getBrowser();
        context = await browser.newContext({
            userAgent: DEFAULT_USER_AGENT,
            viewport: DEFAULT_VIEWPORT,
            locale: DEFAULT_LOCALE,
            timezoneId: DEFAULT_TIMEZONE
        });
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            if (!window.chrome) {
                window.chrome = { runtime: {} };
            }
        });
        await context.setExtraHTTPHeaders(buildBrowserHeaders(targetUrl));
        page = await context.newPage();
        if (options.blockMedia) {
            await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,mp4,mp3,woff,woff2}', route => route.abort());
            await page.route('**/*.{css,map}', route => route.abort());
        }

        const navigationTimeout = Math.max(effectiveWait + 10000, 30000);
        page.setDefaultNavigationTimeout(navigationTimeout);

        console.log(`[${mode}] Navigating to: ${targetUrl}`);
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });
        } catch (navError) {
            if (navError.name === 'TimeoutError') {
                console.warn('DOM content load timeout:', navError.message);
            } else {
                throw navError;
            }
        }

        const targetHost = getHostnameFromUrl(targetUrl);
        if (isYouTubeHost(targetHost)) {
            try {
                await attemptYouTubeConsent(page);
            } catch (consentError) {
                console.warn('YouTube consent handling failed:', consentError.message);
            }
        }

        if (options.fastSelector) {
            await page.waitForSelector(options.fastSelector, { timeout: 1500 }).catch(() => {});
        }

        try {
            await page.waitForLoadState('networkidle', { timeout: Math.min(navigationTimeout, 5000) });
        } catch {
            // silent fail, carry on
        }

        await page.waitForTimeout(effectiveWait);

        let extractedMetadata = null;
        if (isYouTubeHost(targetHost)) {
            try {
                await attemptYouTubeConsent(page);
            } catch (consentError) {
                console.warn('Second YouTube consent attempt failed:', consentError.message);
            }
        }
        if (isYouTubeHost(targetHost)) {
            try {
                extractedMetadata = await enrichYouTubePage(page, navigationTimeout);
            } catch (youtubeError) {
                console.warn('Unable to enrich YouTube metadata:', youtubeError.message);
            }
        }

        const html = await page.content();
        writeToCache(mode, targetUrl, { html, metadata: extractedMetadata });
        return res.json({ success: true, html, metadata: extractedMetadata, cached: false });
    } catch (error) {
        console.error('Playwright error:', error);
        return res.json({ success: false, error: error.message });
    } finally {
        if (context) {
            try {
                await context.close();
            } catch (closeError) {
                console.warn('Failed to close Playwright context:', closeError.message);
            }
        }
    }
}

app.post('/extract-with-playwright', handleExtraction);
app.post('/api/playwright/extract', handleExtraction);

const PORT = process.env.PORT || 3050;
app.listen(PORT, () => {
    console.log(`🚀 Playwright extraction server running on port ${PORT}`);
    console.log('Ready to extract JavaScript-heavy content!');
    warmPlaywrightBrowser();
});

async function shutdown(signal) {
    if (isClosing) {
        return;
    }
    isClosing = true;
    console.log(`Received ${signal}. Closing Playwright browser...`);
    await closeBrowser();
    process.exit(0);
}

['SIGTERM', 'SIGINT'].forEach(signal => {
    process.on(signal, () => {
        shutdown(signal).catch(error => {
            console.error(`Error during shutdown on ${signal}:`, error);
            process.exit(1);
        });
    });
});

process.on('uncaughtException', async error => {
    console.error('Uncaught exception:', error);
    await closeBrowser();
    process.exit(1);
});

process.on('unhandledRejection', async reason => {
    console.error('Unhandled promise rejection:', reason);
    await closeBrowser();
    process.exit(1);
});
