import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId, MongoClient, Db } from 'mongodb';
import { setupTestDatabase, teardownTestDatabase, clearDatabase } from './setup.js';
import { getCollections } from '../src/db.js';
import { Auction } from '../src/types.js';
import { startAuctionSweeper } from '../src/sweeper.js';
import { eventHub } from '../src/bidding/events.js';

describe('Won & Lost Bids and Notifications', () => {
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    const context = await setupTestDatabase();
    client = context.client;
    db = context.db;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  it('sweeper creates AUCTION_WON and AUCTION_LOST notifications and emits SSE events', async () => {
    const cols = getCollections(db);
    const sellerId = new ObjectId();
    const winnerId = new ObjectId();
    const loserId = new ObjectId();
    const auctionId = new ObjectId();

    // Expired auction with winner
    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Lab Kit & Arduino',
      category: 'Electronics',
      description: 'Used for ECE lab',
      condition: 'Like New',
      images: ['https://example.com/kit.jpg'],
      startPrice: 500,
      maxPrice: 2000,
      minIncrement: 50,
      currentPrice: 800,
      leaderId: winnerId,
      bidCount: 3,
      closesAt: new Date(Date.now() - 1000), // Already expired
      version: 3,
      status: 'active',
      createdAt: new Date(),
    };
    await cols.auctions.insertOne(auctionDoc);

    // Loser placed bid earlier at 600
    await cols.bids.insertOne({
      _id: new ObjectId(),
      auctionId,
      bidderId: loserId,
      amount: 600,
      serverTs: new Date(Date.now() - 60000),
      source: 'manual',
    });

    // Winner placed winning bid at 800
    await cols.bids.insertOne({
      _id: new ObjectId(),
      auctionId,
      bidderId: winnerId,
      amount: 800,
      serverTs: new Date(Date.now() - 30000),
      source: 'manual',
    });

    // Capture emitted events
    const emittedEvents: any[] = [];
    const unsub = eventHub.subscribe((evt) => {
      emittedEvents.push(evt);
    });

    // Run sweeper with small interval and stop it
    const stopSweeper = startAuctionSweeper(db, 100);
    // Wait 250ms for sweeper cycle to complete
    await new Promise((resolve) => setTimeout(resolve, 250));
    stopSweeper();
    unsub();

    // Verify auction status transitioned to closed_sold
    const updatedAuction = await cols.auctions.findOne({ _id: auctionId });
    expect(updatedAuction?.status).toBe('closed_sold');
    expect(updatedAuction?.winnerId?.toString()).toBe(winnerId.toString());

    // Verify MongoDB notifications
    const winnerNotif = await cols.notifications.findOne({ userId: winnerId, type: 'AUCTION_WON' });
    expect(winnerNotif).toBeDefined();
    expect(winnerNotif?.title).toContain('Won the Auction');

    const loserNotif = await cols.notifications.findOne({ userId: loserId, type: 'AUCTION_LOST' });
    expect(loserNotif).toBeDefined();
    expect(loserNotif?.title).toContain('Auction Ended');

    // Verify SSE Events emitted
    const wonEvent = emittedEvents.find((e) => e.type === 'AUCTION_WON');
    expect(wonEvent).toBeDefined();
    expect(wonEvent.targetUserId.toString()).toBe(winnerId.toString());
    expect(wonEvent.payload?.finalPrice).toBe(800);

    const lostEvent = emittedEvents.find((e) => e.type === 'AUCTION_LOST');
    expect(lostEvent).toBeDefined();
    expect(lostEvent.targetUserId.toString()).toBe(loserId.toString());
  });
});
