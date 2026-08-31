#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const pack = await readJson('contracts/registries/manifest.json');
const requirements = await readJson('contracts/registries/requirements/requirements.json');
const artifacts = await readJson('contracts/registries/artifact-trace/artifact-trace.json');
const surfaceSql = await readFile(new URL('database/baseline/00000000000001_ssot_surface.sql', root), 'utf8');
const blockers = [];
for (const record of requirements.records) if (!record.artifactIds?.length) { blockers.push('TRACEABILITY_INCOMPLETE'); break; }
if (artifacts.records.length === 0) blockers.push('ARTIFACT_TRACE_EMPTY');
if (/document jsonb NOT NULL DEFAULT '\{\}'::jsonb/iu.test(surfaceSql)) blockers.push('GENERIC_ENTITY_SCHEMA');
const result = { schemaVersion: '1.0', authority: 'SSOT_CURRENT.md', packDigest: pack.packDigest, status: blockers.length ? 'FAIL' : 'PASS', blockers: [...new Set(blockers)], evaluatedAt: new Date().toISOString() };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status !== 'PASS') process.exitCode = 1;
