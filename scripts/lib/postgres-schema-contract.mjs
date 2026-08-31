import { createHash } from 'node:crypto';

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function scanBalanced(source, openAt) {
  let depth = 0;
  let quote = null;
  for (let index = openAt; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`UNBALANCED_SQL_AT:${openAt}`);
}

function splitTopLevel(source) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function canonicalType(definition) {
  const normalized = definition.trim().toLowerCase().replace(/\s+/gu, ' ');
  const candidates = [
    [/^timestamp with time zone\b/u, 'timestamp with time zone'],
    [/^timestamp without time zone\b/u, 'timestamp without time zone'],
    [/^double precision\b/u, 'double precision'],
    [/^character varying(?:\(\d+\))?/u, (match) => match[0]],
    [/^varchar(?:\(\d+\))?/u, (match) => match[0].replace(/^varchar/u, 'character varying')],
    [/^numeric(?:\(\d+(?:,\d+)?\))?/u, (match) => match[0]],
    [/^timestamptz\b/u, 'timestamp with time zone'],
    [/^(?:text|uuid|bigint|integer|smallint|boolean|bytea|jsonb|json|inet|citext|date|time|interval|real)(?:\[\])?/u, (match) => match[0]],
    [/^int8\b/u, 'bigint'],
    [/^int4\b/u, 'integer'],
    [/^int2\b/u, 'smallint'],
    [/^bool\b/u, 'boolean']
  ];
  for (const [pattern, replacement] of candidates) {
    const match = pattern.exec(normalized);
    if (match) return typeof replacement === 'function' ? replacement(match) : replacement;
  }
  throw new Error(`UNSUPPORTED_POSTGRES_COLUMN_TYPE:${definition}`);
}

function parseColumn(item) {
  if (/^(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE)\b/iu.test(item)) return null;
  const match = /^(?:"([a-z][a-z0-9_]*)"|([a-z][a-z0-9_]*))\s+([\s\S]+)$/iu.exec(item);
  if (!match) throw new Error(`UNPARSEABLE_POSTGRES_COLUMN:${item}`);
  const definition = match[3].trim();
  return {
    name: match[1] ?? match[2],
    dataType: canonicalType(definition),
    notNull: /\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b/iu.test(definition),
    hasDefault: /\bDEFAULT\b/iu.test(definition),
    references: /\bREFERENCES\s+(?:kcml\.)?"?([a-z][a-z0-9_]*)"?\s*\(\s*"?([a-z][a-z0-9_]*)"?\s*\)/iu.exec(definition)?.slice(1) ?? null
  };
}

export function compilePostgresSchemaContracts(sql, entities) {
  const entityByName = new Map(entities.map((entity) => [entity.name, entity]));
  const records = new Map();
  const tablePattern = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:kcml\.)?"?([a-z][a-z0-9_]*)"?\s*\(/giu;
  for (const match of sql.matchAll(tablePattern)) {
    const tableName = match[1];
    const entity = entityByName.get(tableName);
    if (!entity) continue;
    const openAt = match.index + match[0].lastIndexOf('(');
    const closeAt = scanBalanced(sql, openAt);
    const columns = splitTopLevel(sql.slice(openAt + 1, closeAt)).map(parseColumn).filter(Boolean);
    if (new Set(columns.map((column) => column.name)).size !== columns.length) throw new Error(`DUPLICATE_SCHEMA_CONTRACT_COLUMN:${tableName}`);
    records.set(tableName, {
      tableName,
      ssotEntityOrdinal: entity.ordinal,
      ssotContractDigest: `sha256:${entity.contractDigest}`,
      immutable: entity.immutable,
      columns,
      indexes: [],
      constraints: [],
      commentContractDigest: `sha256:${entity.contractDigest}`
    });
  }

  const indexPattern = /CREATE\s+(UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([a-z][a-z0-9_]*)"?\s+ON\s+(?:kcml\.)?"?([a-z][a-z0-9_]*)"?/giu;
  for (const match of sql.matchAll(indexPattern)) {
    const record = records.get(match[3]);
    if (record) record.indexes.push({ name: match[2], unique: Boolean(match[1]) });
  }

  const alterConstraintPattern = /ALTER\s+TABLE\s+(?:kcml\.)?"?([a-z][a-z0-9_]*)"?[^;]*?ADD\s+CONSTRAINT\s+"?([a-z][a-z0-9_]*)"?\s+([^;]+);/giu;
  for (const match of sql.matchAll(alterConstraintPattern)) {
    const record = records.get(match[1]);
    if (!record) continue;
    const definition = match[3].trim().replace(/\s+/gu, ' ');
    record.constraints.push({ name: match[2], kind: /^FOREIGN\s+KEY\b/iu.test(definition) ? 'FOREIGN_KEY' : /^CHECK\b/iu.test(definition) ? 'CHECK' : /^UNIQUE\b/iu.test(definition) ? 'UNIQUE' : 'OTHER' });
  }

  const setNotNullPattern = /ALTER\s+TABLE\s+(?:kcml\.)?"?([a-z][a-z0-9_]*)"?\s+ALTER\s+COLUMN\s+"?([a-z][a-z0-9_]*)"?\s+SET\s+NOT\s+NULL\s*;/giu;
  for (const match of sql.matchAll(setNotNullPattern)) {
    const column = records.get(match[1])?.columns.find((candidate) => candidate.name === match[2]);
    if (!column) throw new Error(`ALTERED_SCHEMA_CONTRACT_COLUMN_MISSING:${match[1]}.${match[2]}`);
    column.notNull = true;
  }

  for (const record of records.values()) {
    record.columns.sort((left, right) => left.name.localeCompare(right.name));
    record.indexes.sort((left, right) => left.name.localeCompare(right.name));
    record.constraints.sort((left, right) => left.name.localeCompare(right.name));
    record.canonicalDigest = sha256(canonical(record));
  }
  const output = [...records.values()].sort((left, right) => left.ssotEntityOrdinal - right.ssotEntityOrdinal);
  const missing = entities.filter((entity) => !records.has(entity.name)).map((entity) => entity.name);
  if (missing.length) throw new Error(`POSTGRES_SCHEMA_CONTRACT_TABLES_MISSING:${missing.join(',')}`);
  return output;
}
