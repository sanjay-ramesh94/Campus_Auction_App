import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId, MongoClient, Db } from 'mongodb';
import { setupTestDatabase, teardownTestDatabase, clearDatabase } from './setup.js';
import { placeBid } from '../src/bidding/placeBid.js';
import { getCollections } from '../src/db.js';
import { Auction } from '../src/types.js';

describe('Concurrency Mechanism in MongoDB Transactions', () => {
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

  it('fires 20 parallel placeBid calls with the same amount and asserts exactly 1 accepted bid and 1 bid document', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Graphing Calculator Ti-84',
      category: 'Electronics',
      description: 'Used for semester 1 math course',
      condition: 'Like New',
      images: ['https://example.com/calc.jpg'],
      startPrice: 500,
      maxPrice: 2000,
      minIncrement: 20,
      currentPrice: null, // First bid can be 500
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() + 10 * 60 * 1000), // 10 mins from now
      version: 0,
      status: 'active',
      createdAt: new Date(),
    };

    await collections.auctions.insertOne(auctionDoc);

    // Fire 20 parallel placeBid calls with identical amount (₹500) from 20 distinct bidders
    const bidderCount = 20;
    const bidPromises = Array.from({ length: bidderCount }, (_, i) => {
      const bidderId = new ObjectId();
      return placeBid(client, db, {
        auctionId,
        bidderId,
        amount: 500,
        idempotencyKey: `idempotency-same-amount-${i}`,
      });
    });

    const results = await Promise.all(bidPromises);

    const successfulBids = results.filter((r) => r.ok === true);
    const rejectedBids = results.filter((r) => r.ok === false);

    // Exactly 1 must succeed
    expect(successfulBids.length).toBe(1);
    // The other 19 must be rejected due to price being stale/too low
    expect(rejectedBids.length).toBe(19);

    for (const rejected of rejectedBids) {
      if (!rejected.ok) {
        expect(rejected.reason).toBe('TOO_LOW_OR_STALE');
        // On retry, each rejected bid saw that the next required min is 520 (500 + 20)
        expect(rejected.details?.nextMin).toBe(520);
      }
    }

    // Verify database state: exactly 1 bid document in the collection
    const storedBids = await collections.bids.find({ auctionId }).toArray();
    expect(storedBids.length).toBe(1);
    expect(storedBids[0].amount).toBe(500);

    // Verify auction document state
    const finalAuction = await collections.auctions.findOne({ _id: auctionId });
    expect(finalAuction).not.toBeNull();
    expect(finalAuction?.currentPrice).toBe(500);
    expect(finalAuction?.bidCount).toBe(1);
    expect(finalAuction?.version).toBe(1);
    expect(finalAuction?.leaderId?.toString()).toBe(
      storedBids[0].bidderId.toString()
    );
  });

  it('serializes concurrent escalating bids correctly through write conflicts', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Lab Coat & Safety Goggles',
      category: 'Supplies',
      description: 'Chemistry lab package',
      condition: 'Good',
      images: [],
      startPrice: 200,
      maxPrice: 1000,
      minIncrement: 50,
      currentPrice: 200,
      leaderId: new ObjectId(),
      bidCount: 1,
      closesAt: new Date(Date.now() + 10 * 60 * 1000),
      version: 1,
      status: 'active',
      createdAt: new Date(),
    };

    await collections.auctions.insertOne(auctionDoc);

    // Bidders submit: 250, 300, 350, 400 concurrently
    const bidsToPlace = [250, 300, 350, 400];
    const promises = bidsToPlace.map((amount) => {
      const bidderId = new ObjectId();
      return placeBid(client, db, {
        auctionId,
        bidderId,
        amount,
        idempotencyKey: `escalating-${amount}`,
      });
    });

    const results = await Promise.all(promises);

    // Check bids stored in database
    const storedBids = await collections.bids
      .find({ auctionId })
      .sort({ serverTs: 1, amount: 1 })
      .toArray();

    // At least the highest bid (400) or serialized valid bids must be recorded
    const finalAuction = await collections.auctions.findOne({ _id: auctionId });
    expect(finalAuction?.currentPrice).toBeGreaterThanOrEqual(250);
    expect(finalAuction?.currentPrice).toBeLessThanOrEqual(400);

    // Verify version and bidCount matches accepted bids
    const manualBids = storedBids.filter((b) => b.source === 'manual');
    expect(finalAuction?.bidCount).toBe(1 + manualBids.length);
  });
});
