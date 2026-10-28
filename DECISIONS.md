# Architectural Decisions: Bidding Engine & MongoDB Persistence Layer

## Context
The campus auction platform requires strong consistency, real-time responsive bidding, auto-bid resolution, anti-sniping deadline extensions, and high concurrent throughput. We migrated the persistence layer and concurrency mechanism to MongoDB.

---

## 1. Persistence & Concurrency Model: MongoDB Multi-Document Transactions

### Decision
We use **MongoDB multi-document ACID transactions** (`session.withTransaction()`) with the **auction document as the sole serialization point**.

### Rationale
- MongoDB guarantees atomic single-document updates. By updating the auction document (`auctions`) in the same transaction as inserting the bid (`bids`), any two concurrent bids on the same auction will produce a write conflict on the auction document.
- MongoDB's driver automatically retries the transaction upon encountering transient transaction errors (like `WriteConflict`). On retry, the transaction re-reads the fresh auction document state (latest `currentPrice`, `version`, and `closesAt`), so the loser of the race naturally gets rejected with `TOO_LOW_OR_STALE` or succeeds with an updated price.
- Bids and auctions are kept in separate collections (never embedding bid history inside the auction document), preventing the auction document from reaching MongoDB's 16 MB BSON size limit and enabling efficient pagination and indexing.

### Alternative Considered: Compare-and-Set (CAS) with Version Field
- Fallback approach: conditional `findOneAndUpdate` checking `{ _id, version: seenVersion, currentPrice: seenPrice }`.
- **Why not chosen as primary:** While functional in standalone MongoDB without a replica set, CAS makes complex multi-stage operations (such as atomic auto-bid chains, outbox event generation, and crash-consistent rollbacks) significantly more complex and brittle.

---

## 2. Integer Currency (Rupees)

### Decision
All monetary values (`startPrice`, `maxPrice`, `minIncrement`, `currentPrice`, `amount`, `maxAmount`) are stored and computed strictly as **integers in Rupees (₹)**.

### Rationale
- Floating-point representations (IEEE 754) introduce rounding anomalies (e.g. `0.1 + 0.2 !== 0.3`).
- In campus commerce, transactions occur in integer rupees without paise fractions. For any sub-unit requirements, storing in paise (smallest integer unit) avoids rounding drift.

---

## 3. Server-Side Authoritative Time & Anti-Sniping Protection

### Decision
- All auction checks (`now >= closesAt`) use authoritative server timestamps (`new Date()`), never client-supplied clocks.
- **Anti-Sniping Rule:** If an accepted bid is placed within 30 seconds of closing (`closesAt - now <= 30_000`), `closesAt` is automatically extended by 60 seconds from `now` (`new Date(now.getTime() + 60_000)`).
- The extension is written atomically within the same update query as the price update and version increment.

---

## 4. Business Rejections vs Transaction Aborts

### Decision
Business validation failures (e.g., `NOT_ACTIVE`, `CLOSED`, `OWN_ITEM`, `MAX_REACHED`, `TOO_LOW_OR_STALE`) **do not throw exceptions** inside `session.withTransaction()`. Instead, they return a structured rejection object `{ ok: false, error: ... }`.

### Rationale
- Throwing exceptions inside `session.withTransaction()` causes MongoDB to treat the transaction as aborted with an error, triggering unneeded automatic retry attempts on error labels.
- Structured rejection results cleanly abort without writes, leaving state untouched and saving database round-trips.

---

## 5. Post-Commit Event Emission (SSE & Push Notifications)

### Decision
Side effects (such as Server-Sent Events (SSE), web push notifications, and analytics events) are queued during the transaction but **emitted strictly AFTER the transaction commits successfully**.

### Rationale
- `session.withTransaction()` can execute its callback multiple times if a transient conflict occurs.
- Emitting SSE or notifications inside the callback would send duplicate or ghost notifications for aborted/retried attempts.

---

## 6. Auto-Bid Resolution in the Same Transaction

### Decision
When an accepted bid is placed, any competing active auto-bids (`autoBids` collection) are resolved immediately within the **exact same transaction**.

### Rationale
- Guarantees immediate consistency: the bidder instantly knows if an existing auto-bid outbid them.
- Prevents race conditions between a manual bidder and auto-bidders.
- All competing bids are recorded as distinct bid documents with `source: 'auto'`, maintaining an immutable audit log.

---

## 7. Testing Strategy: In-Memory Replica Set

### Decision
Vitest tests utilize `MongoMemoryReplSet` from `mongodb-memory-server` instead of standard standalone `MongoMemoryServer`.

### Rationale
- MongoDB transactions strictly require a replica set topology.
- `MongoMemoryReplSet` provides an isolated, zero-dependency in-memory replica set for testing transactional concurrency, conflict retries, and atomic rollbacks.

---

## 8. Role Authorization & Strict Role Separation (Sellers Cannot Buy)

### Decision
The platform enforces strict server-side role derivation at each login based on the campus roster (`authorizedStudents` collection):
- Semesters **7, 8, and 9** are assigned the **`seller`** role.
- All other semesters are assigned the **`buyer`** role.
- Unregistered emails are blocked from account creation.
- **Sellers Cannot Bid:** A student with the `seller` role is strictly prohibited from placing bids or setting auto-bids on **ANY** listing (own or other sellers'). The backend enforces this rule with the `SELLER_CANNOT_BID` rejection code, and the UI completely hides bidding controls for sellers.

### Rationale & Future Trade-offs
- Prevents conflicting campus seller incentives, shill bidding, and bidding collusion between graduating batches.
- If a senior seller wishes to buy an item, campus policy currently does not allow cross-role participation on the same account. A dual-account or secondary buyer persona may be evaluated in future phases, but the single-role invariant remains authoritative for this release.
