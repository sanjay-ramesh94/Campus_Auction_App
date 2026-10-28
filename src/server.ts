import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId, Db } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import dotenv from 'dotenv';
import {
  ensureIndexes,
  getCollections,
  placeBid,
  eventHub,
  Auction,
} from './index.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(process.cwd(), 'public');

// Auto-detect local MongoDB binary if available
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

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function startDevServer() {
  let replSet: MongoMemoryReplSet | null = null;
  let uri = process.env.MONGODB_URI;

  if (!uri) {
    console.log('⚡ No MONGODB_URI provided in .env; starting isolated in-memory replica set...');
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    uri = replSet.getUri();
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db: Db = client.db('campus_auction');

  console.log(`✅ Connected to MongoDB Replica Set (${uri})`);
  await ensureIndexes(db);
  console.log('📦 Indexes verified.');

  const cols = getCollections(db);

  // Seed sample auctions if database is empty
  const auctionCount = await cols.auctions.countDocuments();
  if (auctionCount === 0) {
    const seed1: Auction = {
      _id: new ObjectId(),
      sellerId: new ObjectId(),
      title: 'Ergonomic Desk Setup & Mechanical Keyboard',
      category: 'Electronics',
      description: 'Solid aluminum laptop stand + wireless RGB mechanical keyboard (brown switches).',
      condition: 'Like New',
      images: ['https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80'],
      startPrice: 800,
      maxPrice: 3000,
      minIncrement: 50,
      currentPrice: null,
      leaderId: null,
      bidCount: 0,
      closesAt: new Date(Date.now() + 45 * 60 * 1000), // 45m from now
      version: 0,
      status: 'active',
      createdAt: new Date(),
    };

    const seed2: Auction = {
      _id: new ObjectId(),
      sellerId: new ObjectId(),
      title: 'Vintage Campus Commuter Bicycle (10-Speed)',
      category: 'Bicycles',
      description: 'Lightweight frame, new puncture-resistant tires, front basket, and kryptonite lock.',
      condition: 'Good',
      images: ['https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=600&q=80'],
      startPrice: 1200,
      maxPrice: 4500,
      minIncrement: 100,
      currentPrice: 1200,
      leaderId: new ObjectId('6ae17eacf4fba89e771f4f13'), // Alice
      bidCount: 1,
      closesAt: new Date(Date.now() + 90 * 1000), // 90 seconds left (near anti-sniping window!)
      version: 1,
      status: 'active',
      createdAt: new Date(),
    };

    // Seed first bid for seed2
    await cols.bids.insertOne({
      _id: new ObjectId(),
      auctionId: seed2._id,
      bidderId: seed2.leaderId!,
      amount: 1200,
      serverTs: new Date(),
      source: 'manual',
    });

    await cols.auctions.insertMany([seed1, seed2]);
    console.log('🌱 Seeded 2 sample auctions with active countdowns.');
  }

  // Active SSE subscribers
  const sseClients: Set<http.ServerResponse> = new Set();
  eventHub.subscribe((event) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(data);
      } catch {
        sseClients.delete(res);
      }
    }
  });

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Idempotency-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // --- Static File Serving ---
    if (!url.pathname.startsWith('/api')) {
      let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
      // Prevent directory traversal
      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        return fs.createReadStream(filePath).pipe(res);
      } else {
        // Fallback to index.html for SPA if not found and no extension
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        if (fs.existsSync(indexPath) && !path.extname(url.pathname)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          return fs.createReadStream(indexPath).pipe(res);
        }
      }
    }

    // --- API Endpoints ---

    // 1. SSE Stream
    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"type":"CONNECTED"}\n\n');
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // 2. List Auctions
    if (url.pathname === '/api/auctions' && req.method === 'GET') {
      const auctions = await cols.auctions.find({}).sort({ createdAt: -1 }).toArray();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, auctions }, null, 2));
    }

    // 3. Create Auction
    if (url.pathname === '/api/auctions' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const p = JSON.parse(body);
          if (!p.title || !p.startPrice) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: 'Title and startPrice required' }));
          }

          const durationMs = (parseInt(p.durationMinutes, 10) || 15) * 60 * 1000;
          const newAuction: Auction = {
            _id: new ObjectId(),
            sellerId: new ObjectId(p.sellerId || '6ae17eacf4fba89e771f4f10'),
            title: String(p.title),
            category: p.category || 'General',
            description: p.description || '',
            condition: p.condition || 'Good',
            images: p.images || ['https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=600&q=80'],
            startPrice: Math.floor(Number(p.startPrice)),
            maxPrice: Math.floor(Number(p.maxPrice || p.startPrice * 5)),
            minIncrement: Math.floor(Number(p.minIncrement || 50)),
            currentPrice: null,
            leaderId: null,
            bidCount: 0,
            closesAt: new Date(Date.now() + durationMs),
            version: 0,
            status: 'active',
            createdAt: new Date(),
          };

          await cols.auctions.insertOne(newAuction);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, auction: newAuction }));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: message }));
        }
      });
      return;
    }

    // 4. Get Bids for an Auction
    if (url.pathname === '/api/bids' && req.method === 'GET') {
      const auctionId = url.searchParams.get('auctionId');
      if (!auctionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'auctionId query required' }));
      }
      const bids = await cols.bids
        .find({ auctionId: new ObjectId(auctionId) })
        .sort({ serverTs: -1 })
        .limit(50)
        .toArray();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, bids }));
    }

    // 5. Place Bid (Transactional)
    if (url.pathname === '/api/bids' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          if (!payload.auctionId || !payload.bidderId || !payload.amount) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(
              JSON.stringify({
                ok: false,
                error: 'Missing required fields: auctionId, bidderId, amount',
              })
            );
          }

          const result = await placeBid(client, db, {
            auctionId: new ObjectId(payload.auctionId),
            bidderId: new ObjectId(payload.bidderId),
            amount: Number(payload.amount),
            idempotencyKey: payload.idempotencyKey || req.headers['x-idempotency-key']?.toString(),
          });

          res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(result, null, 2));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: message }));
        }
      });
      return;
    }

    // 6. Set / Update Auto-Bid Proxy
    if (url.pathname === '/api/auto-bids' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          if (!payload.auctionId || !payload.userId || !payload.maxAmount) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: 'auctionId, userId, maxAmount required' }));
          }

          const auctionId = new ObjectId(payload.auctionId);
          const userId = new ObjectId(payload.userId);
          const maxAmount = Math.floor(Number(payload.maxAmount));

          await cols.autoBids.updateOne(
            { auctionId, userId },
            {
              $set: { maxAmount, createdAt: new Date() },
              $setOnInsert: { _id: new ObjectId() },
            },
            { upsert: true }
          );

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, auctionId, userId, maxAmount }));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: message }));
        }
      });
      return;
    }

    // 7. Get user's Auto-Bid status
    if (url.pathname === '/api/auto-bids' && req.method === 'GET') {
      const auctionId = url.searchParams.get('auctionId');
      const userId = url.searchParams.get('userId');
      if (!auctionId || !userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'auctionId and userId required' }));
      }
      const existing = await cols.autoBids.findOne({
        auctionId: new ObjectId(auctionId),
        userId: new ObjectId(userId),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, autoBid: existing }));
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 Campus Auction Dev Server is running at: http://localhost:${PORT}`);
    console.log(`   - Frontend Web App:   http://localhost:${PORT}/`);
    console.log(`   - Auctions API:       http://localhost:${PORT}/api/auctions`);
    console.log(`   - Live Event Stream:  http://localhost:${PORT}/api/events`);
    console.log(`   - Press Ctrl+C to stop.\n`);
  });

  const cleanup = async () => {
    console.log('\n🛑 Shutting down server...');
    server.close();
    await client.close();
    if (replSet) {
      await replSet.stop();
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

startDevServer().catch((err) => {
  console.error('Fatal dev server error:', err);
  process.exit(1);
});
