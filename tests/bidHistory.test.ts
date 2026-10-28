import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId, MongoClient, Db } from 'mongodb';
import { setupTestDatabase, teardownTestDatabase, clearDatabase } from './setup.js';
import { placeBid } from '../src/bidding/placeBid.js';
import { getCollections } from '../src/db.js';
import { Auction, User } from '../src/types.js';

describe('Live Bid History & Participants Verification', () => {
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

  it('stores accepted bids with timestamps, sorts newest first, and identifies leader', async () => {
    const collections = getCollections(db);
    const sellerId = new ObjectId();
    const bidder1Id = new ObjectId();
    const bidder2Id = new ObjectId();
    const auctionId = new ObjectId();

    // Create students
    const bidder1: User = {
      _id: bidder1Id,
      name: 'Priya Sharma',
      email: 'priya@campus.edu',
      role: 'buyer',
      sem: 4,
      department: 'ECE',
      createdAt: new Date(),
    };
    const bidder2: User = {
      _id: bidder2Id,
      name: 'Karthik Raja',
      email: 'karthik@campus.edu',
      role: 'buyer',
      sem: 6,
      department: 'CSE',
      createdAt: new Date(),
    };
    await collections.users.insertMany([bidder1, bidder2]);

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Lab Kit & Sensors',
      category: 'Electronics',
      description: 'Arduino kit with sensors and cables',
      condition: 'Like New',
      images: [],
      startPrice: 500,
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

    // Bidder 1 places first bid of 500
    const res1 = await placeBid(client, db, {
      auctionId,
      bidderId: bidder1Id,
      amount: 500,
      bidderRole: 'buyer',
    });
    expect(res1.ok).toBe(true);

    // Bidder 2 places second bid of 600
    const res2 = await placeBid(client, db, {
      auctionId,
      bidderId: bidder2Id,
      amount: 600,
      bidderRole: 'buyer',
    });
    expect(res2.ok).toBe(true);

    // Verify stored bids in DB
    const storedBids = await collections.bids
      .find({ auctionId })
      .sort({ serverTs: -1, _id: -1 })
      .toArray();

    expect(storedBids.length).toBe(2);
    // Newest first: 600 then 500
    expect(storedBids[0].amount).toBe(600);
    expect(storedBids[0].bidderId.equals(bidder2Id)).toBe(true);
    expect(storedBids[0].serverTs).toBeDefined();

    expect(storedBids[1].amount).toBe(500);
    expect(storedBids[1].bidderId.equals(bidder1Id)).toBe(true);

    // Verify auction authoritative state
    const updatedAuction = await collections.auctions.findOne({ _id: auctionId });
    expect(updatedAuction?.currentPrice).toBe(600);
    expect(updatedAuction?.leaderId?.equals(bidder2Id)).toBe(true);
    expect(updatedAuction?.bidCount).toBe(2);

    // Verify unique participants count
    const uniqueBidders = await collections.bids.distinct('bidderId', { auctionId });
    expect(uniqueBidders.length).toBe(2);
  });
});
