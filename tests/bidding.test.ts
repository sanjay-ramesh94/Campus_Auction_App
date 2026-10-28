import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId, MongoClient, Db } from 'mongodb';
import { setupTestDatabase, teardownTestDatabase, clearDatabase } from './setup.js';
import { placeBid } from '../src/bidding/placeBid.js';
import { getCollections } from '../src/db.js';
import { Auction } from '../src/types.js';

describe('Bidding Business Logic & Rules', () => {
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

  it('rejects a bid if the bidder is the seller (OWN_ITEM)', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Course Textbook',
      category: 'Books',
      description: 'Computer Architecture textbook',
      condition: 'Good',
      images: [],
      startPrice: 300,
      maxPrice: 1500,
      minIncrement: 50,
      currentPrice: null,
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() + 600000),
      version: 0,
      status: 'active',
      createdAt: new Date(),
    };
    await collections.auctions.insertOne(auctionDoc);

    const result = await placeBid(client, db, {
      auctionId,
      bidderId: sellerId, // Seller trying to bid on their own item
      amount: 300,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('OWN_ITEM');
    }
  });

  it('rejects a bid if auction is closed or deadline has passed (CLOSED)', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();

    // Already expired in the past
    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Dorm Fan',
      category: 'Appliances',
      description: 'Desk fan',
      condition: 'Used',
      images: [],
      startPrice: 100,
      maxPrice: 500,
      minIncrement: 20,
      currentPrice: 100,
      leaderId: new ObjectId(),
      bidCount: 1,
      closesAt: new Date(Date.now() - 5000), // 5 seconds ago
      version: 1,
      status: 'active',
      createdAt: new Date(),
    };
    await collections.auctions.insertOne(auctionDoc);

    const bidderId = new ObjectId();
    const result = await placeBid(client, db, {
      auctionId,
      bidderId,
      amount: 120,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('CLOSED');
    }
  });

  it('rejects a bid if status is cancelled (NOT_ACTIVE)', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Desk Lamp',
      category: 'Furniture',
      description: 'Study lamp',
      condition: 'Good',
      images: [],
      startPrice: 150,
      maxPrice: 600,
      minIncrement: 25,
      currentPrice: null,
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() + 600000),
      version: 0,
      status: 'cancelled', // Seller cancelled
      createdAt: new Date(),
    };
    await collections.auctions.insertOne(auctionDoc);

    const bidderId = new ObjectId();
    const result = await placeBid(client, db, {
      auctionId,
      bidderId,
      amount: 150,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('NOT_ACTIVE');
    }
  });

  it('handles anti-sniping extension when bid arrives within last 30 seconds', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();
    const initialClosesAt = new Date(Date.now() + 15_000); // 15 seconds remaining (within 30s window)

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Mechanical Keyboard',
      category: 'Electronics',
      description: 'Blue switches',
      condition: 'Like New',
      images: [],
      startPrice: 800,
      maxPrice: 3000,
      minIncrement: 50,
      currentPrice: 800,
      leaderId: new ObjectId(),
      bidCount: 1,
      closesAt: initialClosesAt,
      version: 1,
      status: 'active',
      createdAt: new Date(),
    };
    await collections.auctions.insertOne(auctionDoc);

    const bidderId = new ObjectId();
    const result = await placeBid(client, db, {
      auctionId,
      bidderId,
      amount: 850,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extendedDeadline).toBe(true);
      expect(result.auction.closesAt.getTime()).toBeGreaterThan(
        initialClosesAt.getTime()
      );
      // Deadline extended by ~60 seconds from now
      const timeRemainingMs = result.auction.closesAt.getTime() - Date.now();
      expect(timeRemainingMs).toBeGreaterThanOrEqual(55_000);
      expect(timeRemainingMs).toBeLessThanOrEqual(65_000);
    }
  });

  it('guarantees idempotency replay on duplicate idempotencyKey', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();
    const bidderId = new ObjectId();
    const idempotencyKey = 'unique-key-abc-123';

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Bicycle Helmet',
      category: 'Sports',
      description: 'Size M',
      condition: 'Good',
      images: [],
      startPrice: 200,
      maxPrice: 800,
      minIncrement: 20,
      currentPrice: null,
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() + 600000),
      version: 0,
      status: 'active',
      createdAt: new Date(),
    };
    await collections.auctions.insertOne(auctionDoc);

    // First attempt: succeeds
    const firstAttempt = await placeBid(client, db, {
      auctionId,
      bidderId,
      amount: 200,
      idempotencyKey,
    });

    expect(firstAttempt.ok).toBe(true);
    if (firstAttempt.ok) {
      expect(firstAttempt.replay).toBeFalsy();
    }

    // Second attempt with identical idempotencyKey: returns original bid as replay
    const secondAttempt = await placeBid(client, db, {
      auctionId,
      bidderId,
      amount: 200,
      idempotencyKey,
    });

    expect(secondAttempt.ok).toBe(true);
    if (secondAttempt.ok) {
      expect(secondAttempt.replay).toBe(true);
      if (firstAttempt.ok) {
        expect(secondAttempt.bid._id.toString()).toBe(
          firstAttempt.bid._id.toString()
        );
      }
    }

    // Bids collection must only contain 1 document
    const bids = await collections.bids.find({ auctionId }).toArray();
    expect(bids.length).toBe(1);

    // Auction bidCount should still be 1
    const auction = await collections.auctions.findOne({ _id: auctionId });
    expect(auction?.bidCount).toBe(1);
    expect(auction?.version).toBe(1);
  });
});
