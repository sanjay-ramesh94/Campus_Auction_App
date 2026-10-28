import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId, MongoClient, Db } from 'mongodb';
import { setupTestDatabase, teardownTestDatabase, clearDatabase } from './setup.js';
import { getCollections } from '../src/db.js';
import { Auction, User } from '../src/types.js';
import {
  getSellerAuctions,
  getWinningBuyerDetails,
  relistUnsoldAuction,
  getSellerDetailsForWinner,
} from '../src/seller/sellerController.js';

describe('Seller Panel & Contact Privacy Endpoints', () => {
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

  it('1. Non-owner gets 403 Forbidden when requesting buyer details', async () => {
    const cols = getCollections(db);
    const sellerId = new ObjectId();
    const attackerId = new ObjectId();
    const winnerId = new ObjectId();
    const auctionId = new ObjectId();

    const soldAuction: Auction = {
      _id: auctionId,
      sellerId,
      title: 'iPad Pro',
      category: 'Electronics',
      description: 'Used tablet',
      condition: 'Good',
      images: [],
      startPrice: 20000,
      maxPrice: 40000,
      minIncrement: 500,
      currentPrice: 28000,
      leaderId: winnerId,
      winnerId,
      bidCount: 5,
      closesAt: new Date(Date.now() - 10000),
      version: 2,
      status: 'closed_sold',
      createdAt: new Date(),
    };
    await cols.auctions.insertOne(soldAuction);

    // Attacker (not the seller) requests buyer details
    const result = await getWinningBuyerDetails(db, attackerId, auctionId);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.error).toContain('Forbidden');
    expect(result.data).toBeUndefined();
  });

  it('2. Unsold auction returns 403 / no buyer when requesting buyer details', async () => {
    const cols = getCollections(db);
    const sellerId = new ObjectId();
    const auctionId = new ObjectId();

    const unsoldAuction: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Study Lamp',
      category: 'Furniture',
      description: 'Desk lamp',
      condition: 'Good',
      images: [],
      startPrice: 400,
      maxPrice: 1000,
      minIncrement: 50,
      currentPrice: null,
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() - 10000),
      version: 0,
      status: 'closed_unsold',
      createdAt: new Date(),
    };
    await cols.auctions.insertOne(unsoldAuction);

    // Owner requests buyer details for an unsold auction
    const result = await getWinningBuyerDetails(db, sellerId, auctionId);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.error).toContain('only available for sold auctions');
    expect(result.data).toBeUndefined();
  });

  it('3. Sold auction returns only allowed buyer fields and never passwordHash or unrelated data', async () => {
    const cols = getCollections(db);
    const sellerId = new ObjectId();
    const winnerId = new ObjectId();
    const auctionId = new ObjectId();

    // Winner with phone opted in and secret passwordHash
    const winnerUser: User = {
      _id: winnerId,
      name: 'Rohan Verma',
      email: 'rohan.v@campus.edu',
      passwordHash: 'argon2id$v=19$m=65536,t=3,p=4$SUPER_SECRET_SALT_HASH',
      role: 'buyer',
      sem: 6,
      department: 'Mechanical',
      notifPrefs: { push: true, sms: true },
      createdAt: new Date(),
    };
    (winnerUser as any).phone = '+91 98765 88888';
    (winnerUser as any).secretToken = 'xyz123secret';
    await cols.users.insertOne(winnerUser);

    const soldAuction: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Graphing Calculator',
      category: 'Electronics',
      description: 'TI-84 Plus',
      condition: 'Good',
      images: [],
      startPrice: 2000,
      maxPrice: 5000,
      minIncrement: 100,
      currentPrice: 3200,
      leaderId: winnerId,
      winnerId,
      bidCount: 4,
      closesAt: new Date(Date.now() - 10000),
      version: 2,
      status: 'closed_sold',
      createdAt: new Date(),
    };
    await cols.auctions.insertOne(soldAuction);

    // Legitimate owner requests buyer details
    const result = await getWinningBuyerDetails(db, sellerId, auctionId);
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.data).toBeDefined();

    const buyer = result.data!;
    expect(buyer.name).toBe('Rohan Verma');
    expect(buyer.collegeEmail).toBe('rohan.v@campus.edu');
    expect(buyer.department).toBe('Mechanical');
    expect(buyer.year).toBe('3rd Year');
    expect(buyer.phone).toBe('+91 98765 88888');

    // Strict privacy verification: Ensure sensitive fields are never present
    expect((buyer as any).passwordHash).toBeUndefined();
    expect((buyer as any).secretToken).toBeUndefined();
    expect((buyer as any)._id).toBeUndefined();
  });

  it('4. Relist is allowed only for owner and only for closed_unsold auctions', async () => {
    const cols = getCollections(db);
    const sellerId = new ObjectId();
    const otherUserId = new ObjectId();
    const auctionId = new ObjectId();

    const unsoldAuction: Auction = {
      _id: auctionId,
      sellerId,
      title: 'Lab Coat',
      category: 'Others',
      description: 'Chemistry lab coat',
      condition: 'Good',
      images: ['https://example.com/coat.jpg'],
      startPrice: 300,
      maxPrice: 900,
      minIncrement: 50,
      currentPrice: null,
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() - 10000),
      version: 0,
      status: 'closed_unsold',
      createdAt: new Date(),
    };
    await cols.auctions.insertOne(unsoldAuction);

    // Non-owner relist attempt -> 403
    const forbiddenRelist = await relistUnsoldAuction(db, otherUserId, auctionId);
    expect(forbiddenRelist.ok).toBe(false);
    expect(forbiddenRelist.statusCode).toBe(403);

    // Owner relist with new starting price -> 201
    const successfulRelist = await relistUnsoldAuction(db, sellerId, auctionId, {
      startPrice: 250,
      durationMinutes: 30,
    });
    expect(successfulRelist.ok).toBe(true);
    expect(successfulRelist.statusCode).toBe(201);
    expect(successfulRelist.data).toBeDefined();
    expect(successfulRelist.data?.status).toBe('live');
    expect(successfulRelist.data?.startPrice).toBe(250);
    expect(successfulRelist.data?.title).toBe('Lab Coat');

    // Relisting an already live auction -> 400
    const invalidRelist = await relistUnsoldAuction(db, sellerId, successfulRelist.data!._id);
    expect(invalidRelist.ok).toBe(false);
    expect(invalidRelist.statusCode).toBe(400);
  });
});
