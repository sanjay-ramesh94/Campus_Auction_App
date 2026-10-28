export interface PresenceEntry {
  userId: string;
  name: string;
  initials: string;
  connectionCount: number;
  isVisible: boolean;
  lastSeen: number;
  removalTimer?: NodeJS.Timeout | null;
}

export interface PublicPresenceUser {
  userId: string;
  name: string;
  initials: string;
  isLeader: boolean;
  isBidder: boolean;
  isVisible: boolean;
}

export interface PresenceBroadcastPayload {
  type: 'PRESENCE_UPDATE';
  auctionId: string;
  totalPresent: number;
  activeCount: number;
  awayCount: number;
  users: PublicPresenceUser[];
}

export type PresenceBroadcastFn = (auctionId: string, payload: PresenceBroadcastPayload) => void;
export type AuctionBiddersLookupFn = (auctionId: string) => Promise<{ leaderId: string | null; bidderIds: Set<string> }>;

/**
 * In-Memory Presence Manager
 * Tracks live presence per auction:
 * - temporary in server memory (not MongoDB)
 * - multi-tab connection count per student
 * - 3-5s debounce against refresh flicker
 * - Page Visibility state tracking
 * - Safe public avatar data (no private info)
 */
export class PresenceManager {
  private presenceMap: Map<string, Map<string, PresenceEntry>> = new Map();
  private broadcastFn?: PresenceBroadcastFn;
  private biddersLookupFn?: AuctionBiddersLookupFn;

  constructor(broadcastFn?: PresenceBroadcastFn, biddersLookupFn?: AuctionBiddersLookupFn) {
    this.broadcastFn = broadcastFn;
    this.biddersLookupFn = biddersLookupFn;
  }

  public setBroadcastFn(fn: PresenceBroadcastFn): void {
    this.broadcastFn = fn;
  }

  public setBiddersLookupFn(fn: AuctionBiddersLookupFn): void {
    this.biddersLookupFn = fn;
  }

  public getInitials(name: string): string {
    if (!name || typeof name !== 'string') return 'ST';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  public async addConnection(
    auctionId: string,
    user: { userId: string; name: string }
  ): Promise<PresenceBroadcastPayload> {
    const aid = String(auctionId);
    const uid = String(user.userId);

    let auctionMap = this.presenceMap.get(aid);
    if (!auctionMap) {
      auctionMap = new Map();
      this.presenceMap.set(aid, auctionMap);
    }

    const existing = auctionMap.get(uid);
    if (existing) {
      if (existing.removalTimer) {
        clearTimeout(existing.removalTimer);
        existing.removalTimer = null;
      }
      existing.connectionCount++;
      existing.isVisible = true;
      existing.lastSeen = Date.now();
      if (user.name && user.name !== existing.name) {
        existing.name = user.name;
        existing.initials = this.getInitials(user.name);
      }
    } else {
      auctionMap.set(uid, {
        userId: uid,
        name: user.name || 'Campus Student',
        initials: this.getInitials(user.name),
        connectionCount: 1,
        isVisible: true,
        lastSeen: Date.now(),
        removalTimer: null,
      });
    }

    const payload = await this.getPresence(aid);
    if (this.broadcastFn) {
      this.broadcastFn(aid, payload);
    }
    return payload;
  }

  public removeConnection(
    auctionId: string,
    userId: string,
    gracePeriodMs = 4000
  ): void {
    const aid = String(auctionId);
    const uid = String(userId);

    const auctionMap = this.presenceMap.get(aid);
    if (!auctionMap) return;

    const entry = auctionMap.get(uid);
    if (!entry) return;

    entry.connectionCount--;

    if (entry.connectionCount <= 0) {
      entry.connectionCount = 0;
      if (entry.removalTimer) {
        clearTimeout(entry.removalTimer);
      }
      entry.removalTimer = setTimeout(async () => {
        const curMap = this.presenceMap.get(aid);
        if (!curMap) return;
        const curEntry = curMap.get(uid);
        if (curEntry && curEntry.connectionCount <= 0) {
          curMap.delete(uid);
          if (curMap.size === 0) {
            this.presenceMap.delete(aid);
          }
          await this.broadcastPresence(aid);
        }
      }, gracePeriodMs);
    }
  }

  public async setVisibility(
    auctionId: string,
    userId: string,
    visible: boolean
  ): Promise<PresenceBroadcastPayload | null> {
    const aid = String(auctionId);
    const uid = String(userId);

    const auctionMap = this.presenceMap.get(aid);
    if (!auctionMap) return null;

    const entry = auctionMap.get(uid);
    if (!entry) return null;

    entry.isVisible = Boolean(visible);
    entry.lastSeen = Date.now();

    const payload = await this.getPresence(aid);
    if (this.broadcastFn) {
      this.broadcastFn(aid, payload);
    }
    return payload;
  }

  public async getPresence(auctionId: string): Promise<PresenceBroadcastPayload> {
    const aid = String(auctionId);
    const auctionMap = this.presenceMap.get(aid);

    let leaderId: string | null = null;
    let bidderIds = new Set<string>();

    if (this.biddersLookupFn) {
      try {
        const res = await this.biddersLookupFn(aid);
        leaderId = res.leaderId ? String(res.leaderId) : null;
        bidderIds = res.bidderIds;
      } catch {
        // Fallback gracefully
      }
    }

    if (!auctionMap || auctionMap.size === 0) {
      return {
        type: 'PRESENCE_UPDATE',
        auctionId: aid,
        totalPresent: 0,
        activeCount: 0,
        awayCount: 0,
        users: [],
      };
    }

    const entries = Array.from(auctionMap.values());
    const totalPresent = entries.length;
    const activeCount = entries.filter((e) => e.isVisible).length;
    const awayCount = totalPresent - activeCount;

    const users: PublicPresenceUser[] = entries.map((e) => ({
      userId: e.userId,
      name: e.name,
      initials: e.initials,
      isLeader: leaderId ? e.userId === leaderId : false,
      isBidder: bidderIds.has(e.userId),
      isVisible: e.isVisible,
    }));

    // Sort: Leader first, then other bidders, then active spectators, then away users
    users.sort((a, b) => {
      if (a.isLeader && !b.isLeader) return -1;
      if (!a.isLeader && b.isLeader) return 1;
      if (a.isBidder && !b.isBidder) return -1;
      if (!a.isBidder && b.isBidder) return 1;
      if (a.isVisible && !b.isVisible) return -1;
      if (!a.isVisible && b.isVisible) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      type: 'PRESENCE_UPDATE',
      auctionId: aid,
      totalPresent,
      activeCount,
      awayCount,
      users,
    };
  }

  public async broadcastPresence(auctionId: string): Promise<void> {
    const payload = await this.getPresence(auctionId);
    if (this.broadcastFn) {
      this.broadcastFn(auctionId, payload);
    }
  }

  public clearAuction(auctionId: string): void {
    const aid = String(auctionId);
    const auctionMap = this.presenceMap.get(aid);
    if (auctionMap) {
      for (const entry of auctionMap.values()) {
        if (entry.removalTimer) clearTimeout(entry.removalTimer);
      }
      this.presenceMap.delete(aid);
    }
  }

  public clearAll(): void {
    for (const [aid] of this.presenceMap) {
      this.clearAuction(aid);
    }
    this.presenceMap.clear();
  }

  public getUserConnectionCount(auctionId: string, userId: string): number {
    return this.presenceMap.get(String(auctionId))?.get(String(userId))?.connectionCount || 0;
  }
}

export const presenceManager = new PresenceManager();
