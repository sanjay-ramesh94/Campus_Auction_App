import { Db, ObjectId } from 'mongodb';
import { getCollections } from './db.js';
import { eventHub } from './bidding/events.js';

export function startAuctionSweeper(db: Db, intervalMs: number = 5000): () => void {
  const cols = getCollections(db);

  const sweep = async () => {
    try {
      const now = new Date();
      const expired = await cols.auctions
        .find({
          status: 'active',
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
                status: 'pending_approval',
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
            payload: { auctionId: a._id, amount: a.currentPrice, winnerId: a.leaderId },
            createdAt: now,
          });

          // Winner notification
          await cols.notifications.insertOne({
            _id: new ObjectId(),
            userId: a.leaderId,
            type: 'AUCTION_WON_PENDING',
            title: 'You Won the Auction!',
            message: `Your bid of ₹${a.currentPrice} is the highest for "${a.title}". Waiting for seller approval.`,
            payload: { auctionId: a._id, amount: a.currentPrice },
            createdAt: now,
          });

          await eventHub.emitAll([
            {
              type: 'AUCTION_ENDED',
              targetUserId: a.sellerId,
              auctionId: a._id,
              payload: { status: 'pending_approval', finalPrice: a.currentPrice, winnerId: a.leaderId },
            },
          ]);
        } else {
          // No bids placed -> unsold
          await cols.auctions.updateOne(
            { _id: a._id, version: a.version },
            {
              $set: {
                status: 'unsold',
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

  return () => clearInterval(timer);
}
