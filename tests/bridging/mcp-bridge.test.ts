import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPBridge } from '../../src/bridging/mcp-bridge';

describe('MCPBridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CODEX_MCP_BRIDGE_RETRY_ATTEMPTS;
    delete process.env.CODEX_MCP_BRIDGE_RETRY_DELAY_MS;
    delete process.env.CODEX_MCP_BRIDGE_TIMEOUT_MS;
  });

  it('retries transient transport failures and succeeds', async () => {
    process.env.CODEX_MCP_BRIDGE_RETRY_ATTEMPTS = '2';
    process.env.CODEX_MCP_BRIDGE_RETRY_DELAY_MS = '1';

    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockRejectedValueOnce(new Error('temporary network error #2'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock as any);

    const bridge = new MCPBridge();
    await bridge.initialize();
    await bridge.connectEndpoint('http://localhost:8081');

    const result = await bridge.sendMessage('http://localhost:8081', { ping: true });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns structured timeout errors', async () => {
    process.env.CODEX_MCP_BRIDGE_RETRY_ATTEMPTS = '0';
    process.env.CODEX_MCP_BRIDGE_TIMEOUT_MS = '25';

    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockRejectedValue(abortError);
    vi.stubGlobal('fetch', fetchMock as any);

    const bridge = new MCPBridge();
    await bridge.initialize();
    await bridge.connectEndpoint('http://localhost:8081');

    const result = await bridge.sendMessage('http://localhost:8081', { ping: true });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('timeout');
    expect(result.error?.retryable).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('does not retry non-retryable upstream 4xx errors', async () => {
    process.env.CODEX_MCP_BRIDGE_RETRY_ATTEMPTS = '3';

    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'bad request' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock as any);

    const bridge = new MCPBridge();
    await bridge.initialize();
    await bridge.connectEndpoint('http://localhost:8081');

    const result = await bridge.sendMessage('http://localhost:8081', { ping: true });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error?.code).toBe('upstream_error');
    expect(result.error?.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
