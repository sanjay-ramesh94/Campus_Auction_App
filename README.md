# Campus Auction Engine (MongoDB Persistence & Transactional Concurrency)

This repository contains the transactional bidding engine, MongoDB schema definitions, index initialization, auto-bid proxy resolution, and concurrency validation suite for the campus auction platform.

## Architecture Highlights

1. **MongoDB Multi-Document ACID Transactions:**
   - Every bid invocation (`placeBid`) runs inside `session.withTransaction()`.
   - The `auctions` document serves as the **sole serialization point**.
   - Competing concurrent bids trigger write conflicts on the auction document; MongoDB's transaction runner automatically retries them, immediately re-evaluating price rules against fresh state.
   - Separate `bids` collection prevents documents from reaching MongoDB's 16 MB limit and allows seamless pagination.

2. **Integer Rupees:**
   - All prices (`startPrice`, `currentPrice`, `maxPrice`, `minIncrement`, `amount`) are stored and calculated strictly as integers in rupees (₹) to eliminate floating-point drift.

3. **Authoritative Server Time & Anti-Sniping Protection:**
   - Timestamps are generated on the server (`new Date()`).
   - If an accepted bid is placed within 30 seconds of `closesAt`, the deadline is extended by 60 seconds (`closesAt = now + 60s`) atomically.

4. **In-Transaction Auto-Bid Proxy Battle:**
   - Active auto-bids (`autoBids` collection) are resolved iteratively inside the same transaction.
   - Competing auto-bidders escalate in increments of `minIncrement` until equilibrium or caps are reached.

5. **Post-Commit Outbox Pattern:**
   - Notifications and SSE events are queued in-memory and emitted **strictly after** the transaction commits to prevent ghost notifications on retried transactions.

---

## Directory Structure

```
campus-auction/
├── DECISIONS.md              # Architectural decisions and trade-offs
├── docker-compose.yml        # Local single-node replica set (rs0)
├── .env.example              # Environment variables template
├── package.json              # Project dependencies & scripts
├── tsconfig.json             # TypeScript configuration
├── vitest.config.ts          # Vitest testing configuration
├── src/
│   ├── types.ts              # Collections (users, auctions, bids, autoBids, etc.)
│   ├── db.ts                 # Collection accessors and ensureIndexes()
│   ├── index.ts              # Entry point and barrel export
│   └── bidding/
│       ├── rules.ts          # nextMinBid and anti-sniping calculation
│       ├── autoBidResolver.ts# Auto-bid proxy loop
│       ├── placeBid.ts       # placeBid with session.withTransaction
│       └── events.ts         # Post-commit event emitter hub
└── tests/
    ├── setup.ts              # MongoMemoryReplSet harness
    ├── concurrency.test.ts   # 20 parallel placeBid calls validation
    ├── bidding.test.ts       # Business validation, anti-sniping, idempotency
    └── autoBids.test.ts      # Single and competing auto-bid tests
```

---

## Getting Started

### 1. Prerequisites
- Node.js v18+
- Docker (optional, for local MongoDB replica set)

### 2. Run Local MongoDB Replica Set
```bash
docker compose up -d
```
Or start mongod locally with a replica set:
```bash
mongod --replSet rs0 --dbpath ./data
# In another terminal:
mongosh --eval "rs.initiate()"
```

### 3. Run the Test Suite
Tests utilize `MongoMemoryReplSet` for fully isolated in-memory replica set validation without needing an external MongoDB instance:
```bash
npm test
```
