import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const MUTATION = /\b(?:INSERT\s+INTO|UPDATE\s+kcml\.|DELETE\s+FROM\s+kcml\.|ON\s+CONFLICT)\b/giu;

function sha(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }

// This is deliberately a file-level allowlist, rather than a name/keyword
// allowlist. A new SQL writer must be assigned to an exact owner boundary and
// cannot become valid by merely using a familiar table name.
const WRITER_BOUNDARIES = [
  ['packages/domain/src/operations.ts', 'CANONICAL_OPERATION_SERVICE'],
  ['packages/domain/src/canonical-operation-handlers.ts', 'CANONICAL_OPERATION_SERVICE'],
  ['packages/domain/src/auth.ts', 'WRITER-OWNER_IDENTITY'],
  ['packages/domain/src/component-operations.ts', 'WRITER-COMPONENT'],
  ['packages/domain/src/monitor-operations.ts', 'WRITER-MONITOR'],
  ['packages/domain/src/runtime-operations.ts', 'WRITER-RUNTIME'],
  ['packages/domain/src/secret-operations.ts', 'WRITER-SECRET'],
  ['packages/domain/src/secrets.ts', 'WRITER-SECRET'],
  ['packages/domain/src/self-test-operations.ts', 'WRITER-SELFTEST'],
  ['packages/domain/src/system-chat.ts', 'WRITER-CHAT'],
  ['packages/domain/src/platform-recovery.ts', 'WRITER-PLATFORM_RECOVERY'],
  ['packages/domain/src/recovery-authority.ts', 'WRITER-PLATFORM_RECOVERY'],
  ['packages/generation-orchestrator/src/index.ts', 'WRITER-GENERATION'],
  ['packages/database/src/index.ts', 'WRITER-QUEUE'],
  ['packages/database/src/cli.ts', 'WRITER-CONTRACT_PACK'],
  ['packages/openai-runtime/src/index.ts', 'WRITER-GENERATION'],
  ['packages/mcp-runtime/src/index.ts', 'WRITER-MCP'],
  ['packages/browser-interaction/src/index.ts', 'WRITER-BROWSER'],
  ['packages/browser-automation-runtime/src/index.ts', 'WRITER-BROWSER'],
  ['packages/worker-runtime/src/index.ts', 'WRITER-QUEUE'],
  ['apps/server/src/server.ts', 'CANONICAL_OPERATION_SERVICE'],
  ['apps/server/src/preview-ws.ts', 'CANONICAL_OPERATION_SERVICE'],
  ['apps/server/src/admin-cli.ts', 'CANONICAL_OPERATION_SERVICE']
];

function boundaryFor(repositoryPath) {
  return WRITER_BOUNDARIES.find(([path]) => path === repositoryPath)?.[1] ?? null;
}

async function collectFiles(root, directory) {
  const output = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    if (entry.isDirectory() && (entry.name === 'dist' || entry.name === 'node_modules')) continue;
    const path = join(root, directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectFiles(root, join(directory, entry.name)));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.')))) output.push(path);
  }
  return output.sort();
}

export async function auditWriterSources(root, files = null) {
  const paths = files ?? [...await collectFiles(root, 'apps'), ...await collectFiles(root, 'packages')];
  const writes = [];
  const violations = [];
  for (const absolutePath of paths) {
    const repositoryPath = relative(root, absolutePath).replaceAll('\\', '/');
    const source = await readFile(absolutePath, 'utf8');
    const writerBoundary = boundaryFor(repositoryPath);
    let match;
    MUTATION.lastIndex = 0;
    while ((match = MUTATION.exec(source)) !== null) {
      const line = source.slice(0, match.index).split('\n').length;
      const evidence = source.split('\n')[line - 1]?.trim() ?? '';
      const record = { repositoryPath, line, writerBoundary, mutationKind: match[0].toUpperCase(), evidenceDigest: sha(evidence) };
      writes.push(record);
      if (!writerBoundary) violations.push({ ...record, code: 'UNREGISTERED_SQL_WRITER' });
    }
  }
  return { writes, violations, evidenceDigest: sha(JSON.stringify({ writes, violations })) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(new URL('.', import.meta.url).pathname, '..', '..');
  const result = await auditWriterSources(root);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.violations.length) process.exitCode = 1;
}
