import { MongoClient, Db, MongoServerError, ObjectId } from 'mongodb';
import {
  PlaceBidParams,
  BidResult,
  Bid,
  Auction,
  OutboxEvent,
} from '../types.js';
import { getCollections } from '../db.js';
import { nextMinBid, calculateClosingTime } from './rules.js';
import { resolveAutoBids } from './autoBidResolver.js';
import { eventHub } from './events.js';

/**
 * Places a bid on an auction using a MongoDB multi-document ACID transaction.
 *
 * Serialization:
 * The auction document is the sole serialization point. Two competing bids on
 * the same auction document will trigger a WriteConflict on the auction version/update,
 * causing session.withTransaction() to automatically re-read fresh state and re-evaluate.
 *
 * Side Effects:
 * All outbox events (SSE notifications, outbid alerts, extensions) are queued and
 * emitted strictly AFTER the transaction commits successfully.
 */
export async function placeBid(
  client: MongoClient,
  db: Db,
  params: PlaceBidParams
): Promise<BidResult> {
  const { auctionId, bidderId, amount, idempotencyKey } = params;
  const collections = getCollections(db);
  const session = client.startSession();

  let committedResult: BidResult | null = null;
  const pendingOutboxEvents: OutboxEvent[] = [];

  try {
    committedResult = await session.withTransaction(async () => {
      // Clear any events from a previous retried attempt
      pendingOutboxEvents.length = 0;

      // 1. Idempotency replay check inside transaction
      if (idempotencyKey) {
        const dupBid = await collections.bids.findOne(
          { bidderId, idempotencyKey },
          { session }
        );
        if (dupBid) {
          const currentAuction = await collections.auctions.findOne(
            { _id: auctionId },
            { session }
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

      // 2. Fresh read of the auction inside the transaction
      const a = await collections.auctions.findOne(
        { _id: auctionId },
        { session }
      );

      // Server-authoritative time only
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
        source: 'manual',
        ...(idempotencyKey ? { idempotencyKey } : {}),
      };

      try {
        await collections.bids.insertOne(bidDoc, { session });
      } catch (err) {
        if (err instanceof MongoServerError && err.code === 11000 && idempotencyKey) {
          // Concurrent insert with exact same idempotency key succeeded
          const existing = await collections.bids.findOne(
            { bidderId, idempotencyKey },
            { session }
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

      // Update auction document with optimistic concurrency check on version
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
        { session }
      );

      if (updateResult.matchedCount === 0) {
        // Trigger transaction retry due to concurrent update
        throw new Error(`WriteConflict: Auction ${a._id} version mismatch`);
      }

      // Reflect updates in local copy for auto-bid resolver
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

      // 5. Auto-bid resolver loop (same transaction, same validation)
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
    });
  } finally {
    await session.endSession();
  }

  // 6. Post-commit event emission: fire SSE & browser push AFTER transaction resolves
  if (committedResult && committedResult.ok && pendingOutboxEvents.length > 0) {
    await eventHub.emitAll(pendingOutboxEvents);
  }

  return committedResult;
}
