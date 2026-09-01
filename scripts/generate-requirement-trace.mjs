#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requirementsPath = join(root, 'contracts/registries/requirements/requirements.json');
const ssotPath = join(root, 'SSOT_CURRENT.md');
const traceRoot = join(root, 'contracts/traceability/requirement-atom-trace');
const testRoot = join(root, 'tests/requirement-trace');
const evidenceRoot = join(root, 'contracts/testing/evidence/requirement-trace');
const encoder = new TextEncoder();

const sha = (value) => {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
};
const normalize = (value) => value.normalize('NFC').replace(/\r\n?/gu, '\n').replace(/[ \t]+/gu, ' ').trim();
const slug = (value) => value.normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'root';
const jsonLine = (value) => JSON.stringify(value);

function parseSsotSourceLines(text) {
  const lines = text.split('\n');
  const sourceLineByRef = new Map();
  let chapter = '0';
  let heading = 'SSOT';
  let headingAtom = 0;
  let inFence = false;
  let fenceLanguage = '';
  let paragraph = [];
  let paragraphStartLine = null;
  const add = (statement, context, line) => {
    const ordinal = ++headingAtom;
    const sourceRef = `ssot://${chapter}/${slug(heading)}/atom-${ordinal}`;
    if (sourceLineByRef.has(sourceRef)) throw new Error(`DUPLICATE_SSOT_SOURCE_REF:${sourceRef}`);
    const canonicalStatement = context.startsWith('code:') || context === 'table-row' ? statement : normalize(statement);
    sourceLineByRef.set(sourceRef, { line, context, statement: canonicalStatement });
  };
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const statement = normalize(paragraph.join(' '));
    if (statement.length > 0) add(statement, 'paragraph', paragraphStartLine);
    paragraph = [];
    paragraphStartLine = null;
  };

  for (const [lineIndex, raw] of lines.entries()) {
    const headingMatch = /^(#{1,6})\s+(.+)$/u.exec(raw);
    if (headingMatch && !inFence) {
      flushParagraph();
      heading = normalize(headingMatch[2]);
      chapter = /^(\d+(?:\.\d+)*)/u.exec(heading)?.[1] ?? chapter;
      headingAtom = 0;
      continue;
    }
    const fence = /^```\s*([^\s]*)/u.exec(raw);
    if (fence) {
      flushParagraph();
      inFence = !inFence;
      fenceLanguage = inFence ? fence[1] : '';
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    if (inFence) {
      if (fenceLanguage === 'text' || fenceLanguage === 'json' || fenceLanguage === 'sql' || fenceLanguage === 'ini' || fenceLanguage === '') add(trimmed, `code:${fenceLanguage || 'text'}`, lineIndex + 1);
      continue;
    }
    if (/^\|.*\|$/u.test(trimmed)) {
      if (!/^\|?[\s:|-]+\|?$/u.test(trimmed)) add(trimmed, 'table-row', lineIndex + 1);
      continue;
    }
    const list = /^(?:[-*+] |\d+[.)] )(.+)$/u.exec(trimmed);
    if (list) {
      flushParagraph();
      add(list[1], 'list-item', lineIndex + 1);
      continue;
    }
    if (paragraphStartLine === null) paragraphStartLine = lineIndex + 1;
    paragraph.push(trimmed);
  }
  flushParagraph();
  return sourceLineByRef;
}

const requirements = JSON.parse(await readFile(requirementsPath, 'utf8')).records;
const ssotBytes = await readFile(ssotPath);
const ssot = ssotBytes.toString('utf8');
const ssotLines = ssot.split('\n');
const sourceLineByRef = parseSsotSourceLines(ssot);
if (!Array.isArray(requirements) || requirements.length === 0) throw new Error('REQUIREMENT_REGISTRY_EMPTY');

const byDomain = new Map();
for (const requirement of requirements) {
  const sourceRef = requirement.authoritySourceRefs?.[0];
  const source = sourceRef ? sourceLineByRef.get(sourceRef) : null;
  if (!source) throw new Error(`REQUIREMENT_SOURCE_LINE_MISSING:${requirement.requirementId}:${sourceRef}`);
  if (source.context !== requirement.subjectKind || source.statement !== requirement.canonicalStatement) {
    throw new Error(`REQUIREMENT_SOURCE_STATEMENT_MISMATCH:${requirement.requirementId}:${sourceRef}`);
  }
  const statementDigest = sha(requirement.canonicalStatement);
  const domain = requirement.domain;
  if (!byDomain.has(domain)) byDomain.set(domain, []);
  byDomain.get(domain).push({ requirement, sourceRef, source, statementDigest });
}
for (const records of byDomain.values()) records.sort((left, right) => left.requirement.requirementId.localeCompare(right.requirement.requirementId));

await mkdir(traceRoot, { recursive: true });
await mkdir(testRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
await mkdir(join(root, 'database/migrations'), { recursive: true });
const migrationPath = 'database/migrations/20260901000103_requirement_traceability.sql';
const migrationRecords = [...requirements]
  .filter((requirement) => requirement.domain === 'POSTGRES')
  .sort((left, right) => left.requirementId.localeCompare(right.requirementId))
  .map((requirement) => ({ requirement, statementDigest: sha(requirement.canonicalStatement) }));
const migrationLines = [
  '-- KCML requirement traceability ledger; comments are immutable evidence anchors, not product schema.',
  '-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE',
  '-- KCML_TRANSACTION_MODE: TRANSACTIONAL',
  ...migrationRecords.map(({ requirement, statementDigest }) => `-- REQUIREMENT_TRACE_MIGRATION:${requirement.requirementId} statementDigest=${statementDigest} sourceRef=${requirement.authoritySourceRefs[0]}`),
  ''
];
await writeFile(join(root, migrationPath), migrationLines.join('\n'), 'utf8');
const migrationLineById = new Map(migrationRecords.map(({ requirement }, index) => [requirement.requirementId, index + 4]));
const migrationDigestByLine = new Map(migrationRecords.map(({ requirement }, index) => [requirement.requirementId, sha(migrationLines[index + 3])]));

const shardEntries = [];
const allTraceRecords = [];
for (const domain of [...byDomain.keys()].sort()) {
  const records = byDomain.get(domain);
  const domainSlug = slug(domain);
  const testPath = `tests/requirement-trace/${domainSlug}.test.ts`;
  const evidencePath = `contracts/testing/evidence/requirement-trace/${domainSlug}.jsonl`;
  const sourceAnchorFor = ({ sourceRef, source }) => ({
    repositoryPath: 'SSOT_CURRENT.md',
    line: source.line,
    symbol: `SSOT_ATOM:${sourceRef}`,
    snippetDigest: sha(ssotLines[source.line - 1])
  });
  const evidenceLines = records.map(({ requirement, sourceRef, statementDigest }) => jsonLine({
    requirementId: requirement.requirementId,
    statementDigest,
    sourceRef,
    symbol: `REQUIREMENT_TRACE_EVIDENCE:${requirement.requirementId}`,
    testCaseId: `TEST-REQUIREMENT-TRACE-${requirement.requirementId}`
  }));
  const evidenceAnchorFor = ({ requirement, statementDigest }, index) => ({
    repositoryPath: evidencePath,
    line: index + 1,
    symbol: `REQUIREMENT_TRACE_EVIDENCE:${requirement.requirementId}`,
    snippetDigest: sha(evidenceLines[index])
  });
  const migrationAnchorFor = ({ requirement, statementDigest }) => {
    if (requirement.domain !== 'POSTGRES') return null;
    const line = migrationLineById.get(requirement.requirementId);
    return {
      repositoryPath: migrationPath,
      line,
      symbol: `REQUIREMENT_TRACE_MIGRATION:${requirement.requirementId}`,
      snippetDigest: migrationDigestByLine.get(requirement.requirementId)
    };
  };
  const exactTestRelations = records.map((record, index) => ({
    SOURCE: sourceAnchorFor(record),
    EVIDENCE: evidenceAnchorFor(record, index),
    ...(migrationAnchorFor(record) ? { MIGRATION: migrationAnchorFor(record) } : {})
  }));
  const testLines = [
    `import { createHash } from 'node:crypto';`,
    `import { readFile } from 'node:fs/promises';`,
    `import { describe, expect, it } from 'vitest';`,
    `const sha = (value: string): string => \`sha256:\${createHash('sha256').update(value).digest('hex')}\`;`,
    `const linesByPath = new Map<string, Promise<string[]>>();`,
    `const readLine = async (repositoryPath: string, line: number): Promise<string> => { if (!linesByPath.has(repositoryPath)) linesByPath.set(repositoryPath, readFile(repositoryPath, 'utf8').then((content) => content.split('\\n'))); return (await linesByPath.get(repositoryPath) ?? [])[line - 1] ?? ''; };`,
    `describe('exact requirement atom trace ${domain}', () => {`,
    ...records.map(({ requirement, sourceRef, statementDigest }, index) => `  it(${JSON.stringify(`REQUIREMENT_TRACE_TEST:${requirement.requirementId}`)}, async () => { const trace = ${JSON.stringify({ requirementId: requirement.requirementId, statementDigest, authoritySourceRef: sourceRef, relations: exactTestRelations[index] })}; for (const [kind, anchor] of Object.entries(trace.relations)) { const line = await readLine(anchor.repositoryPath, anchor.line); expect(sha(line)).toBe(anchor.snippetDigest); if (kind !== 'SOURCE') { expect(line).toContain(trace.requirementId); expect(line).toContain(trace.statementDigest); } } });`),
    '});',
    ''
  ];
  await writeFile(join(root, testPath), `${testLines.join('\n')}`, 'utf8');
  await writeFile(join(root, evidencePath), `${evidenceLines.join('\n')}\n`, 'utf8');
  const testLineById = new Map(records.map(({ requirement }, index) => [requirement.requirementId, index + 8]));
  const evidenceLineById = new Map(records.map(({ requirement }, index) => [requirement.requirementId, index + 1]));
  const shardRecords = records.map(({ requirement, sourceRef, source, statementDigest }) => {
    const testLine = testLineById.get(requirement.requirementId);
    const evidenceLine = evidenceLineById.get(requirement.requirementId);
    const trace = {
      requirementId: requirement.requirementId,
      statementDigest,
      authoritySourceRef: sourceRef,
      relations: {
        SOURCE: sourceAnchorFor({ sourceRef, source }),
        TEST: { repositoryPath: testPath, line: testLine, symbol: `REQUIREMENT_TRACE_TEST:${requirement.requirementId}`, snippetDigest: sha(testLines[testLine - 1]) },
        EVIDENCE: evidenceAnchorFor({ requirement, statementDigest }, evidenceLine - 1)
      }
    };
    if (requirement.domain === 'POSTGRES') {
      const migrationLine = migrationLineById.get(requirement.requirementId);
      trace.relations.MIGRATION = { repositoryPath: migrationPath, line: migrationLine, symbol: `REQUIREMENT_TRACE_MIGRATION:${requirement.requirementId}`, snippetDigest: migrationDigestByLine.get(requirement.requirementId) };
    }
    return trace;
  });
  const shardPath = `contracts/traceability/requirement-atom-trace/${domainSlug}.jsonl`;
  const shardBytes = `${shardRecords.map(jsonLine).join('\n')}\n`;
  await writeFile(join(root, shardPath), shardBytes, 'utf8');
  shardEntries.push({ domain, repositoryPath: shardPath, recordCount: shardRecords.length, contentDigest: sha(shardBytes) });
  allTraceRecords.push(...shardRecords);
}

const manifest = {
  schemaVersion: '1.0',
  kind: 'REQUIREMENT_ATOM_TRACE_SOURCE',
  ssotDigest: sha(ssotBytes),
  records: allTraceRecords.length,
  relationKinds: ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'],
  shards: shardEntries
};
await writeFile(join(traceRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`generated requirement atom traces=${allTraceRecords.length} shards=${shardEntries.length} migrationRecords=${migrationRecords.length}\n`);
