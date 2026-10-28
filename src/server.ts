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
  User,
  WatchRequest,
} from './index.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  computeRoleFromSem,
  findStudentInRoster,
  seedAuthorizedStudents,
  AuthTokenPayload,
} from './auth.js';
import { startAuctionSweeper } from './sweeper.js';

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

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function getAuthUser(req: http.IncomingMessage): AuthTokenPayload | null {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return verifyToken(token);
}

async function startDevServer() {
  let replSet: MongoMemoryReplSet | null = null;
  const targetUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campus_auction';
  let client: MongoClient;
  let uri = targetUri;

  try {
    client = new MongoClient(targetUri, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    console.log(`✅ Connected to local MongoDB at: ${targetUri}`);
    console.log(`📊 In MongoDB Compass: connect to "mongodb://localhost:27017" -> database "campus_auction"`);
  } catch (err) {
    console.warn(`⚠️ Could not connect to ${targetUri}. Starting isolated in-memory replica set...`);
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    uri = replSet.getUri();
    client = new MongoClient(uri);
    await client.connect();
    console.log(`✅ Connected to in-memory replica set (${uri})`);
  }

  const db: Db = client.db('campus_auction');
  await ensureIndexes(db);
  console.log('📦 Indexes verified.');

  // Seed authorized student roster
  await seedAuthorizedStudents(db);

  // Start background closing sweeper
  startAuctionSweeper(db, 5000);
  console.log('⏱️ Background auction closing sweeper started.');

  const cols = getCollections(db);

  // Seed sample auctions if none exist
  const auctionCount = await cols.auctions.countDocuments();
  if (auctionCount === 0) {
    const seniorSeller = await cols.authorizedStudents.findOne({
      $or: [{ sem: { $gte: 7 } }, { Sem: { $gte: 7 } }],
    });
    const sellerId = seniorSeller ? seniorSeller._id : new ObjectId();

    const seedAuctions: Auction[] = [
      {
        _id: new ObjectId(),
        sellerId,
        title: 'Ergonomic Desk Setup & Mechanical Keyboard',
        category: 'Electronics',
        description: 'Solid aluminum laptop stand + wireless RGB mechanical keyboard (brown switches). Pristine condition.',
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
      },
      {
        _id: new ObjectId(),
        sellerId,
        title: 'Vintage Campus Commuter Bicycle (10-Speed)',
        category: 'Bicycles',
        description: 'Lightweight road frame, fresh puncture-resistant tires, front luggage basket, and U-lock included.',
        condition: 'Good',
        images: ['https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=600&q=80'],
        startPrice: 1200,
        maxPrice: 4500,
        minIncrement: 100,
        currentPrice: null,
        leaderId: null,
        bidCount: 0,
        closesAt: new Date(Date.now() + 85 * 1000), // 85 seconds left (great for testing anti-sniping!)
        version: 0,
        status: 'active',
        createdAt: new Date(),
      },
    ];

    await cols.auctions.insertMany(seedAuctions);
    console.log('🌱 Seeded 2 active campus listings.');
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Idempotency-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // --- Static File Serving ---
    if (!url.pathname.startsWith('/api')) {
      let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
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
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        if (fs.existsSync(indexPath) && !path.extname(url.pathname)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          return fs.createReadStream(indexPath).pipe(res);
        }
      }
    }

    // --- API Endpoints ---

    // 0. SSE Stream
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

    // ==========================================
    // AUTHENTICATION & ROSTER
    // ==========================================

    // Roster hint / quick accounts helper
    if (url.pathname === '/api/auth/roster-hint' && req.method === 'GET') {
      const docs = await cols.authorizedStudents.find({}).limit(50).toArray();
      const roster = docs.map((d: any) => ({
        _id: d._id,
        email: (d.email || d['Mail ID'] || '').toLowerCase(),
        name: d.name || d.Name || '',
        sem: d.sem !== undefined ? d.sem : d.Sem,
        department: d.department || d.Branch || d['Roll No'] || '',
      })).filter(r => r.email);
      return sendJson(res, 200, { ok: true, roster });
    }

    // Step 1: Check College Email in Roster
    if (url.pathname === '/api/auth/check-email' && req.method === 'POST') {
      try {
        const { email } = await readBody(req);
        if (!email) return sendJson(res, 400, { ok: false, error: 'Email is required' });

        const normalizedEmail = String(email).trim().toLowerCase();
        const student = await findStudentInRoster(db, normalizedEmail);

        if (!student) {
          return sendJson(res, 403, {
            ok: false,
            error: "Your email isn't registered with the campus list",
          });
        }

        const roleCheck = computeRoleFromSem(student.sem);
        if (roleCheck.error) {
          return sendJson(res, 403, { ok: false, error: roleCheck.error });
        }

        const user = await cols.users.findOne({ email: student.email });
        const hasPassword = Boolean(user && user.passwordHash);

        return sendJson(res, 200, {
          ok: true,
          found: true,
          email: student.email,
          name: student.name || user?.name || student.email.split('@')[0],
          sem: student.sem,
          role: roleCheck.role,
          hasPassword,
        });
      } catch (err: any) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    // Step 2: Set Initial Password (for first-time student)
    if (url.pathname === '/api/auth/set-password' && req.method === 'POST') {
      try {
        const { email, password, confirmPassword, name } = await readBody(req);
        if (!email || !password || !confirmPassword) {
          return sendJson(res, 400, { ok: false, error: 'All fields are required' });
        }
        if (password !== confirmPassword) {
          return sendJson(res, 400, { ok: false, error: 'Passwords do not match' });
        }
        if (password.length < 6) {
          return sendJson(res, 400, { ok: false, error: 'Password must be at least 6 characters' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const student = await findStudentInRoster(db, normalizedEmail);
        if (!student) {
          return sendJson(res, 403, { ok: false, error: "Your email isn't registered with the campus list" });
        }

        const roleCheck = computeRoleFromSem(student.sem);
        if (roleCheck.error) {
          return sendJson(res, 403, { ok: false, error: roleCheck.error });
        }

        const passwordHash = hashPassword(password);
        const displayName = name || student.name || student.email.split('@')[0];

        await cols.users.updateOne(
          { email: student.email },
          {
            $set: {
              name: displayName,
              passwordHash,
              role: roleCheck.role!,
              sem: student.sem,
              updatedAt: new Date(),
            },
            $setOnInsert: {
              _id: new ObjectId(),
              email: student.email,
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );

        return sendJson(res, 200, {
          ok: true,
          message: 'Password created successfully! Please log in.',
        });
      } catch (err: any) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    // Step 3: Login (Enter password, dynamically computes latest role)
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const { email, password } = await readBody(req);
        if (!email || !password) {
          return sendJson(res, 400, { ok: false, error: 'Email and password required' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const student = await findStudentInRoster(db, normalizedEmail);
        if (!student) {
          return sendJson(res, 403, { ok: false, error: "Your email isn't registered with the campus list" });
        }

        const roleCheck = computeRoleFromSem(student.sem);
        if (roleCheck.error) {
          return sendJson(res, 403, { ok: false, error: roleCheck.error });
        }

        const user = await cols.users.findOne({ email: student.email });
        if (!user || !user.passwordHash) {
          return sendJson(res, 400, { ok: false, error: 'Password not set. Please set password first.' });
        }

        if (!verifyPassword(password, user.passwordHash)) {
          return sendJson(res, 401, { ok: false, error: 'Incorrect password' });
        }

        // Dynamically update user's role and semester if changed in roster
        const currentRole = roleCheck.role!;
        if (user.role !== currentRole || user.sem !== student.sem) {
          await cols.users.updateOne(
            { _id: user._id },
            { $set: { role: currentRole, sem: student.sem, updatedAt: new Date() } }
          );
        }

        const token = signToken({
          userId: user._id.toString(),
          email: user.email,
          role: currentRole,
          sem: student.sem,
          name: user.name,
        });

        return sendJson(res, 200, {
          ok: true,
          token,
          user: {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            role: currentRole,
            sem: student.sem,
            department: student.department,
            notifPrefs: user.notifPrefs,
          },
        });
      } catch (err: any) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    // Get current authenticated user
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const student = await findStudentInRoster(db, auth.email);
      const roleCheck = student ? computeRoleFromSem(student.sem) : { role: auth.role };
      const currentRole = roleCheck.role || auth.role;

      return sendJson(res, 200, {
        ok: true,
        user: {
          id: auth.userId,
          email: auth.email,
          name: auth.name,
          role: currentRole,
          sem: student ? student.sem : auth.sem,
        },
      });
    }

    // Profile update (display name & notification preferences)
    if (url.pathname === '/api/auth/profile' && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const { name, notifPrefs } = await readBody(req);
      const updateData: any = { updatedAt: new Date() };
      if (name) updateData.name = String(name).trim();
      if (notifPrefs) updateData.notifPrefs = notifPrefs;

      await cols.users.updateOne({ _id: new ObjectId(auth.userId) }, { $set: updateData });
      return sendJson(res, 200, { ok: true, message: 'Profile updated' });
    }

    // ==========================================
    // SELLER FLOW (Sem 7, 8, 9)
    // ==========================================

    // Seller Dashboard: Get all own listings grouped by status
    if (url.pathname === '/api/seller/listings' && req.method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      if (auth.role !== 'seller') {
        return sendJson(res, 403, { ok: false, error: 'Sellers only' });
      }

      const listings = await cols.auctions
        .find({ sellerId: new ObjectId(auth.userId) })
        .sort({ createdAt: -1 })
        .toArray();

      // Group by status
      const grouped = {
        active: listings.filter((l) => l.status === 'active'),
        pending_approval: listings.filter((l) => l.status === 'pending_approval'),
        reserved: listings.filter((l) => l.status === 'reserved'),
        sold: listings.filter((l) => l.status === 'sold'),
        unsold_closed: listings.filter((l) => ['unsold', 'closed', 'cancelled'].includes(l.status)),
      };

      // Highlight items needing action at top
      const actionNeeded = listings.filter((l) =>
        ['pending_approval', 'reserved'].includes(l.status)
      );

      return sendJson(res, 200, { ok: true, listings, grouped, actionNeeded });
    }

    // Create Listing (Seller only)
    if (url.pathname === '/api/seller/auctions' && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      if (auth.role !== 'seller') {
        return sendJson(res, 403, { ok: false, error: 'Only sellers (Sem 7, 8, 9) can list items' });
      }

      try {
        const p = await readBody(req);
        const startPrice = Math.floor(Number(p.startPrice));
        const maxPrice = Math.floor(Number(p.maxPrice || startPrice * 5));
        const minIncrement = Math.floor(Number(p.minIncrement || 50));
        const durationMinutes = parseInt(p.durationMinutes, 10) || 15;

        // Inline validations
        if (!p.title || p.title.trim().length === 0) {
          return sendJson(res, 400, { ok: false, error: 'Title is required' });
        }
        if (startPrice <= 0) {
          return sendJson(res, 400, { ok: false, error: 'Start price must be greater than ₹0' });
        }
        if (startPrice > maxPrice) {
          return sendJson(res, 400, { ok: false, error: 'Start price cannot exceed maximum buyout price' });
        }
        if (minIncrement <= 0) {
          return sendJson(res, 400, { ok: false, error: 'Minimum increment must be greater than ₹0' });
        }
        if (durationMinutes <= 0) {
          return sendJson(res, 400, { ok: false, error: 'Closing time must be in the future' });
        }

        const closesAt = new Date(Date.now() + durationMinutes * 60 * 1000);

        const newAuction: Auction = {
          _id: new ObjectId(),
          sellerId: new ObjectId(auth.userId),
          title: String(p.title).trim(),
          category: p.category || 'General',
          description: p.description || '',
          condition: p.condition || 'Good',
          images: p.images && p.images.length > 0 ? p.images : ['https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=600&q=80'],
          startPrice,
          maxPrice,
          minIncrement,
          currentPrice: null,
          leaderId: null,
          bidCount: 0,
          closesAt,
          version: 0,
          status: 'active',
          createdAt: new Date(),
        };

        await cols.auctions.insertOne(newAuction);

        // Check for matching "Looking for..." watch requests and notify buyers
        const matches = await cols.watchRequests
          .find({
            active: true,
            $or: [
              { category: newAuction.category },
              { keywords: { $in: newAuction.title.toLowerCase().split(/\s+/) } },
            ],
          })
          .toArray();

        for (const w of matches) {
          if (!w.userId.equals(newAuction.sellerId)) {
            await cols.notifications.insertOne({
              _id: new ObjectId(),
              userId: w.userId,
              type: 'WATCH_MATCH',
              title: 'Match for Your Watch Request!',
              message: `A new listing matching your request is available: "${newAuction.title}" starting at ₹${newAuction.startPrice}`,
              payload: { auctionId: newAuction._id },
              createdAt: new Date(),
            });
          }
        }

        return sendJson(res, 201, { ok: true, auction: newAuction });
      } catch (err: any) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    // Edit Listing (Seller only)
    if (url.pathname.startsWith('/api/seller/auctions/') && req.method === 'PUT') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const auctionId = url.pathname.split('/').pop();
      const a = await cols.auctions.findOne({ _id: new ObjectId(auctionId) });
      if (!a) return sendJson(res, 404, { ok: false, error: 'Auction not found' });
      if (!a.sellerId.equals(new ObjectId(auth.userId))) {
        return sendJson(res, 403, { ok: false, error: 'Not your auction' });
      }

      const p = await readBody(req);
      const updateDoc: any = { updatedAt: new Date() };

      if (a.bidCount === 0) {
        // No bids yet: can edit all fields
        if (p.title) updateDoc.title = String(p.title).trim();
        if (p.category) updateDoc.category = p.category;
        if (p.condition) updateDoc.condition = p.condition;
        if (p.description !== undefined) updateDoc.description = p.description;
        if (p.images) updateDoc.images = p.images;
        if (p.startPrice) updateDoc.startPrice = Math.floor(Number(p.startPrice));
        if (p.maxPrice) updateDoc.maxPrice = Math.floor(Number(p.maxPrice));
        if (p.minIncrement) updateDoc.minIncrement = Math.floor(Number(p.minIncrement));
      } else {
        // Has bids: ONLY description and photos can change!
        if (p.description !== undefined) updateDoc.description = p.description;
        if (p.images) updateDoc.images = p.images;
      }

      await cols.auctions.updateOne({ _id: a._id }, { $set: updateDoc });
      return sendJson(res, 200, { ok: true, message: 'Auction updated' });
    }

    // Cancel Listing (Seller only, asks reason)
    if (url.pathname.startsWith('/api/seller/auctions/') && url.pathname.endsWith('/cancel') && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const parts = url.pathname.split('/');
      const auctionId = parts[parts.length - 2];
      const a = await cols.auctions.findOne({ _id: new ObjectId(auctionId) });
      if (!a) return sendJson(res, 404, { ok: false, error: 'Auction not found' });
      if (!a.sellerId.equals(new ObjectId(auth.userId))) {
        return sendJson(res, 403, { ok: false, error: 'Not your auction' });
      }

      const { reason } = await readBody(req);
      await cols.auctions.updateOne(
        { _id: a._id },
        {
          $set: {
            status: 'cancelled',
            outcomeReason: reason || 'Cancelled by seller',
            updatedAt: new Date(),
          },
        }
      );

      // Notify any current bidders
      if (a.leaderId) {
        await cols.notifications.insertOne({
          _id: new ObjectId(),
          userId: a.leaderId,
          type: 'AUCTION_CANCELLED',
          title: 'Auction Cancelled',
          message: `The auction for "${a.title}" was cancelled by the seller. Reason: ${reason || 'None provided'}.`,
          payload: { auctionId: a._id },
          createdAt: new Date(),
        });
      }

      await eventHub.emitAll([
        {
          type: 'AUCTION_ENDED',
          auctionId: a._id,
          payload: { status: 'cancelled' },
        },
      ]);

      return sendJson(res, 200, { ok: true, message: 'Auction cancelled' });
    }

    // Closing: Approve or Reject winning bid (Seller only)
    if (url.pathname.startsWith('/api/seller/auctions/') && url.pathname.endsWith('/close-action') && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const parts = url.pathname.split('/');
      const auctionId = parts[parts.length - 2];
      const a = await cols.auctions.findOne({ _id: new ObjectId(auctionId) });
      if (!a) return sendJson(res, 404, { ok: false, error: 'Auction not found' });
      if (!a.sellerId.equals(new ObjectId(auth.userId))) {
        return sendJson(res, 403, { ok: false, error: 'Not your auction' });
      }

      const { decision, reason } = await readBody(req); // 'approved' | 'rejected'

      if (decision === 'approved') {
        await cols.auctions.updateOne(
          { _id: a._id },
          {
            $set: {
              status: 'reserved',
              approvalDecision: 'approved',
              handoverStatus: 'pending',
              updatedAt: new Date(),
            },
          }
        );

        if (a.leaderId) {
          await cols.notifications.insertOne({
            _id: new ObjectId(),
            userId: a.leaderId,
            type: 'AUCTION_APPROVED',
            title: 'Seller Approved Your Winning Bid! 🎉',
            message: `Your winning bid of ₹${a.currentPrice} for "${a.title}" was approved! Status is now Reserved. Coordinate with seller for pickup.`,
            payload: { auctionId: a._id, sellerEmail: auth.email },
            createdAt: new Date(),
          });
        }

        return sendJson(res, 200, { ok: true, status: 'reserved', message: 'Winning bid approved. Item is Reserved.' });
      } else {
        await cols.auctions.updateOne(
          { _id: a._id },
          {
            $set: {
              status: 'closed',
              approvalDecision: 'rejected',
              approvalReason: reason || 'Seller rejected bid',
              updatedAt: new Date(),
            },
          }
        );

        if (a.leaderId) {
          await cols.notifications.insertOne({
            _id: new ObjectId(),
            userId: a.leaderId,
            type: 'AUCTION_REJECTED',
            title: 'Bid Outcome Rejected',
            message: `The seller did not approve the winning bid for "${a.title}". Reason: ${reason || 'Reserve not met'}.`,
            payload: { auctionId: a._id },
            createdAt: new Date(),
          });
        }

        return sendJson(res, 200, { ok: true, status: 'closed', message: 'Winning bid rejected. Item is Closed.' });
      }
    }

    // Handover Confirmation (Seller only)
    if (url.pathname.startsWith('/api/seller/auctions/') && url.pathname.endsWith('/handover') && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const parts = url.pathname.split('/');
      const auctionId = parts[parts.length - 2];
      const a = await cols.auctions.findOne({ _id: new ObjectId(auctionId) });
      if (!a) return sendJson(res, 404, { ok: false, error: 'Auction not found' });
      if (!a.sellerId.equals(new ObjectId(auth.userId))) {
        return sendJson(res, 403, { ok: false, error: 'Not your auction' });
      }

      const { status, notes } = await readBody(req); // 'confirmed' | 'failed'

      if (status === 'confirmed') {
        await cols.auctions.updateOne(
          { _id: a._id },
          {
            $set: {
              status: 'sold',
              handoverStatus: 'confirmed',
              handoverNotes: notes || '',
              updatedAt: new Date(),
            },
          }
        );

        if (a.leaderId) {
          await cols.notifications.insertOne({
            _id: new ObjectId(),
            userId: a.leaderId,
            type: 'HANDOVER_CONFIRMED',
            title: 'Handover Completed! 🤝',
            message: `Handover confirmed for "${a.title}". Thank you for using CampusBid!`,
            payload: { auctionId: a._id },
            createdAt: new Date(),
          });
        }

        return sendJson(res, 200, { ok: true, status: 'sold', message: 'Handover confirmed. Item Sold.' });
      } else {
        await cols.auctions.updateOne(
          { _id: a._id },
          {
            $set: {
              status: 'closed',
              handoverStatus: 'failed',
              handoverNotes: notes || 'Pickup failed',
              outcomeReason: 'Pickup failed / Buyer did not collect',
              updatedAt: new Date(),
            },
          }
        );

        return sendJson(res, 200, { ok: true, status: 'closed', message: 'Pickup marked failed. Item Closed.' });
      }
    }

    // Answer Q&A (Seller only)
    if (url.pathname.startsWith('/api/seller/questions/') && url.pathname.endsWith('/answer') && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const parts = url.pathname.split('/');
      const questionId = parts[parts.length - 2];
      const { answer } = await readBody(req);

      if (!answer) return sendJson(res, 400, { ok: false, error: 'Answer text required' });

      const q = await cols.questions.findOne({ _id: new ObjectId(questionId) });
      if (!q) return sendJson(res, 404, { ok: false, error: 'Question not found' });

      await cols.questions.updateOne(
        { _id: q._id },
        {
          $set: {
            answer: String(answer).trim(),
            status: 'answered',
            answeredAt: new Date(),
          },
        }
      );

      // Notify the asker
      await cols.notifications.insertOne({
        _id: new ObjectId(),
        userId: q.askerId,
        type: 'QUESTION_ANSWERED',
        title: 'Seller Answered Your Question',
        message: `Your question "${q.text.slice(0, 40)}..." was answered: "${answer.slice(0, 60)}..."`,
        payload: { auctionId: q.auctionId, questionId: q._id },
        createdAt: new Date(),
      });

      await eventHub.emitAll([
        {
          type: 'QUESTION_ANSWERED',
          auctionId: q.auctionId,
          payload: { questionId: q._id, answer: String(answer).trim() },
        },
      ]);

      return sendJson(res, 200, { ok: true, message: 'Answer submitted' });
    }

    // ==========================================
    // BUYER FLOW (All other sems) & BROWSE
    // ==========================================

    // Browse Home: Search & Filters
    if (url.pathname === '/api/browse' && req.method === 'GET') {
      const query: any = { status: 'active' };

      const search = url.searchParams.get('search');
      if (search && search.trim()) {
        query.$or = [
          { title: { $regex: search.trim(), $options: 'i' } },
          { description: { $regex: search.trim(), $options: 'i' } },
        ];
      }

      const category = url.searchParams.get('category');
      if (category && category !== 'All') {
        query.category = category;
      }

      const condition = url.searchParams.get('condition');
      if (condition && condition !== 'All') {
        query.condition = condition;
      }

      const minPrice = url.searchParams.get('minPrice');
      const maxPrice = url.searchParams.get('maxPrice');
      if (minPrice || maxPrice) {
        query.startPrice = {};
        if (minPrice) query.startPrice.$gte = Number(minPrice);
        if (maxPrice) query.startPrice.$lte = Number(maxPrice);
      }

      let sort: any = { createdAt: -1 };
      const sortParam = url.searchParams.get('sort');
      if (sortParam === 'closing_soon') {
        sort = { closesAt: 1 };
      } else if (sortParam === 'price_low') {
        sort = { startPrice: 1 };
      } else if (sortParam === 'price_high') {
        sort = { startPrice: -1 };
      }

      const auctions = await cols.auctions.find(query).sort(sort).toArray();
      return sendJson(res, 200, { ok: true, auctions });
    }

    // Complete Live Bid History with Pagination & Optional Bidder Filtering
    // GET /api/auctions/:auctionId/bids?page=1&limit=20&bidderId=...
    const bidsRouteMatch = url.pathname.match(/^\/api\/auctions\/([a-fA-F0-9]{24})\/bids$/);
    if (bidsRouteMatch && req.method === 'GET') {
      const auctionId = bidsRouteMatch[1];
      try {
        const aId = new ObjectId(auctionId);
        const auction = await cols.auctions.findOne({ _id: aId });
        if (!auction) return sendJson(res, 404, { ok: false, error: 'Auction not found' });

        const auth = getAuthUser(req);
        const currentUserId = auth ? auth.userId : null;

        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
        const bidderIdParam = url.searchParams.get('bidderId');

        // Query criteria for bids
        const query: any = { auctionId: aId };
        if (bidderIdParam && ObjectId.isValid(bidderIdParam)) {
          query.bidderId = new ObjectId(bidderIdParam);
        }

        const totalBids = await cols.bids.countDocuments(query);
        const rawBids = await cols.bids
          .find(query)
          .sort({ serverTs: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray();

        // Batch look up unique bidder IDs to enrich with display names without leaking private data
        const uniqueBidderIds = Array.from(new Set(rawBids.map((b) => b.bidderId.toString()))).map((id) => new ObjectId(id));
        const usersDocs = await cols.users.find({ _id: { $in: uniqueBidderIds } }).toArray();
        const rosterDocs = await cols.authorizedStudents.find({ _id: { $in: uniqueBidderIds } }).toArray();

        const userMap = new Map<string, { name: string; sem: number; dept: string }>();
        for (const u of usersDocs) {
          userMap.set(u._id.toString(), {
            name: u.name,
            sem: u.sem,
            dept: u.department || 'Campus',
          });
        }
        for (const r of rosterDocs) {
          const idStr = r._id.toString();
          if (!userMap.has(idStr)) {
            const rName = r.name || (r as any).Name || 'Student Bidder';
            const rSem = r.sem ?? (r as any).Sem ?? 4;
            const rDept = (r as any).department || (r as any).Branch || 'Campus';
            userMap.set(idStr, { name: rName, sem: rSem, dept: rDept });
          }
        }

        // Identify current leading bid
        const leaderIdStr = auction.leaderId ? auction.leaderId.toString() : null;

        const formattedBids = rawBids.map((b) => {
          const bIdStr = b.bidderId.toString();
          const info = userMap.get(bIdStr);
          const isYou = Boolean(currentUserId && currentUserId === bIdStr);
          const name = info?.name || (isYou ? 'You' : 'Student Bidder');
          const initials = name
            .split(' ')
            .map((p) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || 'SB';
          const sem = info?.sem ?? 4;
          const dept = info?.dept || 'Campus';
          const yearStr = sem >= 7 ? '4th Year' : sem >= 5 ? '3rd Year' : sem >= 3 ? '2nd Year' : '1st Year';

          const isLeading = Boolean(
            leaderIdStr && leaderIdStr === bIdStr && b.amount === auction.currentPrice
          );

          const ts = (b as any).createdAt || b.serverTs || new Date();

          return {
            _id: b._id.toString(),
            auctionId: b.auctionId.toString(),
            bidderId: bIdStr,
            bidderName: isYou ? `${name} (You)` : name,
            bidderInitials: initials,
            bidderYearBranch: `${yearStr} · ${dept}`,
            amount: b.amount,
            serverTs: b.serverTs ? b.serverTs.toISOString() : ts.toISOString(),
            createdAt: ts.toISOString(),
            source: b.source || 'manual',
            isLeading,
            isYou,
          };
        });

        // Compute authoritative unique participants list from actual accepted bids
        const allAuctionBids = await cols.bids.find({ auctionId: aId }).sort({ amount: -1, serverTs: -1 }).toArray();
        const allBidderIds = Array.from(new Set(allAuctionBids.map((b) => b.bidderId.toString()))).map((id) => new ObjectId(id));
        const allUsersDocs = await cols.users.find({ _id: { $in: allBidderIds } }).toArray();
        const allRosterDocs = await cols.authorizedStudents.find({ _id: { $in: allBidderIds } }).toArray();

        const allUserMap = new Map<string, { name: string; sem: number; dept: string }>();
        for (const u of allUsersDocs) {
          allUserMap.set(u._id.toString(), { name: u.name, sem: u.sem, dept: u.department || 'Campus' });
        }
        for (const r of allRosterDocs) {
          const idStr = r._id.toString();
          if (!allUserMap.has(idStr)) {
            const rName = r.name || (r as any).Name || 'Student Bidder';
            const rSem = r.sem ?? (r as any).Sem ?? 4;
            const rDept = (r as any).department || (r as any).Branch || 'Campus';
            allUserMap.set(idStr, { name: rName, sem: rSem, dept: rDept });
          }
        }

        const participantMap = new Map<
          string,
          {
            id: string;
            name: string;
            initials: string;
            yearBranch: string;
            highestBid: number;
            bidCount: number;
            status: 'leading' | 'outbid';
            isYou: boolean;
          }
        >();

        for (const b of allAuctionBids) {
          const bIdStr = b.bidderId.toString();
          const isLeader = Boolean(auction.leaderId && auction.leaderId.equals(b.bidderId));
          const isYou = Boolean(currentUserId && currentUserId === bIdStr);

          if (!participantMap.has(bIdStr)) {
            const info = allUserMap.get(bIdStr);
            const name = info?.name || (isYou ? 'You' : 'Student Bidder');
            const initials = name
              .split(' ')
              .map((p) => p[0])
              .join('')
              .slice(0, 2)
              .toUpperCase() || 'SB';
            const sem = info?.sem ?? 4;
            const dept = info?.dept || 'Campus';
            const yearStr = sem >= 7 ? '4th Year' : sem >= 5 ? '3rd Year' : sem >= 3 ? '2nd Year' : '1st Year';

            participantMap.set(bIdStr, {
              id: bIdStr,
              name: isYou ? `${name} (You)` : name,
              initials,
              yearBranch: `${yearStr} · ${dept}`,
              highestBid: b.amount,
              bidCount: 1,
              status: isLeader ? 'leading' : 'outbid',
              isYou,
            });
          } else {
            const item = participantMap.get(bIdStr)!;
            item.bidCount += 1;
            if (b.amount > item.highestBid) {
              item.highestBid = b.amount;
            }
          }
        }

        const participants = Array.from(participantMap.values());
        participants.sort((a, b) => {
          if (a.status === 'leading') return -1;
          if (b.status === 'leading') return 1;
          return b.highestBid - a.highestBid;
        });

        return sendJson(res, 200, {
          ok: true,
          bids: formattedBids,
          total: totalBids,
          page,
          limit,
          hasMore: page * limit < totalBids,
          participants,
          uniqueParticipantsCount: participants.length,
          totalBidsCount: allAuctionBids.length,
          currentHighestBid: auction.currentPrice || auction.startPrice,
          leaderId: leaderIdStr,
        });
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid auction id' });
      }
    }

    // Single Auction Details (Enriched with Seller Info and Authoritative Live Bid Participants)
    const auctionDetailMatch = url.pathname.match(/^\/api\/auctions\/([a-fA-F0-9]{24})$/);
    if (auctionDetailMatch && req.method === 'GET') {
      const auctionId = auctionDetailMatch[1];
      try {
        const aId = new ObjectId(auctionId);
        const auction = await cols.auctions.findOne({ _id: aId });
        if (!auction) return sendJson(res, 404, { ok: false, error: 'Auction not found' });

        const auth = getAuthUser(req);
        const currentUserId = auth ? auth.userId : null;

        // Fetch seller details
        let sellerInfo = {
          id: auction.sellerId.toString(),
          name: 'Rahul S.',
          yearBranch: '3rd Year - CSE',
          verified: true,
        };
        const sellerStudent =
          (await cols.authorizedStudents.findOne({ _id: auction.sellerId })) ||
          (await cols.users.findOne({ _id: auction.sellerId }));
        if (sellerStudent) {
          const sName = sellerStudent.name || (sellerStudent as any).Name || 'Rahul S.';
          const sSem = sellerStudent.sem ?? (sellerStudent as any).Sem ?? 8;
          const sDept = (sellerStudent as any).department || (sellerStudent as any).Branch || 'CSE';
          const yearStr = sSem >= 7 ? '4th Year' : sSem >= 5 ? '3rd Year' : sSem >= 3 ? '2nd Year' : '1st Year';
          sellerInfo = {
            id: sellerStudent._id.toString(),
            name: sName,
            yearBranch: `${yearStr} - ${sDept}`,
            verified: true,
          };
        }

        // Fetch real accepted bids for this auction (authoritative, no fabricated mockups)
        const bids = await cols.bids.find({ auctionId: aId }).sort({ amount: -1, serverTs: -1 }).toArray();
        const bidderIds = Array.from(new Set(bids.map((b) => b.bidderId.toString()))).map((id) => new ObjectId(id));
        const usersDocs = await cols.users.find({ _id: { $in: bidderIds } }).toArray();
        const rosterDocs = await cols.authorizedStudents.find({ _id: { $in: bidderIds } }).toArray();

        const userMap = new Map<string, { name: string; sem: number; dept: string }>();
        for (const u of usersDocs) {
          userMap.set(u._id.toString(), { name: u.name, sem: u.sem, dept: u.department || 'Campus' });
        }
        for (const r of rosterDocs) {
          const idStr = r._id.toString();
          if (!userMap.has(idStr)) {
            const rName = r.name || (r as any).Name || 'Student Bidder';
            const rSem = r.sem ?? (r as any).Sem ?? 4;
            const rDept = (r as any).department || (r as any).Branch || 'Campus';
            userMap.set(idStr, { name: rName, sem: rSem, dept: rDept });
          }
        }

        const participantMap = new Map<
          string,
          {
            id: string;
            name: string;
            initials: string;
            yearBranch: string;
            highestBid: number;
            bidCount: number;
            status: 'leading' | 'outbid';
            isYou: boolean;
          }
        >();

        for (const b of bids) {
          const bIdStr = b.bidderId.toString();
          const isLeader = Boolean(auction.leaderId && auction.leaderId.equals(b.bidderId));
          const isYou = Boolean(currentUserId && currentUserId === bIdStr);

          if (!participantMap.has(bIdStr)) {
            const info = userMap.get(bIdStr);
            const name = info?.name || (isYou ? 'You' : 'Student Bidder');
            const initials = name
              .split(' ')
              .map((p) => p[0])
              .join('')
              .slice(0, 2)
              .toUpperCase() || 'SB';
            const sem = info?.sem ?? 4;
            const dept = info?.dept || 'Campus';
            const year = sem >= 7 ? '4th Year' : sem >= 5 ? '3rd Year' : sem >= 3 ? '2nd Year' : '1st Year';

            participantMap.set(bIdStr, {
              id: bIdStr,
              name: isYou ? `${name} (You)` : name,
              initials,
              yearBranch: `${year} · ${dept}`,
              highestBid: b.amount,
              bidCount: 1,
              status: isLeader ? 'leading' : 'outbid',
              isYou,
            });
          } else {
            const item = participantMap.get(bIdStr)!;
            item.bidCount += 1;
            if (b.amount > item.highestBid) {
              item.highestBid = b.amount;
            }
          }
        }

        const participants = Array.from(participantMap.values());
        participants.sort((a, b) => {
          if (a.status === 'leading') return -1;
          if (b.status === 'leading') return 1;
          return b.highestBid - a.highestBid;
        });

        const currentHigh = auction.currentPrice || auction.startPrice;

        return sendJson(res, 200, {
          ok: true,
          auction,
          seller: sellerInfo,
          participants,
          uniqueCount: participants.length,
          totalBidsCount: bids.length,
          currentHighestBid: currentHigh,
        });
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid auction id' });
      }
    }

    // Place Bid (Enforces Buyer only rule)
    if (url.pathname === '/api/bids' && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Please log in to place bids' });

      // Enforce: Sellers CANNOT bid on ANY item!
      if (auth.role === 'seller') {
        return sendJson(res, 403, {
          ok: false,
          reason: 'SELLER_CANNOT_BID',
          error: "Sellers cannot place bids on any auction. Only registered buyers can participate in bidding.",
        });
      }

      try {
        const payload = await readBody(req);
        if (!payload.auctionId || !payload.amount) {
          return sendJson(res, 400, { ok: false, error: 'auctionId and amount are required' });
        }

        const result = await placeBid(client, db, {
          auctionId: new ObjectId(payload.auctionId),
          bidderId: new ObjectId(auth.userId),
          amount: Number(payload.amount),
          idempotencyKey: payload.idempotencyKey || req.headers['x-idempotency-key']?.toString(),
          bidderRole: auth.role,
        });

        return sendJson(res, result.ok ? 200 : 400, result);
      } catch (err: any) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    // Auto-Bid Proxy Limit (Buyer only)
    if (url.pathname === '/api/auto-bids' && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Please log in' });
      if (auth.role === 'seller') {
        return sendJson(res, 403, { ok: false, error: 'Sellers cannot configure auto-bids' });
      }

      try {
        const { auctionId, maxAmount } = await readBody(req);
        if (!auctionId || !maxAmount) {
          return sendJson(res, 400, { ok: false, error: 'auctionId and maxAmount required' });
        }

        const aId = new ObjectId(auctionId);
        const uId = new ObjectId(auth.userId);
        const maxVal = Math.floor(Number(maxAmount));

        await cols.autoBids.updateOne(
          { auctionId: aId, userId: uId },
          {
            $set: { maxAmount: maxVal, createdAt: new Date() },
            $setOnInsert: { _id: new ObjectId() },
          },
          { upsert: true }
        );

        return sendJson(res, 200, { ok: true, maxAmount: maxVal });
      } catch (err: any) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    // Get User's Auto-Bid status
    if (url.pathname === '/api/auto-bids' && req.method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const auctionId = url.searchParams.get('auctionId');
      if (!auctionId) return sendJson(res, 400, { ok: false, error: 'auctionId required' });

      const existing = await cols.autoBids.findOne({
        auctionId: new ObjectId(auctionId),
        userId: new ObjectId(auth.userId),
      });

      return sendJson(res, 200, { ok: true, autoBid: existing });
    }

    // Buyer: My Bids (Leading | Outbid | Won | Lost)
    if (url.pathname === '/api/buyer/my-bids' && req.method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const userId = new ObjectId(auth.userId);

      // Find all auctions the user placed bids on
      const userBids = await cols.bids.find({ bidderId: userId }).toArray();
      const distinctAuctionIds = Array.from(new Set(userBids.map((b) => b.auctionId.toString()))).map((id) => new ObjectId(id));

      const auctions = await cols.auctions.find({ _id: { $in: distinctAuctionIds } }).toArray();

      const leading: Auction[] = [];
      const outbid: Auction[] = [];
      const won: Auction[] = [];
      const lost: Auction[] = [];

      for (const a of auctions) {
        if (a.status === 'active') {
          if (a.leaderId && a.leaderId.equals(userId)) {
            leading.push(a);
          } else {
            outbid.push(a);
          }
        } else if (['pending_approval', 'reserved', 'sold'].includes(a.status)) {
          if (a.leaderId && a.leaderId.equals(userId)) {
            won.push(a);
          } else {
            lost.push(a);
          }
        } else {
          lost.push(a);
        }
      }

      return sendJson(res, 200, { ok: true, leading, outbid, won, lost });
    }

    // Q&A List for an Auction
    if (url.pathname === '/api/questions' && req.method === 'GET') {
      const auctionId = url.searchParams.get('auctionId');
      if (!auctionId) return sendJson(res, 400, { ok: false, error: 'auctionId required' });

      const questions = await cols.questions
        .find({ auctionId: new ObjectId(auctionId) })
        .sort({ pinned: -1, createdAt: -1 })
        .toArray();

      return sendJson(res, 200, { ok: true, questions });
    }

    // Ask a Question (with duplicate detection)
    if (url.pathname === '/api/questions' && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Please log in to ask questions' });

      try {
        const { auctionId, text } = await readBody(req);
        if (!auctionId || !text || text.trim().length === 0) {
          return sendJson(res, 400, { ok: false, error: 'Question text required' });
        }

        const trimmed = text.trim();
        const aId = new ObjectId(auctionId);

        // Check for duplicate existing question
        const existing = await cols.questions.findOne({
          auctionId: aId,
          text: { $regex: `^${trimmed}$`, $options: 'i' },
        });

        if (existing) {
          return sendJson(res, 409, {
            ok: false,
            duplicate: true,
            existingQuestion: existing,
            error: 'An identical question has already been asked on this listing.',
          });
        }

        const newQ = {
          _id: new ObjectId(),
          auctionId: aId,
          askerId: new ObjectId(auth.userId),
          askerName: auth.name,
          text: trimmed,
          status: 'pending' as const,
          pinned: false,
          createdAt: new Date(),
        };

        await cols.questions.insertOne(newQ);

        // Notify seller
        const auction = await cols.auctions.findOne({ _id: aId });
        if (auction) {
          await cols.notifications.insertOne({
            _id: new ObjectId(),
            userId: auction.sellerId,
            type: 'QUESTION_ASKED',
            title: 'New Question on Your Listing',
            message: `A buyer asked: "${trimmed.slice(0, 50)}..." on "${auction.title}"`,
            payload: { auctionId: aId, questionId: newQ._id },
            createdAt: new Date(),
          });
        }

        await eventHub.emitAll([
          {
            type: 'QUESTION_ASKED',
            auctionId: aId,
            payload: { questionId: newQ._id, text: trimmed },
          },
        ]);

        return sendJson(res, 201, { ok: true, question: newQ });
      } catch (err: any) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    // Watchlist / "Looking for..." alerts
    if (url.pathname === '/api/watch-requests' && req.method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const requests = await cols.watchRequests
        .find({ userId: new ObjectId(auth.userId), active: true })
        .sort({ createdAt: -1 })
        .toArray();

      return sendJson(res, 200, { ok: true, requests });
    }

    if (url.pathname === '/api/watch-requests' && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      try {
        const { keywords, category, maxPrice, condition } = await readBody(req);
        if (!keywords || keywords.length === 0) {
          return sendJson(res, 400, { ok: false, error: 'Keywords required (e.g. ["scientific", "calculator"])' });
        }

        const reqDoc: WatchRequest = {
          _id: new ObjectId(),
          userId: new ObjectId(auth.userId),
          keywords: Array.isArray(keywords) ? keywords : [String(keywords)],
          category: category || undefined,
          maxPrice: maxPrice ? Number(maxPrice) : undefined,
          condition: condition || undefined,
          active: true,
          createdAt: new Date(),
        };

        await cols.watchRequests.insertOne(reqDoc);
        return sendJson(res, 201, { ok: true, request: reqDoc });
      } catch (err: any) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    if (url.pathname.startsWith('/api/watch-requests/') && req.method === 'DELETE') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const id = url.pathname.split('/').pop();
      await cols.watchRequests.updateOne(
        { _id: new ObjectId(id), userId: new ObjectId(auth.userId) },
        { $set: { active: false } }
      );
      return sendJson(res, 200, { ok: true });
    }

    // AI Assistant Tab: Chat & Action Proposal Cards
    if (url.pathname === '/api/ai/assistant' && req.method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      try {
        const { message } = await readBody(req);
        const userMsg = String(message || '').toLowerCase();

        // Retrieve active listings for smart context
        const activeListings = await cols.auctions.find({ status: 'active' }).limit(5).toArray();

        // Find relevant listing if user asked about a keyword
        let matched = activeListings.find((a) =>
          userMsg.includes(a.title.toLowerCase()) ||
          userMsg.includes(a.category.toLowerCase()) ||
          a.title.toLowerCase().split(' ').some((w) => userMsg.includes(w))
        );

        if (!matched && activeListings.length > 0) {
          matched = activeListings[0];
        }

        let reply = "Hello! I'm your CampusBid Assistant. I can help you find campus items, compare prices, or prepare smart bids.";
        let proposalCard: any = null;

        if (matched) {
          const nextBid = matched.currentPrice ? matched.currentPrice + matched.minIncrement : matched.startPrice;
          reply = `I checked the catalog! "${matched.title}" is currently active at ₹${matched.currentPrice || matched.startPrice}. The next valid bid is ₹${nextBid}. I've prepared a confirmation card below—tap Confirm whenever you're ready!`;
          proposalCard = {
            auctionId: matched._id,
            itemTitle: matched.title,
            recommendedBid: nextBid,
            maxLimit: matched.maxPrice,
            closesAt: matched.closesAt,
          };
        } else {
          reply = "There are currently no active listings that match your query. You can set a 'Looking for...' alert and I will notify you the moment a seller lists one!";
        }

        return sendJson(res, 200, {
          ok: true,
          reply,
          proposalCard,
        });
      } catch (err: any) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    // Notifications
    if (url.pathname === '/api/notifications' && req.method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const notifs = await cols.notifications
        .find({ userId: new ObjectId(auth.userId) })
        .sort({ createdAt: -1 })
        .limit(30)
        .toArray();

      const unreadCount = notifs.filter((n) => !n.readAt).length;
      return sendJson(res, 200, { ok: true, notifications: notifs, unreadCount });
    }

    if (url.pathname.startsWith('/api/notifications/') && url.pathname.endsWith('/read') && req.method === 'PUT') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      const parts = url.pathname.split('/');
      const notifId = parts[parts.length - 2];
      await cols.notifications.updateOne(
        { _id: new ObjectId(notifId), userId: new ObjectId(auth.userId) },
        { $set: { readAt: new Date() } }
      );
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/notifications/read-all' && req.method === 'PUT') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

      await cols.notifications.updateMany(
        { userId: new ObjectId(auth.userId), readAt: { $exists: false } },
        { $set: { readAt: new Date() } }
      );
      return sendJson(res, 200, { ok: true });
    }

    // 404
    return sendJson(res, 404, { ok: false, error: 'Not Found' });
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 Campus Auction API & Server is running at: http://localhost:${PORT}`);
    console.log(`   - Frontend App:       http://localhost:${PORT}/`);
    console.log(`   - API Routes:         http://localhost:${PORT}/api/browse`);
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
