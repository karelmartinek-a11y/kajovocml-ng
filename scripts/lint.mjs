#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const ignored = new Set(['node_modules', 'dist', '.git', 'artifacts', 'test-results', 'generated_images']);
// These are immutable user-provided and generated forensic records.  They are
// evidence, rather than implementation text, so a literal task label in them
// must not be mistaken for an unfinished implementation marker.
const evidenceFiles = new Set(['SSOT_CURRENT.md', 'ToDo.md', 'FORENSIC_AUDIT_CURRENT.md', 'pnpm-lock.yaml']);
const textExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.sql', '.sh', '.md', '.yml', '.yaml', '.service', '.socket', '.timer', '.conf']);
const forbidden = [/\bT[O]DO\b/u, /\bF[I]XME\b/u, /throw new Error\(["']not implemented["']\)/iu];
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && textExtensions.has(extname(entry.name)) && !evidenceFiles.has(entry.name) && !relative(root, path).startsWith('contracts/registries/')) {
      const text = await readFile(path, 'utf8');
      text.split('\n').forEach((line, index) => {
        for (const pattern of forbidden) if (pattern.test(line)) findings.push(`${relative(root, path)}:${index + 1}: ${pattern}`);
      });
    }
  }
}

await walk(root);
if (findings.length > 0) {
  process.stderr.write(`${findings.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Repository lint PASS\n');
}
