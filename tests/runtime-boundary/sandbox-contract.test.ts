import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const launcherPath = new URL('../../deploy/runtime/kcml-sandbox-launcher.c', import.meta.url);
const bootstrapPath = new URL('../../deploy/runtime/kcml-node-bootstrap.mjs', import.meta.url);
const boundaryPath = new URL('../../packages/runtime-boundary/src/index.ts', import.meta.url);

describe('TD-19 runtime sandbox contract', () => {
  it('contains the native namespace, FD and mount linearization', async () => {
    const source = await readFile(launcherPath, 'utf8');
    for (const marker of [
      'SYS_clone3',
      'CLONE_NEWUSER',
      'CLONE_NEWPID',
      'CLONE_NEWCGROUP',
      'pidfd_open',
      'openat2',
      'RESOLVE_BENEATH',
      'RESOLVE_NO_MAGICLINKS',
      'RESOLVE_NO_XDEV',
      'pivot_root',
      'MS_PRIVATE',
      'MS_RDONLY',
      'close_range',
      'dup3(capability_fd, 3',
      'PR_SET_NO_NEW_PRIVS',
      'PR_SET_SECCOMP',
      'SECCOMP_RET_KILL_PROCESS'
    ]) expect(source).toContain(marker);
  });

  it('has explicit seccomp deny and allow entries', async () => {
    const source = await readFile(launcherPath, 'utf8');
    for (const denied of ['SYS_socket', 'SYS_socketpair', 'SYS_connect', 'SYS_mount', 'SYS_setns', 'SYS_unshare', 'SYS_ptrace', 'SYS_bpf', 'SYS_keyctl', 'SYS_io_uring_setup']) expect(source).not.toContain(denied);
    for (const allowed of ['SYS_read', 'SYS_write', 'SYS_futex', 'SYS_mmap', 'SYS_openat', 'SYS_recvmsg', 'SYS_sendmsg']) expect(source).toContain(allowed);
    expect(source).toContain('SYS_clone');
    expect(source).toContain('clone3 is intentionally absent');
  });

  it('bootstraps only Node 24 with exact environment and handler path', async () => {
    const source = await readFile(bootstrapPath, 'utf8');
    for (const marker of ['process.versions.node', "KCML_CONTEXT_FD", 'KCML_CONTEXT_FD_CLOEXEC', 'process.dlopen', 'FD_CLOEXEC', 'PATH: \'/runtime/bin\'', 'NODE_OPTIONS', 'realpathSync', "entrypoint.startsWith('/runtime/')"]) expect(source).toContain(marker);
  });

  it('passes the bootstrap pair through the trusted runtime boundary', async () => {
    const source = await readFile(boundaryPath, 'utf8');
    expect(source).toContain('nodeBootstrap?:');
    expect(source).toContain('RUNTIME_BOOTSTRAP_PAIR_REQUIRED');
    expect(source).toContain('RUNTIME_ENVIRONMENT_NOT_ALLOWED');
    expect(source).toContain("'--bootstrap'");
  });
});
