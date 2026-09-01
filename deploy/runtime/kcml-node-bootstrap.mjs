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
 * KCML-REQ-RUNTIME-321b40ee21af05286246bd355e173646751caf68855f0d516cbce8d3258c562d.
 */

import { fstatSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_ENVIRONMENT = new Set([
  'LANG',
  'LC_ALL',
  'TZ',
  'NODE_ENV',
  'HOME',
  'TMPDIR',
  'PATH',
  'UV_USE_IO_URING',
  'KCML_CONTEXT_FD',
  'KCML_CONTEXT_FD_CLOEXEC',
  'KCML_EXECUTION_ID'
]);
const FORBIDDEN_ENVIRONMENT = /^(?:NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|PYTHONPATH|RUSTFLAGS|KCML_OWNER_API_KEY|DATABASE_URL|PG(?:HOST|PORT|USER|PASSWORD|DATABASE)|.*(?:SECRET|TOKEN|CREDENTIAL|BROKER|GATEWAY).*)$/u;

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
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    NODE_ENV: 'production',
    HOME: '/work/home',
    TMPDIR: '/tmp',
    PATH: '/runtime/bin',
    UV_USE_IO_URING: '0',
    KCML_CONTEXT_FD: '3',
    KCML_CONTEXT_FD_CLOEXEC: 'BOOTSTRAP_REQUIRED'
  };
  for (const [name, value] of Object.entries(expected)) if (process.env[name] !== value) fail(`ENVIRONMENT_VALUE_INVALID:${name}`);
  if (process.env.KCML_EXECUTION_ID !== undefined && !/^[0-9a-f-]{36}$/iu.test(process.env.KCML_EXECUTION_ID)) fail('EXECUTION_ID_INVALID');
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
  // FD_CLOEXEC is staged by the launcher for this first exec and becomes
  // mandatory at the bootstrap boundary. Node's child-process APIs never
  // inherit unlisted descriptors; no generated module receives fd 3.
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
  return { entrypoint, handlerArgs: args.slice(3) };
}

async function main() {
  assertEnvironment();
  assertCapabilityFd();
  setCapabilityCloseOnExec();
  const { entrypoint, handlerArgs } = parseEntrypoint();
  process.chdir('/work');
  process.argv = [process.argv[0], entrypoint, ...handlerArgs];
  await import(pathToFileURL(entrypoint).href);
}

await main().catch((error) => {
  console.error(`kcml-node-bootstrap: HANDLER_IMPORT_FAILED:${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 70;
});
