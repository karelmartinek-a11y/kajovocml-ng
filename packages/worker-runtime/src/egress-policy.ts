import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

export interface EgressPolicy {
  baseUrl: string;
  allowedPaths: readonly string[];
  allowedMethods: readonly string[];
  timeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  allowPlainHttp?: boolean;
}

const forbiddenAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
  ['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]
] as const) forbiddenAddresses.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32]] as const) forbiddenAddresses.addSubnet(network, prefix, 'ipv6');

export function isForbiddenEgressAddress(address: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address);
  if (mapped?.[1]) return isForbiddenEgressAddress(mapped[1]);
  const family = isIP(address);
  if (family === 0) return true;
  return forbiddenAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export function assertPublicDnsAnswers(addresses: readonly LookupAddress[]): readonly LookupAddress[] {
  if (addresses.length === 0) throw new Error('EGRESS_DNS_EMPTY');
  if (addresses.some(({ address }) => isForbiddenEgressAddress(address))) throw new Error('EGRESS_DNS_ADDRESS_DENIED');
  const unique = new Map(addresses.map((entry) => [`${entry.family}:${entry.address}`, entry]));
  return [...unique.values()];
}

export async function resolvePublicAddresses(hostname: string, resolver: typeof dnsLookup = dnsLookup): Promise<readonly LookupAddress[]> {
  return assertPublicDnsAnswers(await resolver(hostname, { all: true, verbatim: true }));
}

export function authorizeEgressUrl(policy: EgressPolicy, relativePath: string, method: string): URL {
  const base = new URL(policy.baseUrl);
  if (base.username || base.password || base.hash) throw new Error('EGRESS_TARGET_URL_INVALID');
  if (base.protocol !== 'https:' && !(policy.allowPlainHttp === true && base.protocol === 'http:')) throw new Error('EGRESS_TLS_REQUIRED');
  if (/^[a-z][a-z0-9+.-]*:/iu.test(relativePath) || relativePath.startsWith('//') || relativePath.includes('\\')) throw new Error('EGRESS_ABSOLUTE_URL_DENIED');
  const url = new URL(relativePath, base);
  if (url.origin !== base.origin || url.username || url.password || url.hash) throw new Error('EGRESS_ORIGIN_MISMATCH');
  const normalizedMethod = method.toUpperCase();
  if (!policy.allowedMethods.map((value) => value.toUpperCase()).includes(normalizedMethod)) throw new Error('EGRESS_METHOD_DENIED');
  if (!policy.allowedPaths.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))) throw new Error('EGRESS_PATH_DENIED');
  return url;
}

export interface PinnedRequestOptions {
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: Buffer;
  timeoutMs: number;
  maxResponseBytes: number;
  resolver?: typeof dnsLookup;
}

export async function performPinnedRequest(url: URL, options: PinnedRequestOptions): Promise<{ status: number; headers: Record<string, string | string[]>; body: Buffer; remoteAddress: string }> {
  const addresses = await resolvePublicAddresses(url.hostname, options.resolver);
  const selected = addresses[0];
  if (!selected) throw new Error('EGRESS_DNS_EMPTY');
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    let settled = false;
    const finishError = (error: Error) => { if (!settled) { settled = true; clearTimeout(deadline); reject(error); } };
    const request = transport(url, {
      method: options.method,
      headers: options.headers,
      servername: url.protocol === 'https:' ? url.hostname : undefined,
      rejectUnauthorized: url.protocol === 'https:',
      lookup: (_hostname, lookupOptions, callback) => lookupOptions.all
        ? callback(null, [selected])
        : callback(null, selected.address, selected.family)
    }, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > options.maxResponseBytes) request.destroy(new Error('EGRESS_RESPONSE_TOO_LARGE'));
        else chunks.push(chunk);
      });
      response.once('error', finishError);
      response.once('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve({ status: response.statusCode ?? 0, headers: response.headers as Record<string, string | string[]>, body: Buffer.concat(chunks), remoteAddress: selected.address });
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error('EGRESS_DEADLINE_EXCEEDED')), options.timeoutMs);
    request.once('error', (error) => finishError(error instanceof Error ? error : new Error(String(error))));
    if (options.body) request.end(options.body); else request.end();
  });
}
