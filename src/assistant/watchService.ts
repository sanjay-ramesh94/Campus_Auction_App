import { MongoClient, Db, ObjectId } from 'mongodb';
import { getCollections } from '../db.js';
import { Watch, WatchStatus, Auction, Notification } from '../types.js';
import { eventHub } from '../bidding/events.js';
import { placeBid } from '../bidding/placeBid.js';
import { nextMinBid } from '../bidding/rules.js';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CreateWatchInput {
  keywords: string[] | string;
  category?: string;
  maxPrice?: number;
  autoBid?: boolean;
  maxBudget?: number;
  conditionFilter?: string;
}

export interface WatchOperationResult<T = any> {
  ok: boolean;
  statusCode: number;
  error?: string;
  data?: T;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sanitizeKeywords(input: string[] | string): string[] {
  let list: string[] = [];
  if (Array.isArray(input)) { list = input; }
  else if (typeof input === 'string') { list = input.split(/[,;\s]+/); }
  return list.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0 && k.length < 50).slice(0, 10);
}

function makeNotif(userId: ObjectId, type: string, title: string, message: string, watch: Watch, auction: Auction): Notification {
  return {
    _id: new ObjectId(), userId, type, title, message,
    link: '/auctions/' + auction._id.toString(),
    watchId: watch._id, listingId: auction._id,
    payload: {
      auctionId: auction._id.toString(), watchId: watch._id.toString(),
      title: auction.title, price: auction.startPrice,
      image: (auction.images && auction.images[0]) ? auction.images[0] : '',
      maxBudget: watch.maxBudget,
    },
    createdAt: new Date(),
  };
}

// ─── 1. Get watches ───────────────────────────────────────────────────────────

export async function getUserWatches(db: Db, userId: ObjectId): Promise<Watch[]> {
  return getCollections(db).watches.find({ userId }).sort({ createdAt: -1 }).toArray();
}

// ─── 2. Create watch ──────────────────────────────────────────────────────────

export async function createWatch(
  db: Db,
  userId: ObjectId,
  input: CreateWatchInput,
  authorizedAt?: Date,
  client?: MongoClient
): Promise<WatchOperationResult<Watch>> {
  const cols = getCollections(db);
  const now = new Date();

  const allActive = await cols.watches
    .find({ userId, status: { $in: ['active', 'paused'] }, expiresAt: { $gt: now } })
    .toArray();

  if (allActive.length >= 10) {
    return { ok: false, statusCode: 400, error: 'Active watch limit reached (10 max). Please delete or pause one first.' };
  }

  if (input.autoBid) {
    const abActive = allActive.filter((w) => w.autoBid && w.status === 'active').length;
    if (abActive >= 3) {
      return { ok: false, statusCode: 400, error: 'You can have at most 3 active auto-bid watches.' };
    }
  }

  const keywords = sanitizeKeywords(input.keywords);
  if (keywords.length === 0 && !input.category) {
    return { ok: false, statusCode: 400, error: 'Provide at least one keyword or category.' };
  }

  const maxPrice = input.maxPrice ? Math.floor(Number(input.maxPrice)) : undefined;
  if (maxPrice !== undefined && maxPrice <= 0) {
    return { ok: false, statusCode: 400, error: 'Max price must be greater than 0.' };
  }

  let maxBudget: number | undefined;
  if (input.autoBid) {
    if (!input.maxBudget || Number(input.maxBudget) <= 0) {
      return { ok: false, statusCode: 400, error: 'Auto-bid requires a positive max budget.' };
    }
    maxBudget = Math.floor(Number(input.maxBudget));
    if (!authorizedAt) {
      return { ok: false, statusCode: 400, error: 'Auto-bid watches require explicit authorization.' };
    }
  }

  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const watch: Watch = {
    _id: new ObjectId(),
    userId,
    keywords,
    category: input.category ? input.category.trim() : undefined,
    maxPrice,
    autoBid: Boolean(input.autoBid),
    maxBudget,
    conditionFilter: input.conditionFilter ? input.conditionFilter.trim() : undefined,
    status: 'active',
    activeAutoBidAuctionId: null,
    active: true,
    createdAt: now,
    expiresAt,
    lastMatchedAt: null,
  };
  if (input.autoBid && authorizedAt) {
    (watch as any).authorizedAt = authorizedAt;
  }

  await cols.watches.insertOne(watch);

  // If autoBid is enabled, check if any currently active live auction matches this watch
  if (watch.autoBid) {
    matchActiveListingsForWatch(db, watch, client).catch((err) =>
      console.error('[matchActiveListingsForWatch Error]:', err)
    );
  }

  return { ok: true, statusCode: 201, data: watch };
}

// ─── 3. Toggle active ─────────────────────────────────────────────────────────

export async function toggleWatchActive(
  db: Db,
  userId: ObjectId,
  watchId: ObjectId,
  client?: MongoClient
): Promise<WatchOperationResult<Watch>> {
  const cols = getCollections(db);
  const watch = await cols.watches.findOne({ _id: watchId });
  if (!watch) return { ok: false, statusCode: 404, error: 'Watch not found.' };
  if (!watch.userId.equals(userId)) return { ok: false, statusCode: 403, error: 'Forbidden.' };
  if (watch.status === 'fulfilled' || watch.status === 'expired') {
    return { ok: false, statusCode: 400, error: 'Watch is already ' + watch.status + '.' };
  }

  const now = new Date();
  const newStatus: WatchStatus = watch.status === 'paused' ? 'active' : 'paused';

  if (newStatus === 'active') {
    const cnt = await cols.watches.countDocuments({ userId, status: 'active', expiresAt: { $gt: now } });
    if (cnt >= 10) return { ok: false, statusCode: 400, error: 'Active watch limit reached (10 max).' };
    if (watch.autoBid) {
      const abCnt = await cols.watches.countDocuments({ userId, autoBid: true, status: 'active', expiresAt: { $gt: now } });
      if (abCnt >= 3) return { ok: false, statusCode: 400, error: 'Active auto-bid watch limit (3 max) reached.' };
    }
  }

  await cols.watches.updateOne({ _id: watchId }, { $set: { status: newStatus, active: newStatus === 'active' } });
  const updatedWatch = { ...watch, status: newStatus, active: newStatus === 'active' };

  if (newStatus === 'active' && updatedWatch.autoBid) {
    matchActiveListingsForWatch(db, updatedWatch, client).catch((err) =>
      console.error('[matchActiveListingsForWatch Error on Resume]:', err)
    );
  }

  return { ok: true, statusCode: 200, data: updatedWatch };
}

// ─── 4. Delete watch ──────────────────────────────────────────────────────────

export async function deleteWatch(
  db: Db,
  userId: ObjectId,
  watchId: ObjectId
): Promise<WatchOperationResult<boolean>> {
  const cols = getCollections(db);
  const watch = await cols.watches.findOne({ _id: watchId });
  if (!watch) return { ok: false, statusCode: 404, error: 'Watch not found.' };
  if (!watch.userId.equals(userId)) return { ok: false, statusCode: 403, error: 'Forbidden.' };
  await cols.watches.deleteOne({ _id: watchId });
  return { ok: true, statusCode: 200, data: true };
}

// ─── 5. Match Active Live Listings for Watch (on Watch Creation or Resume) ────

export async function matchActiveListingsForWatch(
  db: Db,
  watch: Watch,
  client?: MongoClient
): Promise<void> {
  if (!watch.active || watch.status !== 'active' || !watch.autoBid) return;
  const cols = getCollections(db);
  const now = new Date();

  const liveAuctions = await cols.auctions
    .find({
      status: { $in: ['active', 'live'] },
      closesAt: { $gt: now },
      sellerId: { $ne: watch.userId },
    })
    .sort({ createdAt: -1 })
    .toArray();

  const cl = (watch.category || '').toLowerCase();
  for (const a of liveAuctions) {
    const tl = a.title.toLowerCase();
    const dl = (a.description || '').toLowerCase();
    const condl = (a.condition || '').toLowerCase();

    if (watch.category && (a.category || '').toLowerCase() !== cl) continue;
    if (watch.keywords && watch.keywords.length > 0) {
      const ok = watch.keywords.some((kw) => {
        const n = kw.toLowerCase();
        return tl.includes(n) || dl.includes(n);
      });
      if (!ok) continue;
    }
    if (watch.conditionFilter && !condl.includes(watch.conditionFilter.toLowerCase())) continue;

    const lp = a.currentPrice ?? a.startPrice;
    await _placeAutoBid(db, watch, a, now, lp, client);
    break; // 1 active auto-bid per watch
  }
}

// ─── 6. Matcher (called when a new listing goes live) ─────────────────────────

export async function matchWatchesForNewListing(
  db: Db,
  auction: Auction,
  client?: MongoClient
): Promise<number> {
  const cols = getCollections(db);
  const now = new Date();
  const lp = auction.currentPrice ?? auction.startPrice;
  const tl = auction.title.toLowerCase();
  const dl = (auction.description || '').toLowerCase();
  const cl = (auction.category || '').toLowerCase();
  const condl = (auction.condition || '').toLowerCase();

  const watches = await cols.watches
    .find({ active: true, status: 'active', expiresAt: { $gt: now }, userId: { $ne: auction.sellerId } })
    .toArray();

  if (watches.length === 0) return 0;
  let cnt = 0;

  for (const w of watches) {
    // Category
    if (w.category && w.category.toLowerCase() !== cl) continue;
    // Keywords
    if (w.keywords && w.keywords.length > 0) {
      const ok = w.keywords.some((kw) => { const n = kw.toLowerCase(); return tl.includes(n) || dl.includes(n); });
      if (!ok) continue;
    }
    // Condition filter
    if (w.conditionFilter && !condl.includes(w.conditionFilter.toLowerCase())) continue;

    if (w.autoBid) {
      await _placeAutoBid(db, w, auction, now, lp, client);
      cnt++;
    } else {
      if (w.maxPrice !== undefined && lp > w.maxPrice) continue;
      const notif = makeNotif(w.userId, 'watch_alert', '\uD83D\uDD14 Match Alert: ' + auction.title, 'A new listing matching your watch is live at \u20B9' + lp.toLocaleString() + '!', w, auction);
      try {
        await cols.notifications.insertOne(notif);
        cnt++;
        await cols.watches.updateOne({ _id: w._id }, { $set: { lastMatchedAt: now } });
        eventHub.emitAll([{
          type: 'WATCH_MATCH',
          targetUserId: w.userId,
          auctionId: auction._id,
          payload: { notificationId: notif._id.toString(), watchId: w._id.toString(), title: auction.title, price: lp, image: (auction.images && auction.images[0]) ? auction.images[0] : '', link: notif.link },
        }]);
      } catch (e: any) { if (e.code !== 11000) console.error('[matchWatches]', e); }
    }
  }
  return cnt;
}

async function _placeAutoBid(
  db: Db,
  watch: Watch,
  auction: Auction,
  now: Date,
  lp: number,
  client?: MongoClient
): Promise<void> {
  const cols = getCollections(db);
  if (!watch.maxBudget || watch.maxBudget <= 0) return;

  // Starting price above budget: skip, notify
  if (lp > watch.maxBudget) {
    const n = makeNotif(
      watch.userId,
      'AUTO_BID_SKIPPED',
      '\uD83D\uDCB0 Price Above Budget: ' + auction.title,
      '"' + auction.title + '" starts at \u20B9' + lp.toLocaleString() + ', above your budget of \u20B9' + watch.maxBudget.toLocaleString() + '.',
      watch,
      auction
    );
    try {
      await cols.notifications.insertOne(n);
      eventHub.emitAll([{ type: 'WATCH_MATCH', targetUserId: watch.userId, auctionId: auction._id, payload: n.payload as any }]);
    } catch (e: any) {
      if (e.code !== 11000) console.error(e);
    }
    return;
  }

  // One active auto-bid per watch: check if already assigned to a live auction
  if (watch.activeAutoBidAuctionId && !watch.activeAutoBidAuctionId.equals(auction._id)) {
    const prev = await cols.auctions.findOne({ _id: watch.activeAutoBidAuctionId });
    const stillLive = prev && (prev.status === 'active' || prev.status === 'live') && new Date(prev.closesAt).getTime() > now.getTime();
    if (stillLive) {
      const n = makeNotif(
        watch.userId,
        'WATCH_MATCH',
        '\uD83D\uDD14 New Match: ' + auction.title,
        'Match found, but you already have an active auto-bid running. Visit to bid manually.',
        watch,
        auction
      );
      try {
        await cols.notifications.insertOne(n);
        eventHub.emitAll([{ type: 'WATCH_MATCH', targetUserId: watch.userId, auctionId: auction._id, payload: n.payload as any }]);
      } catch {}
      return;
    }
    await cols.watches.updateOne({ _id: watch._id }, { $set: { activeAutoBidAuctionId: null } });
  }

  // Hard cap: never exceed auction maxPrice
  const cap = Math.min(watch.maxBudget, auction.maxPrice);

  try {
    // 1. Insert/update autoBids record (proxy bidding engine)
    await cols.autoBids.updateOne(
      { watchId: watch._id, listingId: auction._id },
      {
        $set: {
          auctionId: auction._id,
          userId: watch.userId,
          maxAmount: cap,
          watchId: watch._id,
          listingId: auction._id,
          createdAt: now,
        },
        $setOnInsert: { _id: new ObjectId() },
      },
      { upsert: true }
    );
    await cols.watches.updateOne(
      { _id: watch._id },
      { $set: { activeAutoBidAuctionId: auction._id, lastMatchedAt: now } }
    );

    // 2. Fetch fresh auction state and place opening or increment bid if not already leader
    const freshAuction = await cols.auctions.findOne({ _id: auction._id });
    if (freshAuction && (freshAuction.status === 'active' || freshAuction.status === 'live')) {
      const isLeader = freshAuction.leaderId && freshAuction.leaderId.equals(watch.userId);
      if (!isLeader) {
        const minReq = nextMinBid({
          currentPrice: freshAuction.currentPrice,
          startPrice: freshAuction.startPrice,
          maxPrice: freshAuction.maxPrice,
          minIncrement: freshAuction.minIncrement,
        });

        if (minReq !== null && minReq <= cap) {
          const mongoClient = client || (db as any).client;
          if (mongoClient) {
            const bidResult = await placeBid(mongoClient, db, {
              auctionId: freshAuction._id,
              bidderId: watch.userId,
              amount: minReq,
              bidderRole: 'buyer',
              idempotencyKey: `watch-autobid-${watch._id}-${freshAuction._id}-${minReq}`,
            });
            console.log(`[AutoBidWatch] Placed opening bid for user=${watch.userId} auction=${freshAuction._id} amount=₹${minReq}, result ok=${bidResult.ok}`);
          }
        }
      }
    }

    const n = makeNotif(
      watch.userId,
      'AUTO_BID_PLACED',
      '\uD83E\uDD16 Auto-Bid Placed: ' + auction.title,
      'Auto-bid activated for "' + auction.title + '". Starting: \u20B9' + lp.toLocaleString() + ', your max: \u20B9' + cap.toLocaleString() + '.',
      watch,
      auction
    );
    await cols.notifications.insertOne(n);
    eventHub.emitAll([{
      type: 'AUTO_BID_PLACED',
      targetUserId: watch.userId,
      auctionId: auction._id,
      payload: {
        notificationId: n._id.toString(),
        watchId: watch._id.toString(),
        title: auction.title,
        price: lp,
        maxBudget: cap,
        image: (auction.images && auction.images[0]) ? auction.images[0] : '',
        link: '/auctions/' + auction._id.toString(),
      },
    }]);
    console.log('[AutoBidWatch] user=' + watch.userId + ' auction=' + auction._id + ' cap=\u20B9' + cap);
  } catch (e: any) {
    if (e.code === 11000) {
      console.log('[AutoBidWatch] Duplicate prevented');
      return;
    }
    console.error('[AutoBidWatch] Failed:', e);
    const fn = makeNotif(
      watch.userId,
      'AUTO_BID_FAILED',
      '\u26A0\uFE0F Auto-Bid Failed: ' + auction.title,
      'Could not auto-bid on "' + auction.title + '": ' + (e.message || 'Unknown') + '. Please bid manually.',
      watch,
      auction
    );
    try {
      await cols.notifications.insertOne(fn);
      eventHub.emitAll([{ type: 'AUTO_BID_FAILED', targetUserId: watch.userId, auctionId: auction._id, payload: fn.payload as any }]);
    } catch {}
  }
}

// ─── 7. Handle outbid beyond budget ──────────────────────────────────────────

export async function handleWatchOutbid(db: Db, userId: ObjectId, auctionId: ObjectId, newPrice: number): Promise<void> {
  const cols = getCollections(db);
  const ws = await cols.watches.find({ userId, autoBid: true, status: 'active', activeAutoBidAuctionId: auctionId }).toArray();
  for (const w of ws) {
    if (!w.maxBudget || newPrice <= w.maxBudget) continue;
    await cols.watches.updateOne({ _id: w._id }, { $set: { activeAutoBidAuctionId: null, status: 'paused', active: false } });
    const a = await cols.auctions.findOne({ _id: auctionId });
    const msg = a
      ? 'Outbid on "' + a.title + '". Price \u20B9' + newPrice.toLocaleString() + ' > budget \u20B9' + w.maxBudget.toLocaleString() + '.'
      : 'Outbid. Price \u20B9' + newPrice.toLocaleString() + ' is above your budget of \u20B9' + w.maxBudget.toLocaleString() + '.';
    try {
      await cols.notifications.insertOne({
        _id: new ObjectId(), userId, type: 'AUTO_BID_OUTBID',
        title: '\uD83D\uDCC9 Auto-Bid Budget Exhausted', message: msg,
        watchId: w._id, listingId: auctionId,
        payload: { watchId: w._id.toString(), auctionId: auctionId.toString(), newPrice, maxBudget: w.maxBudget },
        createdAt: new Date(),
      });
      eventHub.emitAll([{ type: 'AUTO_BID_OUTBID', targetUserId: userId, auctionId, payload: { watchId: w._id.toString(), newPrice, maxBudget: w.maxBudget } }]);
    } catch {}
  }
}

// ─── 8. Win: fulfill watch ────────────────────────────────────────────────────

export async function deactivateWatchesOnWin(db: Db, winnerId: ObjectId, auction: Auction): Promise<void> {
  const cols = getCollections(db);
  const now = new Date();
  const tl = auction.title.toLowerCase();
  const cl = (auction.category || '').toLowerCase();
  const ws = await cols.watches.find({ userId: winnerId, status: { $in: ['active', 'paused'] }, expiresAt: { $gt: now } }).toArray();
  for (const w of ws) {
    let m = false;
    if (w.category && w.category.toLowerCase() === cl) m = true;
    if (w.keywords && w.keywords.some((k) => tl.includes(k.toLowerCase()))) m = true;
    if (w.activeAutoBidAuctionId && w.activeAutoBidAuctionId.equals(auction._id)) m = true;
    if (!m) continue;
    await cols.watches.updateOne({ _id: w._id }, { $set: { status: 'fulfilled', active: false, activeAutoBidAuctionId: null, lastMatchedAt: now } });
    if (w.autoBid) {
      try {
        await cols.notifications.insertOne({
          _id: new ObjectId(), userId: winnerId, type: 'WATCH_FULFILLED',
          title: '\uD83C\uDFC6 Auto-Bid Won!',
          message: 'Your auto-bid watch fulfilled: won "' + auction.title + '" at \u20B9' + ((auction.currentPrice || 0)).toLocaleString() + '.',
          watchId: w._id, listingId: auction._id,
          payload: { watchId: w._id.toString(), auctionId: auction._id.toString(), title: auction.title, finalPrice: auction.currentPrice },
          createdAt: now,
        });
        eventHub.emitAll([{ type: 'WATCH_FULFILLED', targetUserId: winnerId, auctionId: auction._id, payload: { watchId: w._id.toString(), title: auction.title, finalPrice: auction.currentPrice } }]);
      } catch {}
    }
  }
}

// ─── 9. Hourly expiry ────────────────────────────────────────────────────────

export async function expireWatches(db: Db): Promise<number> {
  const cols = getCollections(db);
  const r = await cols.watches.updateMany({ status: { $in: ['active', 'paused'] }, expiresAt: { $lte: new Date() } }, { $set: { status: 'expired', active: false } });
  return r.modifiedCount;
}
