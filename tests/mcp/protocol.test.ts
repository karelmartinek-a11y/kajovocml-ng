import { describe, expect, it } from 'vitest';
import { supportedMcpVersions, validateMcpHeaders } from '@kcml/mcp-runtime';

const request = { jsonrpc: '2.0' as const, id: '1', method: 'tools/call', params: { name: 'system.health.read' } };
describe('MCP exact header binding', () => {
  it('accepts a supported version with exact body binding', () => expect(validateMcpHeaders(['mcp-protocol-version', supportedMcpVersions[0], 'mcp-method', 'tools/call', 'mcp-name', 'system.health.read'], request).name).toBe('system.health.read'));
  it('rejects duplicate singleton and mismatched headers', () => {
    expect(() => validateMcpHeaders(['mcp-protocol-version', supportedMcpVersions[0], 'mcp-protocol-version', supportedMcpVersions[0], 'mcp-method', 'tools/call', 'mcp-name', 'system.health.read'], request)).toThrow();
    expect(() => validateMcpHeaders(['mcp-protocol-version', supportedMcpVersions[0], 'mcp-method', 'tools/list', 'mcp-name', 'system.health.read'], request)).toThrow();
  });
});
