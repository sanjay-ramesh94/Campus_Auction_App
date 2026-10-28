export type UserRole = 'seller' | 'buyer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  sem: number;
  department?: string;
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

export interface BuyerContactDetails {
  name: string;
  collegeEmail: string;
  department: string;
  year: string;
  phone: string | null;
}

export interface Auction {
  _id: string;
  sellerId: string;
  title: string;
  category: string;
  description: string;
  condition: string;
  images: string[];
  startPrice: number;
  maxPrice: number;
  minIncrement: number;
  currentPrice: number | null;
  leaderId: string | null;
  bidCount: number;
  closesAt: string;
  version: number;
  status: AuctionStatus;
  outcomeReason?: string;

  // Lifecycle & Handover fields
  winningBidId?: string;
  winnerId?: string;
  approvalDecision?: 'approved' | 'rejected';
  approvalReason?: string;
  handoverStatus?: 'pending' | 'confirmed' | 'failed';
  handoverNotes?: string;

  yourBid?: number;
  isHighest?: boolean;

  createdAt: string;
}

export interface LiveBidParticipant {
  id: string;
  name: string;
  initials: string;
  yearBranch: string;
  highestBid: number;
  bidCount: number;
  status: 'leading' | 'outbid';
  isYou?: boolean;
}

export interface BidHistoryItem {
  _id: string;
  auctionId: string;
  bidderId: string;
  bidderName: string;
  bidderInitials: string;
  bidderYearBranch?: string;
  amount: number;
  serverTs: string;
  createdAt: string;
  source: 'manual' | 'auto';
  isLeading: boolean;
  isYou: boolean;
}

export interface Bid {
  _id: string;
  auctionId: string;
  bidderId: string;
  amount: number;
  serverTs: string;
  source: 'manual' | 'auto';
  idempotencyKey?: string;
}

export interface AutoBid {
  _id: string;
  auctionId: string;
  userId: string;
  maxAmount: number;
  createdAt: string;
}

export interface Question {
  _id: string;
  auctionId: string;
  askerId: string;
  askerName?: string;
  text: string;
  answer?: string;
  answeredAt?: string;
  status: 'pending' | 'answered';
  pinned?: boolean;
  createdAt: string;
}

export interface WatchRequest {
  _id: string;
  userId: string;
  keywords: string[];
  category?: string;
  maxPrice?: number;
  condition?: string;
  active: boolean;
  createdAt: string;
}

export interface NotificationItem {
  _id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  payload: Record<string, any>;
  readAt?: string;
  createdAt: string;
}

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
}

export interface ProposalCard {
  auctionId: string;
  itemTitle: string;
  recommendedBid: number;
  maxLimit: number;
  closesAt: string;
}

export type WatchStatus = 'active' | 'paused' | 'fulfilled' | 'expired';

export interface WatchItem {
  _id: string;
  userId: string;
  keywords: string[];
  category?: string;
  maxPrice?: number;
  // Auto-bid fields
  autoBid: boolean;
  maxBudget?: number;
  conditionFilter?: string;
  status: WatchStatus;
  activeAutoBidAuctionId?: string | null;
  authorizedAt?: string;
  active: boolean;
  createdAt: string;
  expiresAt: string;
  lastMatchedAt?: string | null;
}

export interface AssistantProposalItem {
  _id: string;
  userId: string;
  type: 'autobid' | 'watch';
  parameters: {
    listingId?: string;
    itemTitle?: string;
    maxAmount?: number;
    currentPrice?: number;
    keywords?: string[];
    category?: string;
    maxPrice?: number;
    image?: string;
    [key: string]: any;
  };
  summary: string;
  status: 'pending' | 'approved' | 'dismissed' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export interface AssistantListingCard {
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
  _id?: string;
  id?: string;
  sender: 'user' | 'assistant';
  role?: 'user' | 'assistant';
  text: string;
  content?: string;
  proposals?: AssistantProposalItem[];
  listingCards?: AssistantListingCard[];
  createdAt?: string;
}

export interface PublicPresenceUser {
  userId: string;
  name: string;
  initials: string;
  isLeader: boolean;
  isBidder: boolean;
  isVisible: boolean;
}

export interface AuctionPresencePayload {
  type?: 'PRESENCE_UPDATE';
  auctionId: string;
  totalPresent: number;
  activeCount: number;
  awayCount: number;
  users: PublicPresenceUser[];
}
