import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PresenceManager, PresenceBroadcastPayload } from '../src/presence.js';

describe('Live Temporary Presence Manager', () => {
  let manager: PresenceManager;
  let broadcastEvents: { auctionId: string; payload: PresenceBroadcastPayload }[];

  beforeEach(() => {
    vi.useRealTimers();
    broadcastEvents = [];
    manager = new PresenceManager(
      (auctionId, payload) => {
        broadcastEvents.push({ auctionId, payload });
      },
      async (auctionId) => {
        // Mock auction bidders lookup
        return {
          leaderId: 'user-leader',
          bidderIds: new Set(['user-leader', 'user-bidder']),
        };
      }
    );
  });

  it('adds user on join and broadcasts presence with safe public fields only', async () => {
    const payload = await manager.addConnection('auction-1', {
      userId: 'user-leader',
      name: 'Sam Wilson',
    });

    expect(payload.auctionId).toBe('auction-1');
    expect(payload.totalPresent).toBe(1);
    expect(payload.activeCount).toBe(1);
    expect(payload.awayCount).toBe(0);
    expect(payload.users[0]).toEqual({
      userId: 'user-leader',
      name: 'Sam Wilson',
      initials: 'SW',
      isLeader: true,
      isBidder: true,
      isVisible: true,
    });
    // Ensure no private properties like email or password are in payload
    expect((payload.users[0] as any).email).toBeUndefined();
    expect((payload.users[0] as any).password).toBeUndefined();
  });

  it('tracks connection counts for same user across multiple tabs', async () => {
    await manager.addConnection('auction-1', { userId: 'u1', name: 'Alice Smith' });
    expect(manager.getUserConnectionCount('auction-1', 'u1')).toBe(1);

    // Second tab opens
    await manager.addConnection('auction-1', { userId: 'u1', name: 'Alice Smith' });
    expect(manager.getUserConnectionCount('auction-1', 'u1')).toBe(2);

    // First tab closes: count drops to 1, user remains in room
    manager.removeConnection('auction-1', 'u1', 50);
    expect(manager.getUserConnectionCount('auction-1', 'u1')).toBe(1);

    const presence = await manager.getPresence('auction-1');
    expect(presence.totalPresent).toBe(1);
    expect(presence.users[0].userId).toBe('u1');
  });

  it('waits for grace period (refresh flicker prevention) before removing user', async () => {
    vi.useFakeTimers();

    await manager.addConnection('auction-1', { userId: 'u1', name: 'Alice Smith' });
    expect(manager.getUserConnectionCount('auction-1', 'u1')).toBe(1);

    // Tab closes (e.g. page refresh initiated)
    manager.removeConnection('auction-1', 'u1', 3000);
    expect(manager.getUserConnectionCount('auction-1', 'u1')).toBe(0);

    // Immediately after closing, user is still in room (grace period active)
    let presence = await manager.getPresence('auction-1');
    expect(presence.totalPresent).toBe(1);

    // 1 second later, reconnect happens (refresh completed)
    vi.advanceTimersByTime(1000);
    await manager.addConnection('auction-1', { userId: 'u1', name: 'Alice Smith' });

    // 4 seconds pass (past the original timer deadline)
    vi.advanceTimersByTime(4000);

    // User is still present because reconnect cancelled the timer!
    presence = await manager.getPresence('auction-1');
    expect(presence.totalPresent).toBe(1);

    // Now really disconnect and let timer expire
    manager.removeConnection('auction-1', 'u1', 3000);
    vi.advanceTimersByTime(3100);

    // Now user is removed
    presence = await manager.getPresence('auction-1');
    expect(presence.totalPresent).toBe(0);
  });

  it('handles background tab visibility (Page Visibility API)', async () => {
    await manager.addConnection('auction-1', { userId: 'u1', name: 'Alice Smith' });
    await manager.addConnection('auction-1', { userId: 'u2', name: 'Bob Jones' });

    // User 1 switches tab
    await manager.setVisibility('auction-1', 'u1', false);

    const presence = await manager.getPresence('auction-1');
    expect(presence.totalPresent).toBe(2);
    expect(presence.activeCount).toBe(1);
    expect(presence.awayCount).toBe(1);

    const u1 = presence.users.find((u) => u.userId === 'u1');
    expect(u1?.isVisible).toBe(false);

    // User 1 switches back
    await manager.setVisibility('auction-1', 'u1', true);
    const presenceActive = await manager.getPresence('auction-1');
    expect(presenceActive.activeCount).toBe(2);
    expect(presenceActive.awayCount).toBe(0);
  });

  it('orders leader first, then bidders, then active spectators, then away spectators', async () => {
    await manager.addConnection('auction-1', { userId: 'spectator-active', name: 'Charlie Dave' });
    await manager.addConnection('auction-1', { userId: 'user-bidder', name: 'Bob Bidder' });
    await manager.addConnection('auction-1', { userId: 'user-leader', name: 'Sam Leader' });
    await manager.addConnection('auction-1', { userId: 'spectator-away', name: 'Zoe Away' });

    await manager.setVisibility('auction-1', 'spectator-away', false);

    const presence = await manager.getPresence('auction-1');
    const ids = presence.users.map((u) => u.userId);

    // Leader first, then bidder, then active spectator, then away spectator
    expect(ids).toEqual(['user-leader', 'user-bidder', 'spectator-active', 'spectator-away']);
  });
});
