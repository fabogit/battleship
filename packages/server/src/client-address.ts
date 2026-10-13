// The client address behind a reverse proxy (docs/server.md#logging, ADR-0067).

/**
 * Picks the client's address from the peer address and `X-Forwarded-For`, trusting a fixed number of proxy hops, as
 * Fastify's `trustProxy: <hops>` does for `request.ip` (`proxy-addr`). The chain is read from the right: the peer, then
 * each forwarded entry from the last one appended to the first. Each trusted hop moves one step to the left, so a
 * client that sends its own `X-Forwarded-For` only adds entries to the left of the ones the trusted proxies append.
 * @param peerAddress The address of the TCP peer: with a proxy in front, the proxy's.
 * @param forwardedFor The raw `X-Forwarded-For` header: comma-separated entries, in one string or one per header line.
 * @param trustedHops How many proxies in front of the server append to the header; `0` ignores the header.
 * @returns The address `trustedHops` steps left of the peer, or the leftmost entry when the chain is shorter.
 */
export function clientAddress(
  peerAddress: string,
  forwardedFor: string | readonly string[] | undefined,
  trustedHops: number,
): string {
  const forwarded = [forwardedFor ?? []]
    .flat()
    .flatMap((value) => value.split(','))
    .map((entry) => entry.trim());
  const chain = [peerAddress, ...forwarded.reverse()];
  return chain[Math.min(trustedHops, chain.length - 1)] ?? peerAddress;
}
