const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.resolve(__dirname, '..', 'web_content_extractor.html');

function createJsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return body;
        },
        async text() {
            return typeof body === 'string' ? body : JSON.stringify(body);
        }
    };
}

function createFetchMock() {
    const queued = [];
    const calls = [];

    const fetchStub = async (url, options = {}) => {
        const call = { url: String(url), options: options || {} };
        calls.push(call);
        if (!queued.length) {
            if (call.url.includes('/api/tags')) {
                return createJsonResponse({
                    models: [
                        { name: 'test-llm-a', model: 'test-llm-a' },
                        { name: 'test-llm-b', model: 'test-llm-b' }
                    ]
                });
            }
            if (call.url.includes('/api/pull')) {
                return createJsonResponse({ status: 'success' });
            }
            return createJsonResponse({ ok: true });
        }
        const responder = queued.shift();
        return responder(call);
    };

    fetchStub.queueResponse = responder => {
        queued.push(responder);
    };

    fetchStub.reset = () => {
        queued.length = 0;
        calls.length = 0;
    };

    fetchStub.calls = calls;

    return fetchStub;
}

async function bootstrapApp(fetchMock) {
    fetchMock.reset();

    const dom = await JSDOM.fromFile(HTML_PATH, {
        runScripts: 'dangerously',
        resources: 'usable',
        pretendToBeVisual: true,
        beforeParse(window) {
        window.fetch = fetchMock;
        window.scrollTo = () => {};
        window.matchMedia = () => ({
            matches: false,
            addEventListener() {},
            removeEventListener() {}
        });
        const storageBacking = new Map();
        const storage = {
            get length() {
                return storageBacking.size;
            },
            key(index) {
                return Array.from(storageBacking.keys())[index] ?? null;
            },
            getItem(key) {
                return storageBacking.has(key) ? storageBacking.get(key) : null;
            },
            setItem(key, value) {
                storageBacking.set(String(key), String(value));
            },
            removeItem(key) {
                storageBacking.delete(key);
            },
            clear() {
                storageBacking.clear();
            }
        };
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: storage
        });
        Object.defineProperty(window, 'sessionStorage', {
            configurable: true,
            value: storage
        });
        if (!window.crypto) {
            window.crypto = {};
        }
            if (!window.crypto.randomUUID) {
                let counter = 0;
                window.crypto.randomUUID = () => {
                    counter += 1;
                    return `00000000-0000-4000-8000-${counter.toString().padStart(12, '0')}`;
                };
            }
            window.structuredClone =
                window.structuredClone ||
                (value => JSON.parse(JSON.stringify(value)));
        }
    });

    await new Promise(resolve => {
        if (dom.window.document.readyState !== 'loading') {
            resolve();
            return;
        }
        dom.window.addEventListener('DOMContentLoaded', resolve, { once: true });
    });

    // allow async initialisers to settle
    await new Promise(resolve => setTimeout(resolve, 20));
    return dom;
}

const fetchMock = createFetchMock();
let dom;

beforeEach(async () => {
    if (dom) {
        dom.window.close();
        dom = null;
    }
    dom = await bootstrapApp(fetchMock);
});

afterEach(() => {
    if (dom) {
        dom.window.close();
        dom = null;
    }
});

test('tool calls work across multiple LLM models', async () => {
    const { window } = dom;
    const baseUrl = 'http://ollama.test';
    const toolExecutions = [];

    let currentModel = null;

    window.executeOllamaToolCall = async toolCall => {
        toolExecutions.push({ model: currentModel, tool: toolCall?.function?.name });
        return {
            name: toolCall?.function?.name || 'unknown_tool',
            content: JSON.stringify({ ok: true, model: currentModel }),
            display: `Rendered via ${currentModel}`
        };
    };

    const systemPrompt = { role: 'system', content: 'You are a test model.' };
    const userPrompt = { role: 'user', content: 'Fetch page info.' };

    const toolFirstResponse = {
        message: {
            role: 'assistant',
            content: '',
            tool_calls: [
                {
                    id: 'tool-1',
                    type: 'function',
                    function: { name: 'render_with_playwright', arguments: '{}' }
                }
            ]
        }
    };

    const finalFirstResponse = {
        message: {
            role: 'assistant',
            content: 'First model complete.'
        }
    };

    const toolSecondResponse = {
        message: {
            role: 'assistant',
            content: '',
            tool_calls: [
                {
                    id: 'tool-2',
                    type: 'function',
                    function: { name: 'render_with_playwright', arguments: '{"url":"https://example.com"}' }
                }
            ]
        }
    };

    const finalSecondResponse = {
        message: {
            role: 'assistant',
            content: 'Second model complete.'
        }
    };

    fetchMock.queueResponse(() => createJsonResponse(toolFirstResponse));
    fetchMock.queueResponse(() => createJsonResponse(finalFirstResponse));
    fetchMock.queueResponse(() => createJsonResponse(toolSecondResponse));
    fetchMock.queueResponse(() => createJsonResponse(finalSecondResponse));

    currentModel = 'llm-tool-a';
    const firstResult = await window.chatWithOllama({
        baseUrl,
        model: currentModel,
        messages: [systemPrompt, userPrompt],
        enableTools: true
    });

    currentModel = 'llm-tool-b';
    const secondResult = await window.chatWithOllama({
        baseUrl,
        model: currentModel,
        messages: [systemPrompt, userPrompt],
        enableTools: true
    });

    assert.equal(firstResult.toolExecutions.length, 1, 'first model should trigger one tool execution');
    assert.equal(secondResult.toolExecutions.length, 1, 'second model should trigger one tool execution');

    const modelsThatUsedTools = toolExecutions.map(entry => entry.model);
    assert.deepEqual(
        modelsThatUsedTools,
        ['llm-tool-a', 'llm-tool-b'],
        'each model should invoke the tool flow once'
    );
});

test('multiple LLM models can respond without tool usage', async () => {
    const { window } = dom;
    const baseUrl = 'http://ollama.test';

    window.executeOllamaToolCall = async () => {
        throw new Error('Tools should not be invoked for this regression scenario.');
    };

    const systemPrompt = { role: 'system', content: 'Plain response model.' };
    const userPrompt = { role: 'user', content: 'Just answer directly.' };

    fetchMock.queueResponse(() =>
        createJsonResponse({
            message: {
                role: 'assistant',
                content: 'Model alpha response with no tools.'
            }
        })
    );

    fetchMock.queueResponse(() =>
        createJsonResponse({
            message: {
                role: 'assistant',
                content: 'Model beta response with no tools.'
            }
        })
    );

    const alpha = await window.chatWithOllama({
        baseUrl,
        model: 'llm-alpha',
        messages: [systemPrompt, userPrompt],
        enableTools: true
    });

    const beta = await window.chatWithOllama({
        baseUrl,
        model: 'llm-beta',
        messages: [systemPrompt, userPrompt],
        enableTools: true
    });

    assert.equal(alpha.toolExecutions.length, 0, 'alpha model should not execute tools');
    assert.equal(beta.toolExecutions.length, 0, 'beta model should not execute tools');
    assert.match(alpha.finalContent, /no tools/i);
    assert.match(beta.finalContent, /no tools/i);
});
