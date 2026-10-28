import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId, MongoClient, Db } from 'mongodb';
import { setupTestDatabase, teardownTestDatabase, clearDatabase } from './setup.js';
import { placeBid } from '../src/bidding/placeBid.js';
import { getCollections } from '../src/db.js';
import { Auction, AutoBid } from '../src/types.js';

describe('Auto-Bid Resolution within Transaction', () => {
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

  it('automatically places an outbid when a manual bid arrives and an auto-bidder has a higher cap', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();
    const manualBidderId = new ObjectId();
    const autoBidderId = new ObjectId();

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Noise Cancelling Headphones',
      category: 'Electronics',
      description: 'Over-ear headphones',
      condition: 'Excellent',
      images: [],
      startPrice: 500,
      maxPrice: 2000,
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

    // Register an auto-bid for autoBidderId with maxAmount = 800
    const autoBidDoc: AutoBid = {
      _id: new ObjectId(),
      auctionId,
      userId: autoBidderId,
      maxAmount: 800,
      createdAt: new Date(),
    };
    await collections.autoBids.insertOne(autoBidDoc);

    // Manual bidder places ₹500
    const result = await placeBid(client, db, {
      auctionId,
      bidderId: manualBidderId,
      amount: 500,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Manual bid was 500
      expect(result.bid.amount).toBe(500);
      expect(result.bid.bidderId.toString()).toBe(manualBidderId.toString());

      // Auto-bid was immediately triggered in the same transaction for 550 (500 + 50)
      expect(result.autoBidsPlaced.length).toBe(1);
      expect(result.autoBidsPlaced[0].amount).toBe(550);
      expect(result.autoBidsPlaced[0].bidderId.toString()).toBe(
        autoBidderId.toString()
      );
      expect(result.autoBidsPlaced[0].source).toBe('auto');

      // Final auction leader should be the auto-bidder at 550
      expect(result.auction.currentPrice).toBe(550);
      expect(result.auction.leaderId?.toString()).toBe(
        autoBidderId.toString()
      );
      expect(result.auction.bidCount).toBe(2); // 1 manual + 1 auto
    }

    // Verify stored bids in DB
    const bids = await collections.bids
      .find({ auctionId })
      .sort({ serverTs: 1, amount: 1 })
      .toArray();
    expect(bids.length).toBe(2);
    expect(bids[0].amount).toBe(500);
    expect(bids[1].amount).toBe(550);
  });

  it('resolves a proxy battle between two competing auto-bidders in a single transaction', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();
    const manualBidderId = new ObjectId();
    const autoBidderA = new ObjectId(); // Cap ₹700
    const autoBidderB = new ObjectId(); // Cap ₹900

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Gaming Monitor 144Hz',
      category: 'Electronics',
      description: '24 inch IPS',
      condition: 'Like New',
      images: [],
      startPrice: 400,
      maxPrice: 3000,
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

    // Register Auto-Bidder A: max 700
    await collections.autoBids.insertOne({
      _id: new ObjectId(),
      auctionId,
      userId: autoBidderA,
      maxAmount: 700,
      createdAt: new Date(Date.now() - 2000),
    });

    // Register Auto-Bidder B: max 900
    await collections.autoBids.insertOne({
      _id: new ObjectId(),
      auctionId,
      userId: autoBidderB,
      maxAmount: 900,
      createdAt: new Date(Date.now() - 1000),
    });

    // Manual bidder starts auction at 400
    const result = await placeBid(client, db, {
      auctionId,
      bidderId: manualBidderId,
      amount: 400,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Escalation sequence:
      // Manual: 400
      // Auto A & B fight: 450, 500, 550, 600, 650, 700 (A cap), 750 (B wins because A cannot exceed 700)
      expect(result.auction.currentPrice).toBe(750);
      expect(result.auction.leaderId?.toString()).toBe(autoBidderB.toString());
      expect(result.autoBidsPlaced.length).toBeGreaterThanOrEqual(2);
    }

    const allBids = await collections.bids
      .find({ auctionId })
      .sort({ amount: 1 })
      .toArray();

    // Verify progression
    expect(allBids[0].amount).toBe(400);
    const lastBid = allBids[allBids.length - 1];
    expect(lastBid.amount).toBe(750);
    expect(lastBid.bidderId.toString()).toBe(autoBidderB.toString());
  });

  it('stops auto-bidding when auction hits maxPrice', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();
    const manualBidderId = new ObjectId();
    const autoBidderId = new ObjectId();

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Rare Vinyl Record',
      category: 'Music',
      description: 'First pressing',
      condition: 'Mint',
      images: [],
      startPrice: 900,
      maxPrice: 1000, // Max price cap
      minIncrement: 100,
      currentPrice: null,
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() + 600000),
      version: 0,
      status: 'active',
      createdAt: new Date(),
    };
    await collections.auctions.insertOne(auctionDoc);

    // Auto-bidder with generous max of 5000 (well above auction maxPrice of 1000)
    await collections.autoBids.insertOne({
      _id: new ObjectId(),
      auctionId,
      userId: autoBidderId,
      maxAmount: 5000,
      createdAt: new Date(),
    });

    const result = await placeBid(client, db, {
      auctionId,
      bidderId: manualBidderId,
      amount: 900,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // 900 manual + 100 increment = 1000 (hits maxPrice cap)
      expect(result.auction.currentPrice).toBe(1000);
      expect(result.auction.leaderId?.toString()).toBe(
        autoBidderId.toString()
      );
      expect(result.autoBidsPlaced.length).toBe(1);
      expect(result.autoBidsPlaced[0].amount).toBe(1000);
    }
  });
});
