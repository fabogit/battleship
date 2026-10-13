import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { clientAddress } from '../src/client-address.js';

const PROXY = '10.0.0.7';
const CLIENT = '203.0.113.9';
const SPOOFED = '198.51.100.1';

/** Peer, header and hop count, as a proxy chain could present them. */
const CASES: readonly [string, string | undefined, number][] = [
  [PROXY, undefined, 0],
  [PROXY, undefined, 1],
  [PROXY, CLIENT, 0],
  [PROXY, CLIENT, 1],
  [PROXY, CLIENT, 2],
  [PROXY, `${SPOOFED}, ${CLIENT}`, 1],
  [PROXY, `${SPOOFED},${CLIENT}`, 2],
  [PROXY, `${SPOOFED}, ${CLIENT}, 10.0.0.3`, 2],
  [PROXY, `${SPOOFED}, ${CLIENT}, 10.0.0.3`, 5],
  ['::ffff:127.0.0.1', '2001:db8::1', 1],
];

describe('clientAddress', () => {
  it('ignores the header without a trusted hop', () => {
    expect(clientAddress(PROXY, `${SPOOFED}, ${CLIENT}`, 0)).toBe(PROXY);
  });

  it('takes the entry the trusted proxy appended, not the ones the client sent', () => {
    expect(clientAddress(PROXY, `${SPOOFED}, ${CLIENT}`, 1)).toBe(CLIENT);
  });

  it('reads header lines as one list', () => {
    expect(clientAddress(PROXY, [SPOOFED, CLIENT], 1)).toBe(CLIENT);
  });

  it('stops at the leftmost entry when the chain is shorter than the hops', () => {
    expect(clientAddress(PROXY, CLIENT, 3)).toBe(CLIENT);
    expect(clientAddress(PROXY, undefined, 3)).toBe(PROXY);
  });

  // The socket log and Fastify's request log must name the same client (ADR-0067).
  it.each(CASES)(
    'agrees with Fastify request.ip for peer %s, X-Forwarded-For %j and %i hops',
    async (peer, xff, hops) => {
      const app = Fastify(hops > 0 ? { trustProxy: (_address: string, hop: number) => hop < hops } : {});
      app.get('/', (request) => request.ip);
      const response = await app.inject({
        url: '/',
        remoteAddress: peer,
        headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
      });
      expect(response.body).toBe(clientAddress(peer, xff, hops));
      await app.close();
    },
  );
});
