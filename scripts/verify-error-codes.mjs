#!/usr/bin/env node
import { parse } from '@babel/parser';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const registryDocument = JSON.parse(await readFile(join(root, 'contracts/registries/errors/errors.json'), 'utf8'));
const records = registryDocument.records.filter((record) => record.lifecycle === 'ACTIVE');
const recordsByCode = new Map(records.map((record) => [record.code, record]));
const consumers = new Map(records.map((record) => [record.code, []]));
const failures = [];
const sqlStateProjection = new Map([
  ['23505', 'IDEMPOTENCY_CONFLICT'],
  ['23514', 'STATE_MACHINE_CONTRACT_INCOMPLETE'],
  ['40001', 'STATE_VERSION_CONFLICT'],
  ['40P01', 'PLATFORM_RECOVERY_IN_PROGRESS'],
  ['55000', 'TERMINAL_STATE_IMMUTABLE']
]);
let domainExpressions = 0;
let sqlMarkers = 0;

async function filesBelow(directory, extensions) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['dist', 'node_modules'].includes(entry.name) || entry.name.startsWith('._')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(path, extensions));
    else if (extensions.has(extname(entry.name))) output.push(path);
  }
  return output;
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function literalCodes(node) {
  if (!node) return [];
  if (node.type === 'StringLiteral') return [node.value];
  if (node.type === 'ConditionalExpression') return [...literalCodes(node.consequent), ...literalCodes(node.alternate)];
  if (['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node.type)) return literalCodes(node.expression);
  return [];
}

function scanSql(text, location) {
  for (const match of text.matchAll(/RAISE\s+EXCEPTION\s+'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'([^;]*);/gu)) {
    const marker = match[1];
    if (recordsByCode.has(marker)) {
      consumers.get(marker).push(location);
      sqlMarkers += 1;
      continue;
    }
    const state = /ERRCODE\s*=\s*'([0-9A-Z]{5})'/u.exec(match[2])?.[1];
    const projected = state ? sqlStateProjection.get(state) : null;
    if (!projected) failures.push(`${location}: unregistered SQL error ${marker} without a canonical SQLSTATE projection`);
    else {
      consumers.get(projected).push(`${location}:SQLSTATE:${state}`);
      sqlMarkers += 1;
    }
  }
}

function walk(node, source, repositoryPath) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'NewExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'DomainError') {
    domainExpressions += 1;
    const codes = literalCodes(node.arguments?.[0]);
    const location = `${repositoryPath}:${lineOf(source, node.start ?? 0)}`;
    if (codes.length === 0) failures.push(`${location}: DomainError code is not a statically enumerable ErrorCode`);
    for (const code of codes) {
      if (!recordsByCode.has(code)) failures.push(`${location}: unregistered DomainError code ${code}`);
      else consumers.get(code).push(location);
    }
  }
  if (node.type === 'StringLiteral' && node.value.includes('RAISE EXCEPTION')) scanSql(node.value, `${repositoryPath}:${lineOf(source, node.start ?? 0)}`);
  if (node.type === 'TemplateElement' && node.value?.cooked?.includes('RAISE EXCEPTION')) scanSql(node.value.cooked, `${repositoryPath}:${lineOf(source, node.start ?? 0)}`);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'errors', 'comments'].includes(key)) continue;
    if (Array.isArray(value)) for (const child of value) walk(child, source, repositoryPath);
    else if (value && typeof value === 'object' && typeof value.type === 'string') walk(value, source, repositoryPath);
  }
}

for (const path of [...await filesBelow(join(root, 'packages'), new Set(['.ts', '.tsx'])), ...await filesBelow(join(root, 'apps'), new Set(['.ts', '.tsx']))]) {
  const source = await readFile(path, 'utf8');
  const repositoryPath = relative(root, path);
  let ast;
  try { ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: false }); }
  catch (error) { failures.push(`${repositoryPath}: AST parse failed: ${error.message}`); continue; }
  walk(ast, source, repositoryPath);
}

for (const path of await filesBelow(join(root, 'database'), new Set(['.sql']))) {
  scanSql(await readFile(path, 'utf8'), relative(root, path));
}

for (const record of records) {
  if ((consumers.get(record.code)?.length ?? 0) > 0) continue;
  if (record.extensions?.reservation?.kind !== 'SSOT_STABLE_WIRE_COMPATIBILITY') failures.push(`registry:${record.code}: no consumer and no explicit SSOT reservation`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  console.error(`Error code verification FAIL unknown=${failures.length}`);
  process.exit(1);
}
console.log(`Error code verification PASS registered=${records.length} domainExpressions=${domainExpressions} sqlMarkers=${sqlMarkers} unknown=0 conflicts=0`);
