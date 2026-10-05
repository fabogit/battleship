import { describe, expect, it } from 'vitest';

import { createOriginMatcher, parseOriginEntry } from '../src/origins.js';

describe('parseOriginEntry', () => {
  it.each([
    ['https://battleship.pages.dev/', 'https://battleship.pages.dev'],
    ['http://localhost:4200', 'http://localhost:4200'],
    ['https://*.battleship.pages.dev', 'https://*.battleship.pages.dev'],
    ['https://*.Battleship.Pages.dev/', 'https://*.battleship.pages.dev'],
  ])('normalizes %s', (entry, expected) => {
    expect(parseOriginEntry(entry)).toBe(expected);
  });

  it.each(['not a url', 'file:///tmp'])('rejects %s', (entry) => {
    expect(() => parseOriginEntry(entry)).toThrow(/Invalid origin/);
  });

  it.each([
    'http://*.battleship.pages.dev',
    'https://*.pages.dev',
    'https://*.onrender.com',
    'https://*.dev',
    'https://*',
    '*',
    'https://a.*.pages.dev',
    'https://*battleship.pages.dev',
    'https://*.*.battleship.pages.dev',
    'https://*.battleship.pages.dev:8443',
    'https://*.battleship.pages.dev/path',
  ])('rejects the wildcard %s', (entry) => {
    expect(() => parseOriginEntry(entry)).toThrow(/Invalid wildcard origin/);
  });
});

describe('createOriginMatcher', () => {
  const isAllowed = createOriginMatcher(['https://battleship.pages.dev', 'https://*.battleship.pages.dev']);

  it.each([
    ['no Origin header', undefined],
    ['the production origin', 'https://battleship.pages.dev'],
    ['a preview deployment', 'https://3f9a1c2e.battleship.pages.dev'],
    ['a branch alias', 'https://feat-m0-render.battleship.pages.dev'],
  ])('allows %s', (_label, origin) => {
    expect(isAllowed(origin)).toBe(true);
  });

  it.each([
    'https://battleship.pages.dev.evil.example',
    'https://x.battleship.pages.dev.evil.example',
    'https://a.b.battleship.pages.dev',
    'http://x.battleship.pages.dev',
    'https://x.battleship.pages.dev:8443',
    'https://-x.battleship.pages.dev',
    'https://.battleship.pages.dev',
    'https://evilbattleship.pages.dev',
    'https://other.pages.dev',
    'null',
  ])('rejects %s', (origin) => {
    expect(isAllowed(origin)).toBe(false);
  });

  it('allows no wildcard origin when only exact origins are listed', () => {
    expect(createOriginMatcher(['https://battleship.pages.dev'])('https://x.battleship.pages.dev')).toBe(false);
  });
});
