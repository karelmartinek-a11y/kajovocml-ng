from pathlib import Path

path = Path('packages/domain/src/exact-operation-handlers.ts')
text = path.read_text(encoding='utf-8')
start = text.index('async function handleProvenanceContentRegister(')
end = text.index('async function handleRuntimeCancel(', start)
replacement = r'''function provenanceAuthorityForSource(sourceKind: string, contentRole: string, parentAuthority: string | null, hasSourceObject: boolean, hasSourceRevision: boolean): string {
  if (contentRole !== 'INSTRUCTION') return 'NONE';
  if (parentAuthority && parentAuthority !== 'NONE') {
    if (['DERIVED', 'NORMALIZED', 'EXTRACTED', 'TRANSFORMED', 'COMPILED'].includes(sourceKind)) return parentAuthority;
    return 'NONE';
  }
  switch (sourceKind) {
    case 'OWNER_MESSAGE': return hasSourceObject ? 'OWNER_DIRECT' : 'NONE';
    case 'OWNER_APPROVED_SPECIFICATION': return hasSourceObject ? 'OWNER_APPROVED_SPECIFICATION' : 'NONE';
    case 'OWNER_DELEGATED_SOURCE': return hasSourceObject || hasSourceRevision ? 'OWNER_DELEGATED_SOURCE' : 'NONE';
    case 'ACTIVE_AGENT_REVISION':
    case 'ACTIVE_AUTOMATION_REVISION':
    case 'ACTIVE_COMPONENT_REVISION':
    case 'ACTIVE_REVISION': return hasSourceRevision ? 'ACTIVE_REVISION' : 'NONE';
    case 'PLATFORM_RUNTIME':
    case 'PLATFORM_RUNTIME_POLICY': return 'PLATFORM_RUNTIME';
    default: return 'NONE';
  }
}

function byteaEquals(left: unknown, right: Buffer): boolean {
  return Buffer.isBuffer(left) && left.length === right.length && left.equals(right);
}

function jsonPointerRead(value: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return pointer === '' ? value : (value as Record<string, unknown> | null)?.[''] ?? undefined;
  if (!pointer.startsWith('/')) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'sourceLocator.jsonPointer must use RFC 6901 syntax', 422, 'DO_NOT_RETRY');
  let current: unknown = value;
  for (const token of pointer.slice(1).split('/').map((part) => part.replace(/~1/gu, '/').replace(/~0/gu, '~'))) {
    if (Array.isArray(current)) {
      if (!/^\d+$/u.test(token)) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'JSON pointer array token is not an index', 422, 'DO_NOT_RETRY');
      current = current[Number(token)];
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    } else {
      current = undefined;
    }
    if (current === undefined) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'sourceLocator does not resolve inside the authoritative source', 422, 'DO_NOT_RETRY', { pointer });
  }
  return current;
}

function applyValueTransform(source: unknown, transform: string): unknown {
  switch (transform) {
    case 'IDENTITY': return source;
    case 'STRING': return typeof source === 'string' ? source : canonicalJson(json(source));
    case 'INTEGER': {
      const value = Number(source);
      if (!Number.isSafeInteger(value)) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'Derived value is not a safe integer', 422, 'DO_NOT_RETRY');
      return value;
    }
    case 'NUMBER': {
      const value = Number(source);
      if (!Number.isFinite(value)) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'Derived value is not a finite number', 422, 'DO_NOT_RETRY');
      return value;
    }
    case 'BOOLEAN': {
      if (source === true || source === false) return source;
      if (source === 'true') return true;
      if (source === 'false') return false;
      throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'Derived value is not a canonical boolean', 422, 'DO_NOT_RETRY');
    }
    case 'JSON_PARSE': {
      if (typeof source !== 'string') throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'JSON_PARSE requires a UTF-8 string source', 422, 'DO_NOT_RETRY');
      try { return JSON.parse(source) as unknown; } catch { throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'Authoritative source is not valid JSON', 422, 'DO_NOT_RETRY'); }
    }
    case 'JSON_STRINGIFY': return canonicalJson(json(source));
    case 'URI_COMPONENT_DECODE': {
      if (typeof source !== 'string') throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'URI_COMPONENT_DECODE requires a string source', 422, 'DO_NOT_RETRY');
      try { return decodeURIComponent(source); } catch { throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'Source contains invalid URI escaping', 422, 'DO_NOT_RETRY'); }
    }
    default: throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', `Unsupported deterministic value transform ${transform}`, 422, 'DO_NOT_RETRY');
  }
}

function normalizeDerivedValue(value: unknown, normalizer: string): unknown {
  if (normalizer === 'NONE') return value;
  if (typeof value !== 'string') throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${normalizer} normalizer requires a string value`, 422, 'DO_NOT_RETRY');
  switch (normalizer) {
    case 'TRIM': return value.trim();
    case 'LOWERCASE': return value.toLocaleLowerCase('en-US');
    case 'UPPERCASE': return value.toLocaleUpperCase('en-US');
    case 'NFC': return value.normalize('NFC');
    case 'NFKC': return value.normalize('NFKC');
    case 'CASEFOLD': return value.normalize('NFKC').toLocaleLowerCase('en-US');
    default: throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', `Unsupported deterministic value normalizer ${normalizer}`, 422, 'DO_NOT_RETRY');
  }
}

function validateDerivedValue(value: unknown, schema: JsonObject, constraints: JsonObject): JsonObject {
  const failures: string[] = [];
  const type = typeof schema.type === 'string' ? schema.type : null;
  if (type) {
    const matches = type === 'array' ? Array.isArray(value)
      : type === 'null' ? value === null
      : type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value)
      : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : typeof value === type;
    if (!matches) failures.push(`type:${type}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => byteaEquals(digest(candidate), digest(value)))) failures.push('enum');
  if (typeof value === 'string') {
    const minLength = Number(schema.minLength ?? constraints.minLength ?? 0);
    const maxLength = Number(schema.maxLength ?? constraints.maxLength ?? Number.MAX_SAFE_INTEGER);
    if (Number.isFinite(minLength) && value.length < minLength) failures.push('minLength');
    if (Number.isFinite(maxLength) && value.length > maxLength) failures.push('maxLength');
    const pattern = schema.pattern ?? constraints.pattern;
    if (typeof pattern === 'string') {
      if (pattern.length > 512) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'Validation pattern exceeds 512 characters', 422, 'DO_NOT_RETRY');
      let regex: RegExp;
      try { regex = new RegExp(pattern, 'u'); } catch { throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'Validation pattern is invalid', 422, 'DO_NOT_RETRY'); }
      if (!regex.test(value)) failures.push('pattern');
    }
    if (schema.format === 'uuid' && !UUID.test(value)) failures.push('format:uuid');
    if (schema.format === 'uri') {
      try { new URL(value); } catch { failures.push('format:uri'); }
    }
  }
  if (typeof value === 'number') {
    const minimum = Number(schema.minimum ?? constraints.minimum ?? Number.NEGATIVE_INFINITY);
    const maximum = Number(schema.maximum ?? constraints.maximum ?? Number.POSITIVE_INFINITY);
    if (value < minimum) failures.push('minimum');
    if (value > maximum) failures.push('maximum');
  }
  const allowedValues = constraints.allowedValues;
  if (Array.isArray(allowedValues) && !allowedValues.some((candidate) => byteaEquals(digest(candidate), digest(value)))) failures.push('allowedValues');
  return { valid: failures.length === 0, failures, validator: 'SERVER_DETERMINISTIC_V1' };
}

async function handleProvenanceContentRegister(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const raw = context.arguments.rawBytes;
  const sourceKind = textArg(context, 'sourceKind');
  const contentRole = textArg(context, 'contentRole');
  const sourceObjectId = context.arguments.sourceObjectId ?? null;
  const sourceRevisionId = context.arguments.sourceRevisionId ?? null;
  const parentContentId = context.arguments.parentContentId ?? null;
  const rawDigest = digestArgument(context, 'rawDigest', raw ?? {});
  const contentDigest = digestArgument(context, 'contentDigest', raw ?? {});
  if (Buffer.isBuffer(raw) && !byteaEquals(digest(raw), rawDigest)) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'rawDigest does not match the supplied raw bytes', 422, 'DO_NOT_RETRY');

  let parentAuthority: string | null = null;
  if (parentContentId !== null) {
    const parent = row((await client.query(`SELECT id,content_role,instruction_authority FROM kcml.content_provenance WHERE id=$1 FOR SHARE`, [uuidArg(context, 'parentContentId')])).rows as Row[], 'CONTENT_PROVENANCE_NOT_FOUND', 'Parent content provenance does not exist');
    parentAuthority = parent.content_role === 'INSTRUCTION' ? String(parent.instruction_authority) : 'NONE';
  }

  let authority = provenanceAuthorityForSource(sourceKind, contentRole, parentAuthority, typeof sourceObjectId === 'string', typeof sourceRevisionId === 'string');
  if (authority === 'OWNER_DIRECT') {
    const ownerMessage = (await client.query(`SELECT id,content FROM kcml.system_chat_message WHERE id=$1 AND role='OWNER'`, [sourceObjectId])).rows[0] as Row | undefined;
    if (!ownerMessage) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'OWNER_DIRECT provenance must be rooted in a persisted OWNER message', 422, 'DO_NOT_RETRY');
    if (Buffer.isBuffer(raw) && !byteaEquals(digest(String(ownerMessage.content)), contentDigest)) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'OWNER_DIRECT content digest does not match the authoritative OWNER message', 422, 'DO_NOT_RETRY');
  }
  const claimedAuthority = context.arguments.instructionAuthority;
  if (claimedAuthority !== undefined && claimedAuthority !== authority) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'Caller-supplied instruction authority does not match server-derived provenance authority', 422, 'DO_NOT_RETRY', { claimedAuthority, derivedAuthority: authority });

  const provenance = row((await client.query(`INSERT INTO kcml.content_provenance(id,parent_content_id,source_kind,source_object_id,source_revision_id,source_locator,observed_at,raw_bytes,artifact_reference,raw_digest,content_digest,mime_type,schema_id,content_role,instruction_authority,taint_flags,provenance_flags,extraction_method,normalization_method,transform_chain,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`, [
    id, parentContentId, sourceKind, sourceObjectId, sourceRevisionId, objectArg(context, 'sourceLocator'), Buffer.isBuffer(raw) ? raw : null, objectArg(context, 'artifactReference'), rawDigest, contentDigest, context.arguments.mimeType ?? null, context.arguments.schemaId ?? null, contentRole, authority, listArg(context, 'taintFlags'), listArg(context, 'provenanceFlags'), textArg(context, 'extractionMethod'), textArg(context, 'normalizationMethod'), objectArg(context, 'transformChain'), digest({ id, rawDigest: rawDigest.toString('hex'), contentDigest: contentDigest.toString('hex'), authority }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'PROVENANCE_CONTENT_NOT_CREATED', 'Content provenance was not persisted');
  await recordAudit(client, context, 'CONTENT_PROVENANCE', id, { contentProvenanceId: id, instructionAuthority: authority });
  return result(context, 'content_provenance', provenance, provenance.state_version, { contentProvenanceId: id, instructionAuthority: authority });
}

async function handleProvenanceSegmentCompile(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const sourceProvenanceId = uuidArg(context, 'sourceProvenanceId');
  const source = row((await client.query(`SELECT * FROM kcml.content_provenance WHERE id=$1 FOR SHARE`, [sourceProvenanceId])).rows as Row[], 'CONTENT_PROVENANCE_NOT_FOUND', 'Source content provenance does not exist');
  if (source.content_role !== 'INSTRUCTION' || source.instruction_authority === 'NONE') throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'External data or non-instruction provenance cannot be compiled into an instruction segment', 422, 'DO_NOT_RETRY');
  const authority = String(source.instruction_authority);
  if (context.arguments.instructionAuthority !== undefined && context.arguments.instructionAuthority !== authority) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'Instruction segment authority must equal its stored source provenance authority', 422, 'DO_NOT_RETRY', { claimedAuthority: context.arguments.instructionAuthority, sourceAuthority: authority });
  const rendered = textArg(context, 'renderedText', textArg(context, 'content', ''));
  if (authority === 'OWNER_DIRECT' && Buffer.isBuffer(source.raw_bytes) && !byteaEquals(digest(rendered), source.content_digest as Buffer)) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'OWNER_DIRECT instruction bytes differ from the authoritative OWNER content', 422, 'DO_NOT_RETRY');
  const segment = row((await client.query(`INSERT INTO kcml.instruction_segment(id,model_call_id,request_descriptor_id,segment_sequence,source_provenance_id,role,instruction_authority,destination,rendered_bytes,rendered_digest,compiler_version,segment_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`, [
    id, context.arguments.modelCallId ?? null, uuidArg(context, 'requestDescriptorId'), numberArg(context, 'segmentSequence'), sourceProvenanceId, textArg(context, 'role', 'user'), authority, textArg(context, 'destination', 'INPUT'), Buffer.from(rendered, 'utf8'), digest(rendered), textArg(context, 'compilerVersion', 'td12'), digest({ sourceProvenanceId, authority, rendered }), digest({ id, sourceProvenanceId, authority, rendered }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'PROVENANCE_SEGMENT_NOT_CREATED', 'Instruction segment was not persisted');
  await recordAudit(client, context, 'INSTRUCTION_SEGMENT', id, { instructionSegmentId: id, sourceProvenanceId, instructionAuthority: authority, segmentSequence: segment.segment_sequence });
  return result(context, 'instruction_segment', segment, segment.state_version, { instructionSegmentId: id, instructionAuthority: authority });
}

async function handleProvenanceValueDerivationCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const operationContextId = uuidArg(context, 'operationContextId');
  const sourceContentProvenanceId = uuidArg(context, 'sourceContentProvenanceId');
  const destinationPath = textArg(context, 'destinationPath');
  if (!destinationPath.startsWith('$')) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'destinationPath must be an absolute canonical path', 422, 'DO_NOT_RETRY');
  const source = row((await client.query(`SELECT * FROM kcml.content_provenance WHERE id=$1 FOR SHARE`, [sourceContentProvenanceId])).rows as Row[], 'CONTENT_PROVENANCE_NOT_FOUND', 'Source content provenance does not exist');
  row((await client.query(`SELECT id FROM kcml.operation_context WHERE id=$1 FOR SHARE`, [operationContextId])).rows as Row[], 'OPERATION_CONTEXT_NOT_FOUND', 'Operation context does not exist');
  if (!Buffer.isBuffer(source.content_digest)) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'Source provenance has no authoritative content digest', 409, 'DO_NOT_RETRY');
  const suppliedSourceDigest = digestArgument(context, 'sourceDigest');
  if (!byteaEquals(source.content_digest, suppliedSourceDigest)) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'sourceDigest does not match authoritative content provenance', 409, 'DO_NOT_RETRY');
  if (!Buffer.isBuffer(source.raw_bytes)) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'Authoritative source bytes are unavailable for server-side derivation', 409, 'DO_NOT_RETRY');

  const locator = objectArg(context, 'sourceLocator');
  let sourceValue: unknown = source.raw_bytes.toString('utf8');
  if (typeof locator.jsonPointer === 'string') {
    let parsed: unknown;
    try { parsed = JSON.parse(sourceValue as string) as unknown; } catch { throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'JSON pointer source is not valid JSON', 422, 'DO_NOT_RETRY'); }
    sourceValue = jsonPointerRead(parsed, locator.jsonPointer);
  } else if (locator.byteRange && typeof locator.byteRange === 'object' && !Array.isArray(locator.byteRange)) {
    const range = locator.byteRange as Record<string, unknown>;
    const start = Number(range.start);
    const end = Number(range.end);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > source.raw_bytes.length) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'sourceLocator.byteRange is outside authoritative source bytes', 422, 'DO_NOT_RETRY');
    sourceValue = source.raw_bytes.subarray(start, end).toString('utf8');
  }

  const transform = textArg(context, 'transform', 'IDENTITY');
  const normalizer = textArg(context, 'normalizer', 'NONE');
  const transformVersion = textArg(context, 'transformVersion', '1');
  if (transformVersion !== '1') throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', 'Only deterministic transform version 1 is supported', 422, 'DO_NOT_RETRY');
  const value = normalizeDerivedValue(applyValueTransform(sourceValue, transform), normalizer);
  if (context.arguments.canonicalValue !== undefined && !byteaEquals(digest(context.arguments.canonicalValue), digest(value))) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'Caller-supplied canonicalValue differs from the server-derived value', 422, 'DO_NOT_RETRY');
  const schema = objectArg(context, 'valueSchema');
  const constraints = objectArg(context, 'constraints');
  const validationEvidence = validateDerivedValue(value, schema, constraints);
  if (validationEvidence.valid !== true) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'Server-derived value does not satisfy its schema or constraints', 422, 'DO_NOT_RETRY', { failures: validationEvidence.failures });

  if (context.arguments.semanticActionPlanId !== undefined && context.arguments.semanticActionPlanId !== null) {
    const plan = row((await client.query(`SELECT id,operation_context_id FROM kcml.semantic_action_plan WHERE id=$1 FOR SHARE`, [uuidArg(context, 'semanticActionPlanId')])).rows as Row[], 'SEMANTIC_ACTION_PLAN_NOT_FOUND', 'Semantic action plan does not exist');
    if (String(plan.operation_context_id) !== operationContextId) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'Value derivation action plan belongs to a different operation context', 409, 'DO_NOT_RETRY');
  }

  const derivation = row((await client.query(`INSERT INTO kcml.value_derivation(id,operation_context_id,semantic_action_plan_id,destination_path,source_content_provenance_id,source_locator,source_digest,transform,normalizer,value_schema,constraints,transform_version,canonical_value,value_digest,validation_evidence,requirement_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`, [
    id, operationContextId, context.arguments.semanticActionPlanId ?? null, destinationPath, sourceContentProvenanceId, locator, source.content_digest, transform, normalizer, schema, constraints, transformVersion, value, digest(value), validationEvidence, textArg(context, 'requirementId'), digest({ id, operationContextId, destinationPath, sourceContentProvenanceId, sourceDigest: (source.content_digest as Buffer).toString('hex'), transform, normalizer, transformVersion, value }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'PROVENANCE_DERIVATION_NOT_CREATED', 'Value derivation was not persisted');
  await recordAudit(client, context, 'VALUE_DERIVATION', id, { valueDerivationId: id, destinationPath, sourceContentProvenanceId, transform, normalizer, validationEvidence });
  return result(context, 'value_derivation', derivation, derivation.state_version, { valueDerivationId: id, validationEvidence });
}

'''
text = text[:start] + replacement + text[end:]
path.write_text(text, encoding='utf-8')
print('batch3 provenance remediation applied')
