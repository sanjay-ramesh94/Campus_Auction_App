import { Db, Collection } from 'mongodb';
import {
  User,
  AuthorizedStudent,
  Auction,
  Bid,
  AutoBid,
  Question,
  WatchRequest,
  Watch,
  AssistantProposal,
  AssistantChatMessage,
  Notification,
  AuctionEvent,
} from './types.js';

export interface Collections {
  authorizedStudents: Collection<AuthorizedStudent>;
  users: Collection<User>;
  auctions: Collection<Auction>;
  bids: Collection<Bid>;
  autoBids: Collection<AutoBid>;
  questions: Collection<Question>;
  watchRequests: Collection<WatchRequest>;
  watches: Collection<Watch>;
  assistantProposals: Collection<AssistantProposal>;
  assistantMessages: Collection<AssistantChatMessage>;
  notifications: Collection<Notification>;
  events: Collection<AuctionEvent>;
}

export function getCollections(db: Db): Collections {
  return {
    authorizedStudents: db.collection<AuthorizedStudent>('authorizedStudents'),
    users: db.collection<User>('users'),
    auctions: db.collection<Auction>('auctions'),
    bids: db.collection<Bid>('bids'),
    autoBids: db.collection<AutoBid>('autoBids'),
    questions: db.collection<Question>('questions'),
    watchRequests: db.collection<WatchRequest>('watchRequests'),
    watches: db.collection<Watch>('watches'),
    assistantProposals: db.collection<AssistantProposal>('assistantProposals'),
    assistantMessages: db.collection<AssistantChatMessage>('assistantMessages'),
    notifications: db.collection<Notification>('notifications'),
    events: db.collection<AuctionEvent>('events'),
  };
}

/**
 * Ensures all required collections and indexes are set up in MongoDB.
 * Safe to call on application startup or test harness initialization.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  const collections = getCollections(db);

  // 0. authorizedStudents: index on email and 'Mail ID' (non-unique to support varied college sheets)
  await collections.authorizedStudents.createIndex(
    { email: 1 },
    { name: 'authorizedStudents_email_idx' }
  );
  await collections.authorizedStudents.createIndex(
    { 'Mail ID': 1 },
    { name: 'authorizedStudents_mail_id_idx' }
  );

  // 1. users: unique email
  await collections.users.createIndex(
    { email: 1 },
    { unique: true, name: 'users_email_unique' }
  );

  // 2. auctions:
  // - text index on title and description for search
  // - compound index on { status, closesAt } for closing sweeps and active queries
  // - compound index on { category, condition, currentPrice } for catalog browsing and filtering
  await collections.auctions.createIndex(
    { title: 'text', description: 'text' },
    { name: 'auctions_text_search' }
  );
  await collections.auctions.createIndex(
    { status: 1, closesAt: 1 },
    { name: 'auctions_status_closesAt' }
  );
  await collections.auctions.createIndex(
    { category: 1, condition: 1, currentPrice: 1 },
    { name: 'auctions_category_condition_price' }
  );
  await collections.auctions.createIndex(
    { sellerId: 1, status: 1 },
    { name: 'auctions_sellerId_status' }
  );

  // 3. bids:
  // - unique partial index on { bidderId, idempotencyKey } (only indexes docs where idempotencyKey exists)
  // - compound index on { auctionId, serverTs } for chronological bid history pagination
  await collections.bids.createIndex(
    { bidderId: 1, idempotencyKey: 1 },
    {
      unique: true,
      partialFilterExpression: {
        idempotencyKey: { $exists: true, $type: 'string' },
      },
      name: 'bids_bidderId_idempotencyKey_unique',
    }
  );
  await collections.bids.createIndex(
    { auctionId: 1, serverTs: 1 },
    { name: 'bids_auctionId_serverTs' }
  );

  // 4. autoBids:
  // - unique compound index on { auctionId, userId } (one auto-bid limit per user per auction)
  await collections.autoBids.createIndex(
    { auctionId: 1, userId: 1 },
    { unique: true, name: 'autoBids_auctionId_userId_unique' }
  );

  // 5. questions:
  // - compound index on { auctionId, createdAt }
  await collections.questions.createIndex(
    { auctionId: 1, createdAt: 1 },
    { name: 'questions_auctionId_createdAt' }
  );

  // 6. watchRequests:
  // - compound index on { active, category }
  // - text index on keywords
  await collections.watchRequests.createIndex(
    { active: 1, category: 1 },
    { name: 'watchRequests_active_category' }
  );
  await collections.watchRequests.createIndex(
    { keywords: 'text' },
    { name: 'watchRequests_keywords_text' }
  );

  // 7. notifications:
  // - compound index on { userId, readAt }
  // - unique partial index on { watchId, listingId }
  await collections.notifications.createIndex(
    { userId: 1, readAt: 1 },
    { name: 'notifications_userId_readAt' }
  );
  await collections.notifications.createIndex(
    { watchId: 1, listingId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        watchId: { $exists: true },
        listingId: { $exists: true },
      },
      name: 'notifications_watchId_listingId_unique',
    }
  );

  // 8. events:
  // - compound index on { auctionId, ts }
  await collections.events.createIndex(
    { auctionId: 1, ts: 1 },
    { name: 'events_auctionId_ts' }
  );

  // 9. watches:
  // - compound index on { active, category }
  // - compound index on { userId, active }
  // - compound index on { autoBid, status, expiresAt } for matcher queries
  await collections.watches.createIndex(
    { active: 1, category: 1 },
    { name: 'watches_active_category' }
  );
  await collections.watches.createIndex(
    { userId: 1, active: 1 },
    { name: 'watches_userId_active' }
  );
  await collections.watches.createIndex(
    { autoBid: 1, status: 1, expiresAt: 1 },
    { name: 'watches_autoBid_status_expiresAt' }
  );
  await collections.watches.createIndex(
    { activeAutoBidAuctionId: 1 },
    {
      sparse: true,
      name: 'watches_activeAutoBidAuctionId',
    }
  );

  // Unique index on (watchId, listingId) in autoBids collection
  // Prevents retry from creating two auto-bids for the same watch+listing
  await collections.autoBids.createIndex(
    { watchId: 1, listingId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        watchId: { $exists: true },
        listingId: { $exists: true },
      },
      name: 'autoBids_watchId_listingId_unique',
    }
  );

  // 10. assistantProposals:
  // - compound index on { userId, expiresAt }
  await collections.assistantProposals.createIndex(
    { userId: 1, expiresAt: 1 },
    { name: 'assistantProposals_userId_expiresAt' }
  );

  // 11. assistantMessages:
  // - compound index on { userId, createdAt }
  await collections.assistantMessages.createIndex(
    { userId: 1, createdAt: -1 },
    { name: 'assistantMessages_userId_createdAt' }
  );
}
