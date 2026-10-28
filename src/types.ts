import { ObjectId } from 'mongodb';

export type UserRole = 'seller' | 'buyer';

export interface AuthorizedStudent {
  _id: ObjectId;
  email: string;
  name?: string;
  sem: number; // 1 to 9 (7, 8, 9 = Seller; others = Buyer)
  department?: string;
  createdAt: Date;
}

export type UserNotificationPreferences = {
  email?: boolean;
  push?: boolean;
  sms?: boolean;
};

export interface User {
  _id: ObjectId;
  name: string;
  email: string;
  passwordHash?: string;
  role: UserRole;
  sem: number;
  department?: string;
  notifPrefs?: UserNotificationPreferences;
  createdAt: Date;
  updatedAt?: Date;
}

export type AuctionStatus =
  | 'live'
  | 'active'
  | 'closed_sold'
  | 'closed_unsold'
  | 'pending_approval'
  | 'reserved'
  | 'sold'
  | 'unsold'
  | 'closed'
  | 'cancelled';

export interface Auction {
  _id: ObjectId;
  sellerId: ObjectId;
  title: string;
  category: string;
  description: string;
  condition: string;
  images: string[];
  startPrice: number;            // in integer rupees
  maxPrice: number;              // in integer rupees (hard buy/lock price)
  minIncrement: number;          // in integer rupees
  currentPrice: number | null;   // null until first accepted bid
  leaderId: ObjectId | null;     // null until first accepted bid
  bidCount: number;
  closesAt: Date;                // Authoritative server closing deadline
  version: number;               // Document version incremented on each state change
  status: AuctionStatus;
  outcomeReason?: string;

  // Closing & Handover fields
  winningBidId?: ObjectId;
  winnerId?: ObjectId;
  approvalDecision?: 'approved' | 'rejected';
  approvalReason?: string;
  handoverStatus?: 'pending' | 'confirmed' | 'failed';
  handoverNotes?: string;

  createdAt: Date;
  updatedAt?: Date;
}

export type BidSource = 'manual' | 'auto';

export interface Bid {
  _id: ObjectId;
  auctionId: ObjectId;
  bidderId: ObjectId;
  amount: number;                // in integer rupees
  serverTs: Date;                // Server timestamp
  createdAt?: Date;              // Server-generated timestamp
  source: BidSource;
  idempotencyKey?: string;
}

export interface AutoBid {
  _id: ObjectId;
  auctionId: ObjectId;
  userId: ObjectId;
  maxAmount: number;             // Maximum cap in integer rupees
  watchId?: ObjectId;            // Set when triggered by a Watch auto-bid
  listingId?: ObjectId;          // Same as auctionId, for unique index idempotency
  createdAt: Date;
}


export type QuestionStatus = 'pending' | 'answered';

export interface Question {
  _id: ObjectId;
  auctionId: ObjectId;
  askerId: ObjectId;
  askerName?: string;
  text: string;
  answer?: string;
  answeredAt?: Date;
  status: QuestionStatus;
  pinned: boolean;
  createdAt: Date;
}

export interface WatchRequest {
  _id: ObjectId;
  userId: ObjectId;
  keywords: string[];
  category?: string;
  maxPrice?: number;
  condition?: string;
  active: boolean;
  createdAt: Date;
}

export type WatchStatus = 'active' | 'paused' | 'fulfilled' | 'expired';

export interface Watch {
  _id: ObjectId;
  userId: ObjectId;
  keywords: string[];
  category?: string;
  maxPrice?: number;          // legacy: max price for notification filtering

  // Auto-bid fields
  autoBid: boolean;           // whether auto-bidding is enabled
  maxBudget?: number;         // hard cap in rupees — NEVER exceeded
  conditionFilter?: string;   // optional: only match this condition
  status: WatchStatus;        // active | paused | fulfilled | expired
  activeAutoBidAuctionId?: ObjectId | null; // currently live auto-bid auction
  authorizedAt?: Date;        // when the student confirmed the auto-bid

  active: boolean;            // legacy compat: active = status === 'active'
  createdAt: Date;
  expiresAt: Date;            // 30 days
  lastMatchedAt?: Date | null;
}

export type AssistantProposalType = 'autobid' | 'watch' | 'watch_autobid';

export interface AssistantProposal {
  _id: ObjectId;
  userId: ObjectId;
  type: AssistantProposalType;
  parameters: {
    listingId?: string;
    itemTitle?: string;
    maxAmount?: number;
    currentPrice?: number;
    keywords?: string[];
    category?: string;
    maxPrice?: number;
    maxBudget?: number;         // for watch_autobid proposals
    conditionFilter?: string;   // for watch_autobid proposals
    autoBid?: boolean;
    image?: string;
    [key: string]: any;
  };
  summary: string;
  status: 'pending' | 'approved' | 'dismissed' | 'expired';
  createdAt: Date;
  expiresAt: Date; // 10 minutes
}

export interface SanitizedListingCard {
  id: string;
  title: string;
  category: string;
  condition: string;
  startPrice: number;
  currentPrice: number | null;
  bidCount: number;
  timeLeft: string;
  image: string;
}

export interface AssistantChatMessage {
  _id: ObjectId;
  userId: ObjectId;
  role: 'user' | 'assistant';
  content: string;
  proposals?: AssistantProposal[];
  listingCards?: SanitizedListingCard[];
  createdAt: Date;
}

export interface Notification {
  _id: ObjectId;
  userId: ObjectId;
  type: string;
  title: string;
  message: string;
  price?: number;
  link?: string;
  watchId?: ObjectId;
  listingId?: ObjectId;
  payload?: Record<string, unknown>;
  readAt?: Date;
  createdAt: Date;
}

export interface AuctionEvent {
  _id: ObjectId;
  auctionId: ObjectId;
  type: string;
  payload: Record<string, unknown>;
  ts: Date;
}

export type BidRejectReason =
  | 'NOT_FOUND'
  | 'NOT_ACTIVE'
  | 'CLOSED'
  | 'OWN_ITEM'
  | 'SELLER_CANNOT_BID'
  | 'MAX_REACHED'
  | 'TOO_LOW_OR_STALE';

export interface PlaceBidParams {
  auctionId: ObjectId;
  bidderId: ObjectId;
  amount: number;
  idempotencyKey?: string;
  bidderRole?: UserRole;
}

export type BidSuccessResult = {
  ok: true;
  replay?: boolean;
  bid: Bid;
  auction: Auction;
  autoBidsPlaced: Bid[];
  extendedDeadline: boolean;
};

export type BidRejectResult = {
  ok: false;
  reason: BidRejectReason;
  details?: Record<string, unknown>;
};

export type BidResult = BidSuccessResult | BidRejectResult;

export interface OutboxEvent {
  type:
    | 'BID_PLACED'
    | 'OUTBID'
    | 'DEADLINE_EXTENDED'
    | 'AUCTION_MAX_REACHED'
    | 'AUTO_BID_TRIGGERED'
    | 'QUESTION_ASKED'
    | 'QUESTION_ANSWERED'
    | 'AUCTION_ENDED'
    | 'AUCTION_WON'
    | 'AUCTION_LOST'
    | 'AUCTION_APPROVED'
    | 'AUCTION_REJECTED'
    | 'HANDOVER_CONFIRMED'
    | 'WATCH_MATCH'
    | 'AUTO_BID_PLACED'
    | 'AUTO_BID_OUTBID'
    | 'AUTO_BID_FAILED'
    | 'WATCH_FULFILLED';
  targetUserId?: ObjectId;
  auctionId: ObjectId;
  payload: Record<string, unknown>;
}
