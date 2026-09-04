import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const launcherPath = new URL('../../deploy/runtime/kcml-sandbox-launcher.c', import.meta.url);
const probePath = new URL('../../deploy/runtime/kcml-sandbox-probe.c', import.meta.url);
const nativeTestPath = new URL('./native-sandbox.sh', import.meta.url);
const bootstrapPath = new URL('../../deploy/runtime/kcml-node-bootstrap.mjs', import.meta.url);
const boundaryPath = new URL('../../packages/runtime-boundary/src/index.ts', import.meta.url);

describe('TD-19 runtime sandbox contract', () => {
  it('implements the namespace, pidfd and root linearization', async () => {
    const source = await readFile(launcherPath, 'utf8');
    expect(source).toMatch(/clone_arguments\.flags\s*=\s*CLONE_PIDFD[\s\S]*CLONE_NEWUSER[\s\S]*CLONE_NEWPID[\s\S]*CLONE_NEWCGROUP/u);
    expect(source).toContain('configure_user_mapping(child, uid, gid)');
    expect(source).toContain('syscall(SYS_pidfd_open');
    expect(source).toContain('TRUSTED_EXECUTABLE_FD 1024');
    expect(source).toContain('RLIMIT_NOFILE');
    expect(source).toContain('openat2_path');
    expect(source).toContain('RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV');
    expect(source).toContain('syscall(SYS_pivot_root');
    expect(source).toContain('mount(NULL, "/", NULL, MS_REC | MS_PRIVATE');
    expect(source).toContain('MS_BIND | MS_REMOUNT | MS_RDONLY');
    expect(source).toContain('close_range_except');
    expect(source).toContain('validate_capability_fd()');
    expect(source.indexOf('configure_user_mapping(child, uid, gid)')).toBeLessThan(source.indexOf('write(barrier[1]'));
  });

  it('uses a real FD3 inheritance contract and a fail-closed minimal BPF profile', async () => {
    const source = await readFile(launcherPath, 'utf8');
    expect(source).toContain('parse_fd3');
    expect(source).toContain('fstat(3, &status)');
    expect(source).toContain('getpeername(3');
    expect(source).toContain('setenv("KCML_CONTEXT_FD", "3"');
    expect(source).toContain('setenv("KCML_CONTEXT_FD_CLOEXEC", "BOOTSTRAP_REQUIRED"');
    expect(source).toContain('AUDIT_ARCH_NATIVE');
    expect(source).toContain('SECCOMP_RET_KILL_PROCESS');
    expect(source).toContain('const size_t remaining');
    expect(source).toContain('SYS_recvmsg');
    expect(source).toContain('SYS_sendmsg');
    expect(source).toContain('SYS_execveat');
    expect(source).toContain('SYS_clone3');
    expect(source).toContain('SYS_io_uring_setup');
    expect(source).toContain('SECCOMP_RET_ERRNO | ENOSYS');
    expect(source).toContain('SECCOMP_RET_ERRNO | EPERM');
    expect(source).not.toContain('SYS_socket,');
    expect(source).not.toContain('SYS_socketpair,');
    expect(source).not.toContain('SYS_mount,');
    expect(source).not.toContain('SYS_setns,');
    expect(source).not.toContain('SYS_unshare,');
    expect(source).not.toContain('SYS_ptrace,');
    expect(source).not.toContain('SYS_bpf,');
    expect(source).not.toContain('SYS_keyctl,');
  });

  it('has executable behavioral fixtures for namespaces, filesystem and syscall denial', async () => {
    const probe = await readFile(probePath, 'utf8');
    const nativeTest = await readFile(nativeTestPath, 'utf8');
    expect(probe).toContain('getpid() != 1');
    expect(probe).toContain('getuid() != 0');
    expect(probe).toContain('fstat(3');
    expect(probe).toContain('"/sys"');
    expect(probe).toContain('"/work/td19-write-check"');
    expect(probe).toContain('"/runtime/td19-write-check"');
    expect(probe).toContain('SYS_io_uring_setup');
    expect(probe).toContain('SANDBOX_DENY_IO_URING_PASS');
    expect(nativeTest).toContain('SANDBOX_INSPECT_PASS');
    expect(nativeTest).toContain('SANDBOX_DENY_SOCKET_PASS');
    expect(nativeTest).toContain('SANDBOX_DENY_IO_URING_PASS');
    expect(nativeTest).toContain('NODE_BOOTSTRAP_PASS');
    expect(nativeTest).toContain('os.dup2(child_end.fileno(), 3, inheritable=True)');
  });

  it('bootstraps only Node 24 and imports a verified handler after FD hardening', async () => {
    const source = await readFile(bootstrapPath, 'utf8');
    expect(source).toContain("Number(process.versions.node.split('.')[0]) !== 24");
    expect(source).toContain('KCML_CONTEXT_FD');
    expect(source).toContain('KCML_CONTEXT_FD_CLOEXEC');
    expect(source).toContain('process.dlopen');
    expect(source).toContain('FD_CLOEXEC');
    expect(source).toContain("PATH: '/runtime/bin'");
    expect(source).toContain('NODE_OPTIONS');
    expect(source).toContain('realpathSync');
    expect(source).toContain("entrypoint.startsWith('/runtime/')");
    expect(source).toContain('await import(pathToFileURL(entrypoint).href)');
  });

  it('passes the bootstrap pair through the trusted runtime boundary', async () => {
    const source = await readFile(boundaryPath, 'utf8');
    const addon = await readFile(new URL('../../deploy/runtime/kcml-fd-cloexec-addon.c', import.meta.url), 'utf8');
    expect(source).toContain('nodeBootstrap?:');
    expect(source).toContain('RUNTIME_BOOTSTRAP_PAIR_REQUIRED');
    expect(source).toContain('RUNTIME_ENVIRONMENT_NOT_ALLOWED');
    expect(source).toContain("'--bootstrap'");
    expect(source).toContain("'--handler-entrypoint'");
    expect(source).toContain('addon.createSocketPair');
    expect(source).toContain('capabilityPair.childFd');
    expect(addon).toContain('socketpair(AF_UNIX');
    expect(addon).toContain('SOCK_CLOEXEC');
    expect(addon).toContain('SOCK_NONBLOCK');
  });
});
