import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

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
