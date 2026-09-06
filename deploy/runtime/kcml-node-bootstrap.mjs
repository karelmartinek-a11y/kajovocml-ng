/*
 * Trusted Node.js 24 bootstrap for generated handlers.
 *
 * The C launcher has already performed namespace, mount, FD, identity,
 * capability and seccomp setup. This file is the last trusted code before a
 * generated module is imported; it intentionally has no dynamic module
 * resolution, secret loading or network setup.
 *
 * Traceability: KCML-REQ-RUNTIME-9b9b39e3819dbe737df54e9ee052d0af1ab56d7c3320e03dc0cee777262d7a60,
 * KCML-REQ-RUNTIME-2e05853970fa83ad9006d03338413a61660f196ba1e79dd1a20c6181898d3f90,
 * KCML-REQ-RUNTIME-321b40ee21af05286246bd355e173646751caf68855f0d516cbce8d3258c562d,
 * KCML-REQ-RUNTIME-570451223c7a193f435310a19277521d92745091538e309ffd02edb0121d237c,
 * KCML-REQ-RUNTIME-e72ce9a3c678f40b689ebb0c1aa916cf4fcf2ba99f84d92370edca5d02b6804c.
 */

import { createHash } from 'node:crypto';
import { fstatSync, lstatSync, realpathSync } from 'node:fs';
import { Socket } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_ENVIRONMENT = new Set([
  'LANG','LC_ALL','TZ','NODE_ENV','HOME','TMPDIR','PATH','UV_USE_IO_URING',
  'KCML_CONTEXT_FD','KCML_CONTEXT_FD_CLOEXEC','KCML_EXECUTION_ID'
]);
const FORBIDDEN_ENVIRONMENT = /^(?:NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|PYTHONPATH|RUSTFLAGS|KCML_OWNER_API_KEY|DATABASE_URL|PG(?:HOST|PORT|USER|PASSWORD|DATABASE)|.*(?:SECRET|TOKEN|CREDENTIAL|BROKER|GATEWAY).*)$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const KCR1 = Buffer.from('KCR1','ascii');
const HEADER_BYTES = 16;
const FRAME = Object.freeze({ HELLO:1, READY:2, REQUEST:3, RESPONSE:4, ERROR:5, STREAM_OPEN:6, STREAM_CHUNK:7, STREAM_CREDIT:8, STREAM_END:9, CANCEL:10, SHUTDOWN:11, HEARTBEAT:12 });
const PROTOCOL = 'KCML-RUNTIME-IPC/1';

function fail(code) {
  console.error(`kcml-node-bootstrap: ${code}`);
  process.exit(70);
}

function assertEnvironment() {
  if (Number(process.versions.node.split('.')[0]) !== 24) fail('NODE_RUNTIME_VERSION_UNSUPPORTED');
  for (const name of Object.keys(process.env)) {
    if (FORBIDDEN_ENVIRONMENT.test(name) || !REQUIRED_ENVIRONMENT.has(name)) fail(`ENVIRONMENT_NOT_ALLOWLISTED:${name}`);
  }
  const expected = {
    LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC',NODE_ENV:'production',HOME:'/work/home',TMPDIR:'/tmp',PATH:'/runtime/bin',UV_USE_IO_URING:'0',KCML_CONTEXT_FD:'3',KCML_CONTEXT_FD_CLOEXEC:'BOOTSTRAP_REQUIRED'
  };
  for (const [name,value] of Object.entries(expected)) if (process.env[name] !== value) fail(`ENVIRONMENT_VALUE_INVALID:${name}`);
  if (process.env.KCML_EXECUTION_ID !== undefined && !UUID.test(process.env.KCML_EXECUTION_ID.toLowerCase())) fail('EXECUTION_ID_INVALID');
}

function assertCapabilityFd() {
  const fd = Number(process.env.KCML_CONTEXT_FD);
  if (!Number.isInteger(fd) || fd !== 3) fail('CAPABILITY_FD_INVALID');
  try {
    const descriptor = fstatSync(fd);
    if (!descriptor.isSocket()) fail('CAPABILITY_FD_NOT_SOCKET');
  } catch {
    fail('CAPABILITY_FD_UNAVAILABLE');
  }
  if (process.env.KCML_CONTEXT_FD_CLOEXEC !== 'BOOTSTRAP_REQUIRED') fail('CAPABILITY_FD_CLOEXEC_NOT_ENFORCED');
}

function setCapabilityCloseOnExec() {
  try {
    const addon = { exports: {} };
    process.dlopen(addon, fileURLToPath(new URL('./kcml-fd-cloexec.node', import.meta.url)));
  } catch {
    fail('CAPABILITY_FD_CLOEXEC_FAILED');
  }
}

function parseEntrypoint() {
  const args = process.argv.slice(2);
  if (args[0] !== '--entrypoint' || args[1] === undefined || args[2] !== '--') fail('BOOTSTRAP_ARGUMENTS_INVALID');
  if (args.slice(3).some((arg) => arg === '--require' || arg === '--loader' || arg.startsWith('--import'))) fail('NODE_INJECTION_ARGUMENT');
  const entrypoint = realpathSync(args[1]);
  if (!entrypoint.startsWith('/runtime/') || entrypoint.includes('/../')) fail('HANDLER_PATH_ESCAPE');
  const status = lstatSync(entrypoint);
  if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1 || (status.mode & 0o6000) !== 0) fail('HANDLER_FILE_CONTRACT_INVALID');
  const handlerArgs = args.slice(3);
  if (handlerArgs[0] !== '--kcml-handshake' || handlerArgs[1] === undefined) fail('RUNTIME_HANDSHAKE_ARGUMENT_REQUIRED');
  let handshake;
  try { handshake = JSON.parse(Buffer.from(handlerArgs[1], 'base64url').toString('utf8')); }
  catch { fail('RUNTIME_HANDSHAKE_ARGUMENT_INVALID'); }
  const required = ['runtimeInstanceId','runtimeGeneration','runtimeDigest','exportDigest','inputSchemaDigest','outputSchemaDigest'];
  if (handshake?.protocol !== PROTOCOL || !UUID.test(String(handshake?.runtimeInstanceId ?? '').toLowerCase()) || !/^[1-9][0-9]*$/u.test(String(handshake?.runtimeGeneration ?? '')) || required.slice(2).some((key) => !DIGEST.test(String(handshake?.[key] ?? '')))) fail('RUNTIME_HANDSHAKE_ARGUMENT_INVALID');
  return { entrypoint, handlerArgs: handlerArgs.slice(2), handshake };
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('HANDLER_SCHEMA_NOT_CANONICAL');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object') fail('HANDLER_SCHEMA_NOT_CANONICAL');
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function canonicalJson(value) { return JSON.stringify(canonical(value)); }
function digest(value) { return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`; }

function actualHandlerContract(module) {
  if (typeof module.invoke !== 'function' || !Array.isArray(module.tools) || module.tools.length > 512) fail('HANDLER_EXPORT_CONTRACT_INVALID');
  const tools = module.tools.map((tool) => {
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string' || !TOOL_NAME.test(tool.name) || !tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema) || !tool.outputSchema || typeof tool.outputSchema !== 'object' || Array.isArray(tool.outputSchema)) fail('HANDLER_TOOL_CONTRACT_INVALID');
    return { name: tool.name, inputSchema: canonical(tool.inputSchema), outputSchema: canonical(tool.outputSchema) };
  }).sort((left,right) => left.name.localeCompare(right.name));
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) fail('HANDLER_TOOL_DUPLICATE');
  return {
    exportDigest: digest({ invoke:true, tools:tools.map((tool) => tool.name) }),
    inputSchemaDigest: digest(tools.map((tool) => ({ name:tool.name, schema:tool.inputSchema }))),
    outputSchemaDigest: digest(tools.map((tool) => ({ name:tool.name, schema:tool.outputSchema }))),
  };
}

function encodeFrame(frameType, sequence, payload) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 0xffffffff || !FRAME[frameType]) fail('RUNTIME_PROTOCOL_SEQUENCE_INVALID');
  const body = Buffer.from(canonicalJson(payload), 'utf8');
  if (body.length > 1024 * 1024) fail('RUNTIME_PAYLOAD_TOO_LARGE');
  const header = Buffer.alloc(HEADER_BYTES);
  KCR1.copy(header,0); header.writeUInt8(1,4); header.writeUInt8(FRAME[frameType],5); header.writeUInt16BE(0,6); header.writeUInt32BE(body.length,8); header.writeUInt32BE(sequence,12);
  return Buffer.concat([header,body]);
}

function keepRuntimeChannel(socket) {
  let pending = Buffer.alloc(0);
  let expectedSequence = 1;
  let outboundSequence = 3;
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= HEADER_BYTES) {
      const header = pending.subarray(0,HEADER_BYTES);
      if (!header.subarray(0,4).equals(KCR1) || header.readUInt8(4) !== 1 || header.readUInt32BE(12) !== expectedSequence) fail('RUNTIME_PROTOCOL_INVALID_HEADER');
      const length = header.readUInt32BE(8);
      if (length > 1024 * 1024 || pending.length < HEADER_BYTES + length) return;
      const type = header.readUInt8(5);
      const payloadBytes = pending.subarray(HEADER_BYTES,HEADER_BYTES+length);
      pending = pending.subarray(HEADER_BYTES+length);
      expectedSequence += 1;
      let payload = {};
      try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { fail('RUNTIME_PROTOCOL_INVALID_JSON'); }
      if (type === FRAME.SHUTDOWN) {
        socket.write(encodeFrame('RESPONSE',outboundSequence++,{ requestId:payload?.requestId ?? null, status:'SHUTDOWN_ACK' }));
        socket.end();
        process.exitCode = 0;
        return;
      }
      if (type === FRAME.HEARTBEAT) continue;
      socket.write(encodeFrame('ERROR',outboundSequence++,{ requestId:payload?.requestId ?? null, error:'RUNTIME_REQUEST_DISPATCH_NOT_READY' }));
    }
  });
  socket.once('error', (error) => { console.error(`kcml-node-bootstrap: RUNTIME_CHANNEL_FAILED:${error.message}`); process.exitCode = 70; });
  socket.once('close', () => { if (process.exitCode === undefined) process.exitCode = 70; });
}

async function main() {
  assertEnvironment();
  assertCapabilityFd();
  setCapabilityCloseOnExec();
  const { entrypoint, handlerArgs, handshake } = parseEntrypoint();
  process.chdir('/work');
  process.argv = [process.argv[0], entrypoint, ...handlerArgs];
  const module = await import(pathToFileURL(entrypoint).href);
  const actual = actualHandlerContract(module);
  if (actual.exportDigest !== handshake.exportDigest || actual.inputSchemaDigest !== handshake.inputSchemaDigest || actual.outputSchemaDigest !== handshake.outputSchemaDigest) fail('RUNTIME_HANDLER_CONFORMANCE_MISMATCH');
  const socket = new Socket({ fd:3, readable:true, writable:true });
  const payload = {
    protocol:PROTOCOL,
    runtimeInstanceId:String(handshake.runtimeInstanceId).toLowerCase(),
    runtimeGeneration:String(handshake.runtimeGeneration),
    runtimeDigest:String(handshake.runtimeDigest),
    exportDigest:actual.exportDigest,
    inputSchemaDigest:actual.inputSchemaDigest,
    outputSchemaDigest:actual.outputSchemaDigest,
  };
  socket.write(encodeFrame('HELLO',1,payload));
  socket.write(encodeFrame('READY',2,{...payload,stage:'HANDLER_CONFORMANCE_VALIDATED'}));
  keepRuntimeChannel(socket);
}

await main().catch((error) => {
  console.error(`kcml-node-bootstrap: HANDLER_IMPORT_FAILED:${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 70;
});