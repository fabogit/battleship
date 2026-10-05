import { TestBed } from '@angular/core/testing';
import { io } from 'socket.io-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GameSocketService } from './game-socket';
import { SERVER_URL } from './server-url';

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
}));

let service: GameSocketService;

beforeEach(() => {
  vi.mocked(io).mockClear();
  TestBed.configureTestingModule({
    providers: [{ provide: SERVER_URL, useValue: 'https://server.test' }],
  });
  service = TestBed.inject(GameSocketService);
});

describe('GameSocketService', () => {
  it('tries WebSocket first and falls back to polling (ADR §4.2)', () => {
    service.connect();

    expect(io).toHaveBeenCalledExactlyOnceWith('https://server.test', {
      transports: ['websocket', 'polling'],
      tryAllTransports: true,
    });
    expect(service.status()).toBe('connecting');
  });
});
