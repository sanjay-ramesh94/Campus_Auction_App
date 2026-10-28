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
  status: 'active' | 'closed' | 'cancelled';
  createdAt: string;
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

export interface UserPersona {
  id: string;
  name: string;
  role: string;
  avatar: string;
}

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
}
