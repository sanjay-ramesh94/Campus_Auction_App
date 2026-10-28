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
