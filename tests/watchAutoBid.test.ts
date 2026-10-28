import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId, MongoClient, Db } from 'mongodb';
import { setupTestDatabase, teardownTestDatabase, clearDatabase } from './setup.js';
import { getCollections } from '../src/db.js';
import { Auction } from '../src/types.js';
import {
  createWatch,
  matchWatchesForNewListing,
  handleWatchOutbid,
  deactivateWatchesOnWin,
} from '../src/assistant/watchService.js';

describe('Saved Watches & Automated Proxy Bidding', () => {
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

  it('rejects auto-bid watch if authorizedAt is missing', async () => {
    const userId = new ObjectId();
    const res = await createWatch(db, userId, {
      keywords: ['casio', 'calculator'],
      autoBid: true,
      maxBudget: 400,
    }); // no authorizedAt passed

    expect(res.ok).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.error).toContain('explicit authorization');
  });

  it('creates an authorized auto-bid watch and enforces budget and limits', async () => {
    const userId = new ObjectId();
    const authorizedAt = new Date();

    const res = await createWatch(
      db,
      userId,
      {
        keywords: ['casio', 'calculator'],
        category: 'Electronics',
        autoBid: true,
        maxBudget: 400,
      },
      authorizedAt
    );

    expect(res.ok).toBe(true);
    expect(res.statusCode).toBe(201);
    expect(res.data!.autoBid).toBe(true);
    expect(res.data!.maxBudget).toBe(400);
    expect(res.data!.status).toBe('active');
  });

  it('enforces maximum 3 auto-bid watches limit per user', async () => {
    const userId = new ObjectId();
    const authDate = new Date();

    // Create 3 auto-bid watches
    for (let i = 1; i <= 3; i++) {
      const r = await createWatch(
        db,
        userId,
        { keywords: [`item${i}`], autoBid: true, maxBudget: 500 },
        authDate
      );
      expect(r.ok).toBe(true);
    }

    // 4th auto-bid watch must be rejected
    const r4 = await createWatch(
      db,
      userId,
      { keywords: ['item4'], autoBid: true, maxBudget: 500 },
      authDate
    );
    expect(r4.ok).toBe(false);
    expect(r4.statusCode).toBe(400);
    expect(r4.error).toContain('at most 3 active auto-bid');
  });

  it('places a proxy auto-bid when a matching listing is published', async () => {
    const buyerId = new ObjectId();
    const sellerId = new ObjectId();
    const authDate = new Date();

    // Buyer sets a watch for scientific calculator under 400
    const watchRes = await createWatch(
      db,
      buyerId,
      {
        keywords: ['scientific', 'calculator'],
        category: 'Electronics',
        autoBid: true,
        maxBudget: 400,
      },
      authDate
    );
    expect(watchRes.ok).toBe(true);

    // Seller lists a Casio Scientific Calculator starting at 200 (maxPrice 1000)
    const auctionDoc: Auction = {
      _id: new ObjectId(),
      sellerId,
      title: 'Casio Scientific Calculator fx-991ES',
      category: 'Electronics',
      description: 'Used in 1st year engineering, perfect condition',
      condition: 'Like New',
      images: [],
      startPrice: 200,
      maxPrice: 1000,
      minIncrement: 20,
      currentPrice: null,
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() + 600000),
      version: 0,
      status: 'active',
      createdAt: new Date(),
    };
    await getCollections(db).auctions.insertOne(auctionDoc);

    // Run matcher for this new listing
    await matchWatchesForNewListing(db, auctionDoc);

    // Verify autoBid record was inserted for the buyer
    const autoBidRecord = await getCollections(db).autoBids.findOne({
      auctionId: auctionDoc._id,
      userId: buyerId,
    });
    expect(autoBidRecord).toBeTruthy();
    expect(autoBidRecord?.maxAmount).toBe(400);

    // Verify watch status updated with activeAutoBidAuctionId
    const updatedWatch = await getCollections(db).watches.findOne({ _id: watchRes.data!._id });
    expect(updatedWatch?.activeAutoBidAuctionId?.toString()).toBe(auctionDoc._id.toString());

    // Verify opening bid was automatically placed for the buyer
    const updatedAuction = await getCollections(db).auctions.findOne({ _id: auctionDoc._id });
    expect(updatedAuction?.currentPrice).toBe(200);
    expect(updatedAuction?.bidCount).toBe(1);
    expect(updatedAuction?.leaderId?.toString()).toBe(buyerId.toString());

    const bids = await getCollections(db).bids.find({ auctionId: auctionDoc._id }).toArray();
    expect(bids.length).toBe(1);
    expect(bids[0].amount).toBe(200);
    expect(bids[0].bidderId.toString()).toBe(buyerId.toString());
  });

  it('does not place auto-bid if starting price exceeds the authorized budget', async () => {
    const buyerId = new ObjectId();
    const sellerId = new ObjectId();
    const authDate = new Date();

    // Buyer budget is 300
    await createWatch(
      db,
      buyerId,
      {
        keywords: ['laptop'],
        autoBid: true,
        maxBudget: 300,
      },
      authDate
    );

    // Seller lists laptop with starting price 1500
    const auctionDoc: Auction = {
      _id: new ObjectId(),
      sellerId,
      title: 'Gaming Laptop',
      category: 'Electronics',
      description: 'Core i7 laptop',
      condition: 'Good',
      images: [],
      startPrice: 1500,
      maxPrice: 5000,
      minIncrement: 50,
      currentPrice: null,
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() + 600000),
      version: 0,
      status: 'active',
      createdAt: new Date(),
    };
    await getCollections(db).auctions.insertOne(auctionDoc);

    await matchWatchesForNewListing(db, auctionDoc);

    // Should NOT have created an autoBid
    const autoBidRecord = await getCollections(db).autoBids.findOne({
      auctionId: auctionDoc._id,
      userId: buyerId,
    });
    expect(autoBidRecord).toBeNull();
  });

  it('handles OUTBID event beyond budget: clears activeAutoBidAuctionId and pauses watch', async () => {
    const buyerId = new ObjectId();
    const auctionId = new ObjectId();

    const watchRes = await createWatch(
      db,
      buyerId,
      {
        keywords: ['cycle'],
        autoBid: true,
        maxBudget: 1500,
      },
      new Date()
    );

    // Set activeAutoBidAuctionId
    await getCollections(db).watches.updateOne(
      { _id: watchRes.data!._id },
      { $set: { activeAutoBidAuctionId: auctionId } }
    );

    // New bid arrives at 1600 (exceeds budget 1500)
    await handleWatchOutbid(db, buyerId, auctionId, 1600);

    const watchAfter = await getCollections(db).watches.findOne({ _id: watchRes.data!._id });
    expect(watchAfter?.activeAutoBidAuctionId).toBeNull();
    expect(watchAfter?.status).toBe('paused');
    expect(watchAfter?.active).toBe(false);
  });

  it('marks watch fulfilled on win', async () => {
    const buyerId = new ObjectId();
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();

    const auctionDoc: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Engineering Mathematics Textbook',
      category: 'Books',
      description: 'Semester 1 textbook',
      condition: 'Good',
      images: [],
      startPrice: 300,
      maxPrice: 1000,
      minIncrement: 20,
      currentPrice: 450,
      leaderId: buyerId,
      bidCount: 3,
      closesAt: new Date(Date.now() - 1000),
      version: 3,
      status: 'closed_sold',
      createdAt: new Date(),
    };
    await getCollections(db).auctions.insertOne(auctionDoc);

    const watchRes = await createWatch(
      db,
      buyerId,
      {
        keywords: ['textbook'],
        autoBid: true,
        maxBudget: 500,
      },
      new Date()
    );

    await getCollections(db).watches.updateOne(
      { _id: watchRes.data!._id },
      { $set: { activeAutoBidAuctionId: auctionId } }
    );

    await deactivateWatchesOnWin(db, buyerId, auctionDoc);

    const watchAfter = await getCollections(db).watches.findOne({ _id: watchRes.data!._id });
    expect(watchAfter?.status).toBe('fulfilled');
    expect(watchAfter?.active).toBe(false);
    expect(watchAfter?.activeAutoBidAuctionId).toBeNull();
  });

  it('automatically places bid on currently live auction when a matching watch is created', async () => {
    const buyerId = new ObjectId();
    const sellerId = new ObjectId();

    // Auction is ALREADY live
    const auctionDoc: Auction = {
      _id: new ObjectId(),
      sellerId,
      title: 'Graphing Calculator TI-84',
      category: 'Electronics',
      description: 'Used for calculus',
      condition: 'Good',
      images: [],
      startPrice: 500,
      maxPrice: 2000,
      minIncrement: 50,
      currentPrice: null,
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() + 600000),
      version: 0,
      status: 'live',
      createdAt: new Date(),
    };
    await getCollections(db).auctions.insertOne(auctionDoc);

    // Buyer creates an authorized watch for "graphing calculator"
    const watchRes = await createWatch(
      db,
      buyerId,
      {
        keywords: ['graphing', 'calculator'],
        autoBid: true,
        maxBudget: 1000,
      },
      new Date(),
      client
    );
    expect(watchRes.ok).toBe(true);

    // Wait a brief tick for async matchActiveListingsForWatch to finish
    await new Promise((r) => setTimeout(r, 150));

    // Verify bid placed
    const updated = await getCollections(db).auctions.findOne({ _id: auctionDoc._id });
    expect(updated?.currentPrice).toBe(500);
    expect(updated?.bidCount).toBe(1);
    expect(updated?.leaderId?.toString()).toBe(buyerId.toString());
  });
});
