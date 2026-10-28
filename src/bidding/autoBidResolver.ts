import { Db, ClientSession, ObjectId } from 'mongodb';
import { Auction, Bid, AutoBid, OutboxEvent } from '../types.js';
import { getCollections } from '../db.js';
import { nextMinBid, calculateClosingTime } from './rules.js';

export interface AutoBidResolutionResult {
  autoBidsPlaced: Bid[];
  finalAuction: Auction;
}

/**
 * Resolves active auto-bids for an auction within the same database transaction.
 *
 * Iterates through competing auto-bidders whose maxAmount >= nextMinBid,
 * placing automated bids in sequence until equilibrium is reached
 * (i.e. no other auto-bidder can meet the next minimum increment or cap is reached).
 */
export async function resolveAutoBids(
  db: Db,
  session: ClientSession,
  auction: Auction,
  now: Date,
  outboxEvents: OutboxEvent[]
): Promise<AutoBidResolutionResult> {
  const collections = getCollections(db);
  const autoBidsPlaced: Bid[] = [];
  let currentAuction = { ...auction };

  // Fetch all auto-bids configured for this auction
  const configuredAutoBids = await collections.autoBids
    .find({ auctionId: currentAuction._id }, { session })
    .sort({ createdAt: 1 })
    .toArray();

  if (configuredAutoBids.length === 0) {
    return { autoBidsPlaced, finalAuction: currentAuction };
  }

  // Safety guard against runaway loops
  const MAX_AUTO_BID_ROUNDS = 200;
  let rounds = 0;

  while (rounds < MAX_AUTO_BID_ROUNDS) {
    rounds++;

    const min = nextMinBid({
      currentPrice: currentAuction.currentPrice,
      startPrice: currentAuction.startPrice,
      maxPrice: currentAuction.maxPrice,
      minIncrement: currentAuction.minIncrement,
    });

    if (min === null) {
      // Auction reached max price or locked
      break;
    }

    // Find eligible auto-bidders who are not currently the leader and have cap >= min
    const eligibleAutoBids = configuredAutoBids.filter(
      (ab) =>
        !ab.userId.equals(currentAuction.leaderId as ObjectId) &&
        ab.maxAmount >= min
    );

    if (eligibleAutoBids.length === 0) {
      // No competitor can match nextMinBid
      break;
    }

    // Pick candidate: highest maxAmount, tie-broken by earliest createdAt
    eligibleAutoBids.sort((a, b) => {
      if (b.maxAmount !== a.maxAmount) {
        return b.maxAmount - a.maxAmount;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const chosenAutoBid = eligibleAutoBids[0];
    const previousLeaderId = currentAuction.leaderId;
    const { closesAt: nextClosesAt, extended } = calculateClosingTime(
      currentAuction.closesAt,
      now
    );

    const autoBidDoc: Bid = {
      _id: new ObjectId(),
      auctionId: currentAuction._id,
      bidderId: chosenAutoBid.userId,
      amount: min,
      serverTs: now,
      source: 'auto',
    };

    // Insert auto-bid
    await collections.bids.insertOne(autoBidDoc, { session });

    // Update auction document with version check
    const updateResult = await collections.auctions.updateOne(
      { _id: currentAuction._id, version: currentAuction.version },
      {
        $set: {
          currentPrice: min,
          leaderId: chosenAutoBid.userId,
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
      throw new Error(`WriteConflict: Version mismatch during auto-bid round ${rounds}`);
    }

    // Update in-memory state for subsequent iterations
    currentAuction.currentPrice = min;
    currentAuction.leaderId = chosenAutoBid.userId;
    currentAuction.closesAt = nextClosesAt;
    currentAuction.version += 1;
    currentAuction.bidCount += 1;

    autoBidsPlaced.push(autoBidDoc);

    // Queue outbox events for post-commit broadcast
    outboxEvents.push({
      type: 'AUTO_BID_TRIGGERED',
      targetUserId: chosenAutoBid.userId,
      auctionId: currentAuction._id,
      payload: {
        bidId: autoBidDoc._id,
        amount: min,
        serverTs: now,
      },
    });

    if (previousLeaderId && !previousLeaderId.equals(chosenAutoBid.userId)) {
      outboxEvents.push({
        type: 'OUTBID',
        targetUserId: previousLeaderId,
        auctionId: currentAuction._id,
        payload: {
          newPrice: min,
          outbidBy: chosenAutoBid.userId,
        },
      });
    }

    if (extended) {
      outboxEvents.push({
        type: 'DEADLINE_EXTENDED',
        auctionId: currentAuction._id,
        payload: {
          newClosesAt: nextClosesAt,
          extendedByMs: 60_000,
        },
      });
    }

    // If auction reached maxPrice, terminate immediately
    if (min >= currentAuction.maxPrice) {
      outboxEvents.push({
        type: 'AUCTION_MAX_REACHED',
        auctionId: currentAuction._id,
        payload: {
          finalPrice: min,
          winnerId: chosenAutoBid.userId,
        },
      });
      break;
    }
  }

  return { autoBidsPlaced, finalAuction: currentAuction };
}
