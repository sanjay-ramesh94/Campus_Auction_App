import { MongoClient, Db, ClientSession, MongoServerError, ObjectId } from 'mongodb';
import {
  PlaceBidParams,
  BidResult,
  Bid,
  Auction,
  OutboxEvent,
} from '../types.js';
import { getCollections, Collections } from '../db.js';
import { nextMinBid, calculateClosingTime } from './rules.js';
import { resolveAutoBids } from './autoBidResolver.js';
import { eventHub } from './events.js';

let cachedIsReplicaSet: boolean | null = null;

async function checkIsReplicaSet(client: MongoClient): Promise<boolean> {
  if (cachedIsReplicaSet !== null) return cachedIsReplicaSet;
  try {
    const isMaster = await client.db('admin').command({ isMaster: 1 });
    cachedIsReplicaSet = Boolean(isMaster.setName || isMaster.msg === 'isdbgrid');
  } catch {
    cachedIsReplicaSet = false;
  }
  return cachedIsReplicaSet;
}

async function executeBidStep(
  collections: Collections,
  db: Db,
  session: ClientSession | null,
  params: PlaceBidParams,
  pendingOutboxEvents: OutboxEvent[]
): Promise<BidResult> {
  const { auctionId, bidderId, amount, idempotencyKey } = params;
  const sessOpt = session ? { session } : {};

  // 1. Idempotency replay check
  if (idempotencyKey) {
    const dupBid = await collections.bids.findOne(
      { bidderId, idempotencyKey },
      sessOpt
    );
    if (dupBid) {
      const currentAuction = await collections.auctions.findOne(
        { _id: auctionId },
        sessOpt
      );
      return {
        ok: true,
        replay: true,
        bid: dupBid,
        auction: currentAuction as Auction,
        autoBidsPlaced: [],
        extendedDeadline: false,
      };
    }
  }

  // 2. Fresh read of the auction
  const a = await collections.auctions.findOne(
    { _id: auctionId },
    sessOpt
  );

  const now = new Date();

  if (!a) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (a.status !== 'active') {
    return { ok: false, reason: 'NOT_ACTIVE' };
  }
  if (now.getTime() >= a.closesAt.getTime()) {
    return { ok: false, reason: 'CLOSED' };
  }
  if (params.bidderRole === 'seller') {
    return { ok: false, reason: 'SELLER_CANNOT_BID' };
  }
  if (a.sellerId.equals(bidderId)) {
    return { ok: false, reason: 'OWN_ITEM' };
  }

  const min = nextMinBid({
    currentPrice: a.currentPrice,
    startPrice: a.startPrice,
    maxPrice: a.maxPrice,
    minIncrement: a.minIncrement,
  });

  if (min === null) {
    return { ok: false, reason: 'MAX_REACHED' };
  }
  if (amount < min || amount > a.maxPrice) {
    return {
      ok: false,
      reason: 'TOO_LOW_OR_STALE',
      details: { nextMin: min, maxPrice: a.maxPrice },
    };
  }

  // 3. Anti-sniping calculation
  const { closesAt: nextClosesAt, extended } = calculateClosingTime(
    a.closesAt,
    now
  );

  // 4. Record accepted bid (manual)
  const bidDoc: Bid = {
    _id: new ObjectId(),
    auctionId,
    bidderId,
    amount,
    serverTs: now,
    createdAt: now,
    source: 'manual',
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };

  try {
    await collections.bids.insertOne(bidDoc, sessOpt);
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000 && idempotencyKey) {
      const existing = await collections.bids.findOne(
        { bidderId, idempotencyKey },
        sessOpt
      );
      if (existing) {
        return {
          ok: true,
          replay: true,
          bid: existing,
          auction: a,
          autoBidsPlaced: [],
          extendedDeadline: false,
        };
      }
    }
    throw err;
  }

  // 5. Update auction document with optimistic concurrency check on version
  const previousLeaderId = a.leaderId;
  const updateResult = await collections.auctions.updateOne(
    { _id: a._id, version: a.version },
    {
      $set: {
        currentPrice: amount,
        leaderId: bidderId,
        closesAt: nextClosesAt,
      },
      $inc: {
        version: 1,
        bidCount: 1,
      },
    },
    sessOpt
  );

  if (updateResult.matchedCount === 0) {
    throw new Error(`WriteConflict: Auction ${a._id} version mismatch`);
  }

  const updatedAuction: Auction = {
    ...a,
    currentPrice: amount,
    leaderId: bidderId,
    closesAt: nextClosesAt,
    version: a.version + 1,
    bidCount: a.bidCount + 1,
  };

  // Queue initial manual bid events
  pendingOutboxEvents.push({
    type: 'BID_PLACED',
    targetUserId: bidderId,
    auctionId,
    payload: {
      bidId: bidDoc._id,
      amount,
      serverTs: now,
    },
  });

  if (previousLeaderId && !previousLeaderId.equals(bidderId)) {
    pendingOutboxEvents.push({
      type: 'OUTBID',
      targetUserId: previousLeaderId,
      auctionId,
      payload: {
        newPrice: amount,
        outbidBy: bidderId,
      },
    });
  }

  if (extended) {
    pendingOutboxEvents.push({
      type: 'DEADLINE_EXTENDED',
      auctionId,
      payload: {
        newClosesAt: nextClosesAt,
        extendedByMs: 60_000,
      },
    });
  }

  if (amount >= a.maxPrice) {
    pendingOutboxEvents.push({
      type: 'AUCTION_MAX_REACHED',
      auctionId,
      payload: {
        finalPrice: amount,
        winnerId: bidderId,
      },
    });
  }

  // 6. Auto-bid resolver loop
  const { autoBidsPlaced, finalAuction } = await resolveAutoBids(
    db,
    session,
    updatedAuction,
    now,
    pendingOutboxEvents
  );

  return {
    ok: true,
    replay: false,
    bid: bidDoc,
    auction: finalAuction,
    autoBidsPlaced,
    extendedDeadline: extended,
  };
}

/**
 * Places a bid on an auction.
 * Supports BOTH:
 * 1. Multi-document ACID transactions (when running on a replica set or Atlas).
 * 2. Standalone atomic optimistic concurrency (when running on normal standalone MongoDB).
 */
export async function placeBid(
  client: MongoClient,
  db: Db,
  params: PlaceBidParams
): Promise<BidResult> {
  const collections = getCollections(db);
  const pendingOutboxEvents: OutboxEvent[] = [];
  let committedResult: BidResult | null = null;

  const isRS = await checkIsReplicaSet(client);

  if (isRS) {
    // Run in multi-document ACID transaction
    const session = client.startSession();
    try {
      committedResult = await session.withTransaction(async () => {
        pendingOutboxEvents.length = 0;
        return executeBidStep(collections, db, session, params, pendingOutboxEvents);
      });
    } finally {
      await session.endSession();
    }
  } else {
    // Standalone normal MongoDB: optimistic CAS version retry loop
    const MAX_RETRIES = 5;
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      attempt++;
      pendingOutboxEvents.length = 0;
      try {
        committedResult = await executeBidStep(collections, db, null, params, pendingOutboxEvents);
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('WriteConflict') && attempt < MAX_RETRIES) {
          continue;
        }
        throw err;
      }
    }
  }

  // Post-commit event emission: fire SSE & browser push AFTER bid resolves
  if (committedResult && committedResult.ok && pendingOutboxEvents.length > 0) {
    await eventHub.emitAll(pendingOutboxEvents);
  }

  return committedResult!;
}
