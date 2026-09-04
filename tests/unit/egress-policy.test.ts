import type { LookupAddress } from 'node:dns';
import { describe, expect, it } from 'vitest';
import { assertPublicDnsAnswers, authorizeEgressUrl, isForbiddenEgressAddress, performPinnedRequest } from '../../packages/worker-runtime/src/index.js';

describe('egress policy', () => {
  it('rejects loopback, private, metadata, documentation and mixed DNS answers', () => {
    for (const address of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','::1','fe80::1','2001:db8::1','::ffff:127.0.0.1']) expect(isForbiddenEgressAddress(address)).toBe(true);
    expect(isForbiddenEgressAddress('1.1.1.1')).toBe(false);
    expect(isForbiddenEgressAddress('::ffff:1.1.1.1')).toBe(false);
    expect(() => assertPublicDnsAnswers([{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }])).toThrow('EGRESS_DNS_ADDRESS_DENIED');
  });

  it('canonicalizes only a TLS same-origin method/path policy', () => {
    const policy = { baseUrl: 'https://api.example.com/v1/', allowedPaths: ['/v1'], allowedMethods: ['POST'], timeoutMs: 1000, maxRequestBytes: 1000, maxResponseBytes: 1000 };
    expect(authorizeEgressUrl(policy, '/v1/messages?limit=1', 'post').href).toBe('https://api.example.com/v1/messages?limit=1');
    expect(() => authorizeEgressUrl(policy, 'https://metadata.invalid/', 'POST')).toThrow('EGRESS_ABSOLUTE_URL_DENIED');
    expect(() => authorizeEgressUrl(policy, '/admin', 'POST')).toThrow('EGRESS_PATH_DENIED');
    expect(() => authorizeEgressUrl({ ...policy, baseUrl: 'http://api.example.com/' }, '/', 'POST')).toThrow('EGRESS_TLS_REQUIRED');
  });

  it('rejects a private resolution before opening a transport', async () => {
    const resolver = (async () => [{ address: '169.254.169.254', family: 4 }] as LookupAddress[]) as never;
    await expect(performPinnedRequest(new URL('https://example.com/'), { method: 'GET', headers: {}, timeoutMs: 100, maxResponseBytes: 100, resolver })).rejects.toThrow('EGRESS_DNS_ADDRESS_DENIED');
  });
});
