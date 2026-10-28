import { MongoClient, ObjectId, Db } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import fs from 'node:fs';
import {
  ensureIndexes,
  getCollections,
  placeBid,
  eventHub,
  Auction,
} from './index.js';

// Detect local MongoDB binary if available
const potentialPaths = [
  'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
  'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe',
  '/usr/bin/mongod',
  '/usr/local/bin/mongod',
];
if (!process.env.MONGOMS_SYSTEM_BINARY) {
  for (const p of potentialPaths) {
    if (fs.existsSync(p)) {
      process.env.MONGOMS_SYSTEM_BINARY = p;
      break;
    }
  }
}

async function runDemo() {
  console.log('====================================================');
  console.log('   CAMPUS AUCTION PLATFORM - LIVE TRANSACTION DEMO  ');
  console.log('====================================================\n');

  let replSet: MongoMemoryReplSet | null = null;
  let uri = process.env.MONGODB_URI;

  if (!uri) {
    console.log('⚡ Starting in-memory isolated MongoDB replica set...');
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    uri = replSet.getUri();
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db: Db = client.db('campus_auction_demo');

  console.log('✅ Connected to MongoDB Replica Set');
  console.log('📦 Initializing collection indexes...');
  await ensureIndexes(db);
  console.log('✅ Indexes verified.\n');

  // Clear demo collections
  const cols = getCollections(db);
  for (const col of Object.values(cols)) {
    await col.deleteMany({});
  }

  // Hook into real-time event hub (simulating SSE / Web Push dispatcher)
  console.log('📡 Subscribing to Post-Commit Event Hub (SSE / Push)...');
  const unsubscribe = eventHub.subscribe((evt) => {
    console.log(`   [EVENT STREAM] Type: ${evt.type.padEnd(20)} | Target: ${evt.targetUserId ?? 'BROADCAST'}`);
  });

  // Setup sample users
  const sellerId = new ObjectId();
  const aliceId = new ObjectId();   // Auto-bidder
  const bobId = new ObjectId();     // Manual bidder 1
  const charlieId = new ObjectId(); // Manual bidder 2
  const davidId = new ObjectId();   // Sniping bidder

  // 1. Create Auction
  const auctionId = new ObjectId();
  const initialClosesAt = new Date(Date.now() + 20_000); // 20s left (inside 30s snipe window)

  const auction: Auction = {
    _id: auctionId,
    sellerId,
    title: 'Vintage Campus Road Bicycle (10-speed)',
    category: 'Bicycles',
    description: 'Fully tuned, brand new tires, perfect for campus commute.',
    condition: 'Good',
    images: ['https://example.com/bike.jpg'],
    startPrice: 1000,
    maxPrice: 5000,
    minIncrement: 100,
    currentPrice: null,
    leaderId: null,
    bidCount: 0,
    closesAt: initialClosesAt,
    version: 0,
    status: 'active',
    createdAt: new Date(),
  };
  await cols.auctions.insertOne(auction);

  console.log(`\n🚲 Auction Created: "${auction.title}"`);
  console.log(`   Start Price: ₹${auction.startPrice} | Max Price: ₹${auction.maxPrice} | Increment: ₹${auction.minIncrement}`);
  console.log(`   Deadline: ${initialClosesAt.toLocaleTimeString()}`);

  // 2. Alice configures an auto-bid (proxy limit: ₹2,500)
  console.log(`\n🤖 Alice registers Auto-Bid cap: ₹2,500`);
  await cols.autoBids.insertOne({
    _id: new ObjectId(),
    auctionId,
    userId: aliceId,
    maxAmount: 2500,
    createdAt: new Date(),
  });

  // 3. Bob places manual bid of ₹1,000
  console.log(`\n👤 Bob places manual bid of ₹1,000...`);
  const r1 = await placeBid(client, db, {
    auctionId,
    bidderId: bobId,
    amount: 1000,
  });

  if (r1.ok) {
    console.log(`   ✅ Bob's bid accepted!`);
    console.log(`   💥 Auto-bid triggered! Alice automatically counter-bid in the same transaction!`);
    console.log(`   Current Leader: ${r1.auction.leaderId?.equals(aliceId) ? 'Alice (Auto-bid)' : 'Bob'}`);
    console.log(`   Current Price:  ₹${r1.auction.currentPrice}`);
  }

  // 4. Charlie bids ₹1,800
  console.log(`\n👤 Charlie places aggressive bid of ₹1,800...`);
  const r2 = await placeBid(client, db, {
    auctionId,
    bidderId: charlieId,
    amount: 1800,
  });

  if (r2.ok) {
    console.log(`   ✅ Charlie's bid accepted at ₹1,800!`);
    console.log(`   💥 Auto-bid battle resolved: Alice instantly escalated to ₹${r2.auction.currentPrice}!`);
    console.log(`   Current Leader: ${r2.auction.leaderId?.equals(aliceId) ? 'Alice (Auto-bid)' : 'Charlie'}`);
    console.log(`   Current Price:  ₹${r2.auction.currentPrice}`);
  }

  // 5. Invalid bid attempt: Charlie tries to bid ₹1,850 (too low)
  console.log(`\n👤 Charlie tries to place invalid low bid of ₹1,850 (current is ₹1,900, min increment ₹100)...`);
  const r3 = await placeBid(client, db, {
    auctionId,
    bidderId: charlieId,
    amount: 1850,
  });

  if (!r3.ok) {
    console.log(`   ⛔ Bid rejected cleanly without transaction abort error!`);
    console.log(`      Reason: ${r3.reason}${r3.details ? ' Details: ' + JSON.stringify(r3.details) : ''}`);
  }

  // 6. Anti-sniping demonstration
  console.log(`\n⏳ David places a snipe bid of ₹2,200 inside the 30-second closing window...`);
  const r4 = await placeBid(client, db, {
    auctionId,
    bidderId: davidId,
    amount: 2200,
  });

  if (r4.ok) {
    console.log(`   🛡️ Anti-sniping triggered!`);
    console.log(`   Extended deadline by +60s: ${r4.auction.closesAt.toLocaleTimeString()}`);
    console.log(`   Alice auto-counter-bid to: ₹${r4.auction.currentPrice} (Leader: ${r4.auction.leaderId?.equals(aliceId) ? 'Alice' : 'David'})`);
  }

  // 7. Inspect chronological bid history
  console.log(`\n====================================================`);
  console.log(`               AUDIT LOG / BID HISTORY              `);
  console.log(`====================================================`);
  const allBids = await cols.bids.find({ auctionId }).sort({ serverTs: 1, amount: 1 }).toArray();
  for (let i = 0; i < allBids.length; i++) {
    const b = allBids[i];
    const bidderName = b.bidderId.equals(aliceId)
      ? 'Alice (Auto)'
      : b.bidderId.equals(bobId)
      ? 'Bob (Manual)'
      : b.bidderId.equals(charlieId)
      ? 'Charlie (Manual)'
      : 'David (Manual)';
    console.log(`   #${i + 1} | Amount: ₹${b.amount.toString().padEnd(6)} | Source: ${b.source.padEnd(8)} | Bidder: ${bidderName}`);
  }

  console.log(`\n✨ Demo completed successfully!`);

  unsubscribe();
  await client.close();
  if (replSet) {
    await replSet.stop();
  }
}

runDemo().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
