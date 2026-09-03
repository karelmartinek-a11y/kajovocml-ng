import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildOpenAIRequestPayload, canTransitionOpenAILocalState, normalizeOpenAIResponse, normalizeProviderFailure } from '../../packages/openai-runtime/src/index.js';

describe('OpenAI trusted runtime contract', () => {
  it('uses official packages and Responses API only inside the trusted runtime', async () => {
    const packageJson = JSON.parse(await readFile('packages/openai-runtime/package.json', 'utf8'));
    const source = await readFile('packages/openai-runtime/src/index.ts', 'utf8');
    expect(packageJson.dependencies).toHaveProperty('openai');
    expect(packageJson.dependencies).toHaveProperty('@openai/agents');
    expect(source).toContain('.responses.');
    expect(source).toContain('maxRetries:0');
    const server = await readFile('apps/server/package.json', 'utf8');
    expect(server).not.toContain('"openai"');
  });
});

describe('OpenAI persisted lifecycle behavior', () => {
  it('exposes exactly the SSOT local transition graph and rejects marker transitions', () => {
    expect(canTransitionOpenAILocalState('QUEUED', 'SUBMITTING')).toBe(true);
    expect(canTransitionOpenAILocalState('SUBMITTING', 'STREAMING')).toBe(true);
    expect(canTransitionOpenAILocalState('STREAMING', 'WAITING_FOR_TOOL_OUTPUT')).toBe(true);
    expect(canTransitionOpenAILocalState('WAITING_FOR_TOOL_OUTPUT', 'COMPLETED')).toBe(true);
    expect(canTransitionOpenAILocalState('QUEUED', 'COMPLETED')).toBe(false);
    expect(canTransitionOpenAILocalState('COMPLETED', 'SUBMITTING')).toBe(false);
  });

  it('normalizes provider status separately from local refusal/incomplete/tool semantics', () => {
    expect(normalizeOpenAIResponse({ status: 'completed' }, [{ type: 'function_call', call_id: 'call-1', name: 'tool', arguments: '{}' }])).toEqual({ state: 'WAITING_FOR_TOOL_OUTPUT', kind: 'TOOL_CALLS' });
    expect(normalizeOpenAIResponse({ status: 'completed' }, [{ type: 'message', content: [{ type: 'refusal' }] }])).toEqual({ state: 'REFUSED', kind: 'NO_OUTPUT' });
    expect(normalizeOpenAIResponse({ status: 'incomplete' }, [{ type: 'message', content: [{ type: 'output_text', text: '{' }] }])).toEqual({ state: 'INCOMPLETE' });
    expect(normalizeOpenAIResponse({ status: 'completed' }, [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }])).toEqual({ state: 'COMPLETED', kind: 'FINAL_OUTPUT' });
  });

  it('makes background persistence explicit and forbids mixed continuation handles', () => {
    const request = { parentRunId: 'run', ownerKind: 'AGENT_RUN' as const, model: 'gpt-test', instructions: 'test', input: 'hello', authority: {} as never };
    expect(buildOpenAIRequestPayload(request, false, true)).toMatchObject({ background: true, store: true, stream: false });
    expect(() => buildOpenAIRequestPayload({ ...request, previousResponseId: 'resp', conversationId: 'conv' }, false, true)).toThrow('mutually exclusive');
  });
});

describe('OpenAI provider error normalization', () => {
  it('maps raw provider failures to a stable API error instead of INTERNAL_ERROR', () => {
    const error = normalizeProviderFailure('call-1', new Error('provider connection failed'));
    expect(error.code).toBe('OPENAI_PROVIDER_TRANSIENT');
    expect(error.httpStatus).toBe(502);
    expect(error.retryDirective).toBe('RETRY_SAME_OPERATION');
    expect(error.details).toEqual({ callId: 'call-1' });
  });

  it('preserves canonical domain errors during provider normalization', () => {
    const original = normalizeProviderFailure('call-1', new Error('provider connection failed'));
    expect(normalizeProviderFailure('call-1', original)).toBe(original);
  });
});
