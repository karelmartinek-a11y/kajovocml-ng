import { describe, expect, it } from 'vitest';
import { agentDefinitionSchema } from '@kcml/agent-sdk';

describe('agent definition boundary', () => {
  const valid = {
    name: 'provozní-agent', instructions: 'Ověř stav a vrať strukturovaný výsledek.', model: 'gpt-5.4', mode: 'INTERACTIVE',
    inputSchema: { type: 'object', additionalProperties: false }, outputSchema: { type: 'object', additionalProperties: false },
    toolAliases: { status: { operation: 'component.state.query', bindingDigest: `sha256:${'1'.repeat(64)}` } }, maxTurns: 16, enabled: true
  };

  it('accepts an exact immutable tool alias snapshot', () => {
    expect(agentDefinitionSchema.parse(valid).toolAliases.status?.operation).toBe('component.state.query');
  });

  it('rejects disabled schema drift and undeclared fields', () => {
    expect(() => agentDefinitionSchema.parse({ ...valid, permission: 'admin' })).toThrow();
    expect(() => agentDefinitionSchema.parse({ ...valid, maxTurns: 129 })).toThrow();
  });
});
