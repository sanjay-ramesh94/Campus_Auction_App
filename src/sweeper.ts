import { Db, ObjectId } from 'mongodb';
import { getCollections } from './db.js';
import { eventHub } from './bidding/events.js';
import { deactivateWatchesOnWin, handleWatchOutbid, expireWatches } from './assistant/watchService.js';

export function startAuctionSweeper(db: Db, intervalMs: number = 5000): () => void {
  const cols = getCollections(db);

  const sweep = async () => {
    try {
      const now = new Date();
      const expired = await cols.auctions
        .find({
          status: { $in: ['active', 'live'] },
          closesAt: { $lte: now },
        })
        .toArray();

      for (const a of expired) {
        if (a.bidCount > 0 && a.leaderId) {
          // Find the highest winning bid
          const winningBid = await cols.bids.findOne(
            { auctionId: a._id },
            { sort: { amount: -1 } }
          );

          await cols.auctions.updateOne(
            { _id: a._id, version: a.version },
            {
              $set: {
                status: 'closed_sold',
                winningBidId: winningBid?._id,
                winnerId: a.leaderId,
                updatedAt: now,
              },
              $inc: { version: 1 },
            }
          );

          // Seller notification
          await cols.notifications.insertOne({
            _id: new ObjectId(),
            userId: a.sellerId,
            type: 'AUCTION_ENDED_SELLER',
            title: 'Auction Ended — Action Required',
            message: `"${a.title}" closed with winning bid ₹${a.currentPrice}. Please approve or reject the outcome.`,
            payload: { auctionId: a._id, amount: a.currentPrice, winnerId: a.leaderId, title: a.title },
            createdAt: now,
          });

          // Winner notification
          await cols.notifications.insertOne({
            _id: new ObjectId(),
            userId: a.leaderId,
            type: 'AUCTION_WON',
            title: '🏆 You Won the Auction!',
            message: `Congratulations! Your bid of ₹${a.currentPrice} is the highest winning bid for "${a.title}". Waiting for seller pickup approval.`,
            payload: { auctionId: a._id, amount: a.currentPrice, title: a.title },
            createdAt: now,
          });

          // Deactivate any matching active watch for the winning student
          await deactivateWatchesOnWin(db, a.leaderId, a);

          // Notify all other bidders that the auction has ended and they were outbid
          const outbidBids = await cols.bids
            .find({ auctionId: a._id, bidderId: { $ne: a.leaderId } })
            .toArray();
          const uniqueOutbidIds = Array.from(new Set(outbidBids.map((b) => b.bidderId.toString()))).map((id) => new ObjectId(id));

          for (const loserId of uniqueOutbidIds) {
            await cols.notifications.insertOne({
              _id: new ObjectId(),
              userId: loserId,
              type: 'AUCTION_LOST',
              title: '⏱️ Auction Ended — Outbid',
              message: `"${a.title}" has closed. Another student placed the winning bid of ₹${a.currentPrice}.`,
              payload: { auctionId: a._id, finalPrice: a.currentPrice, title: a.title },
              createdAt: now,
            });
          }

          // Emit real-time SSE push notifications for Seller, Winner, and Losers
          const eventsToEmit: any[] = [
            {
              type: 'AUCTION_ENDED',
              targetUserId: a.sellerId,
              auctionId: a._id,
              payload: { status: 'pending_approval', finalPrice: a.currentPrice, winnerId: a.leaderId, title: a.title },
            },
            {
              type: 'AUCTION_WON',
              targetUserId: a.leaderId,
              auctionId: a._id,
              payload: {
                status: 'won',
                finalPrice: a.currentPrice,
                amount: a.currentPrice,
                title: a.title,
                message: `Congratulations! Your bid of ₹${a.currentPrice} won "${a.title}"!`,
              },
            },
          ];

          for (const loserId of uniqueOutbidIds) {
            eventsToEmit.push({
              type: 'AUCTION_LOST',
              targetUserId: loserId,
              auctionId: a._id,
              payload: {
                status: 'lost',
                finalPrice: a.currentPrice,
                title: a.title,
                message: `Auction for "${a.title}" ended. You were outbid.`,
              },
            });
          }

          await eventHub.emitAll(eventsToEmit);
        } else {
          // No bids placed -> unsold
          await cols.auctions.updateOne(
            { _id: a._id, version: a.version },
            {
              $set: {
                status: 'closed_unsold',
                outcomeReason: 'No bids received prior to deadline',
                updatedAt: now,
              },
              $inc: { version: 1 },
            }
          );

          await cols.notifications.insertOne({
            _id: new ObjectId(),
            userId: a.sellerId,
            type: 'AUCTION_UNSOLD',
            title: 'Auction Closed Unsold',
            message: `"${a.title}" reached its deadline without any bids.`,
            payload: { auctionId: a._id },
            createdAt: now,
          });

          await eventHub.emitAll([
            {
              type: 'AUCTION_ENDED',
              targetUserId: a.sellerId,
              auctionId: a._id,
              payload: { status: 'unsold' },
            },
          ]);
        }
      }
    } catch (err) {
      console.error('[Sweeper] Error in sweep cycle:', err);
    }
  };

  const timer = setInterval(sweep, intervalMs);
  sweep(); // Run immediately on start

  // Hourly watch expiry sweep
  const expireTimer = setInterval(async () => {
    try {
      const count = await expireWatches(db);
      if (count > 0) console.log('[Sweeper] Expired', count, 'watches.');
    } catch (err) {
      console.error('[Sweeper] Watch expiry error:', err);
    }
  }, 60 * 60 * 1000);

  return () => { clearInterval(timer); clearInterval(expireTimer); };
}
