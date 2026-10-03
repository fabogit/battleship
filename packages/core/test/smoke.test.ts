import { describe, expect, it } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { PROTOCOL_VERSION } from '../src/index.js';

describe('@battleship/core', () => {
  it('exports PROTOCOL_VERSION', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('has zero runtime dependencies', () => {
    expect(pkg).not.toHaveProperty('dependencies');
    expect(pkg).not.toHaveProperty('peerDependencies');
    expect(pkg).not.toHaveProperty('optionalDependencies');
  });
});
