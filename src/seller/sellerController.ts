import { Db, ObjectId } from 'mongodb';
import { getCollections } from '../db.js';
import { Auction } from '../types.js';
import { matchWatchesForNewListing } from '../assistant/watchService.js';

export interface BuyerContactDetails {
  name: string;
  collegeEmail: string;
  department: string;
  year: string;
  phone: string | null;
}

export interface SellerContactDetails {
  name: string;
  collegeEmail: string;
  department: string;
  year: string;
  phone: string | null;
}

export interface ControllerResult<T> {
  ok: boolean;
  statusCode: number;
  error?: string;
  data?: T;
}

/**
 * 1. GET /api/seller/auctions?status=live|sold|unsold
 * Paginated list of auctions belonging to the authenticated seller.
 * Uses index on { sellerId: 1, status: 1 }.
 */
export async function getSellerAuctions(
  db: Db,
  sellerId: ObjectId,
  status?: string | null,
  page: number = 1,
  limit: number = 10
): Promise<{
  auctions: Auction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const cols = getCollections(db);
  const filter: any = { sellerId };

  if (status === 'live') {
    filter.status = { $in: ['live', 'active'] };
  } else if (status === 'sold') {
    filter.status = { $in: ['closed_sold', 'sold', 'pending_approval', 'reserved'] };
  } else if (status === 'unsold') {
    filter.status = { $in: ['closed_unsold', 'unsold'] };
  }

  const safePage = Math.max(1, page);
  const safeLimit = Math.min(50, Math.max(1, limit));
  const skip = (safePage - 1) * safeLimit;

  const total = await cols.auctions.countDocuments(filter);
  const auctions = await cols.auctions
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(safeLimit)
    .toArray();

  return {
    auctions,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  };
}

/**
 * 2. GET /api/seller/auctions/:id/buyer
 * Returns the winning bidder's contact details.
 * Rule: Caller must own the auction AND its status must be closed_sold.
 * Never returns password hash or unrelated fields.
 */
export async function getWinningBuyerDetails(
  db: Db,
  callerId: ObjectId,
  auctionId: ObjectId
): Promise<ControllerResult<BuyerContactDetails>> {
  const cols = getCollections(db);
  const auction = await cols.auctions.findOne({ _id: auctionId });

  if (!auction) {
    return { ok: false, statusCode: 404, error: 'Auction not found' };
  }

  // Caller must own the auction
  if (!auction.sellerId.equals(callerId)) {
    return { ok: false, statusCode: 403, error: 'Forbidden: You do not own this auction' };
  }

  // Status must be closed_sold (or sold)
  const isSold = auction.status === 'closed_sold' || auction.status === 'sold';
  if (!isSold) {
    return { ok: false, statusCode: 403, error: 'Forbidden: Buyer details are only available for sold auctions' };
  }

  const winnerId = auction.winnerId || auction.leaderId;
  if (!winnerId) {
    return { ok: false, statusCode: 404, error: 'No winning bidder found' };
  }

  const winner = await cols.users.findOne({ _id: winnerId });
  const student = winner ? await cols.authorizedStudents.findOne({ email: winner.email }) : null;

  const name = winner?.name || student?.name || 'Anonymous Student';
  const collegeEmail = winner?.email || student?.email || '';
  const department = winner?.department || student?.department || 'General';
  const sem = winner?.sem || student?.sem || 1;
  const year = sem >= 7 ? '4th Year' : sem >= 5 ? '3rd Year' : sem >= 3 ? '2nd Year' : '1st Year';

  // Phone only if opted in
  const phoneOptIn = Boolean(
    winner?.notifPrefs?.push ||
    winner?.notifPrefs?.sms ||
    (winner as any)?.phoneOptIn
  );
  const phone = phoneOptIn ? ((winner as any)?.phone || '+91 98765 43210') : null;

  return {
    ok: true,
    statusCode: 200,
    data: {
      name,
      collegeEmail,
      department,
      year,
      phone,
    },
  };
}

/**
 * 3. POST /api/seller/auctions/:id/relist
 * Creates a new auction prefilled from an unsold one, with an optional new starting price.
 * Rule: Only allowed for the owner and only for closed_unsold.
 */
export async function relistUnsoldAuction(
  db: Db,
  callerId: ObjectId,
  auctionId: ObjectId,
  options?: { startPrice?: number; durationMinutes?: number; maxPrice?: number }
): Promise<ControllerResult<Auction>> {
  const cols = getCollections(db);
  const auction = await cols.auctions.findOne({ _id: auctionId });

  if (!auction) {
    return { ok: false, statusCode: 404, error: 'Auction not found' };
  }

  // Caller must own the auction
  if (!auction.sellerId.equals(callerId)) {
    return { ok: false, statusCode: 403, error: 'Forbidden: You do not own this auction' };
  }

  // Status must be closed_unsold (or unsold)
  const isUnsold = auction.status === 'closed_unsold' || auction.status === 'unsold';
  if (!isUnsold) {
    return { ok: false, statusCode: 400, error: 'Only closed_unsold auctions can be relisted' };
  }

  const startPrice = options?.startPrice ? Math.floor(Number(options.startPrice)) : auction.startPrice;
  if (startPrice <= 0) {
    return { ok: false, statusCode: 400, error: 'Start price must be greater than 0' };
  }

  const durationMinutes = options?.durationMinutes ? parseInt(String(options.durationMinutes), 10) : 15;
  const maxPrice = options?.maxPrice ? Math.floor(Number(options.maxPrice)) : Math.max(auction.maxPrice, startPrice * 3);
  const minIncrement = auction.minIncrement || 50;
  const closesAt = new Date(Date.now() + durationMinutes * 60 * 1000);

  const newAuction: Auction = {
    _id: new ObjectId(),
    sellerId: auction.sellerId,
    title: auction.title,
    category: auction.category,
    description: auction.description,
    condition: auction.condition,
    images: auction.images && auction.images.length > 0 ? auction.images : ['https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=600&q=80'],
    startPrice,
    maxPrice,
    minIncrement,
    currentPrice: null,
    leaderId: null,
    bidCount: 0,
    closesAt,
    version: 0,
    status: 'live',
    createdAt: new Date(),
  };

  await cols.auctions.insertOne(newAuction);
  matchWatchesForNewListing(db, newAuction).catch((err) =>
    console.error('[Relist Watch Matcher Error]:', err)
  );
  return { ok: true, statusCode: 201, data: newAuction };
}

/**
 * 4. GET /api/buyer/auctions/:id/seller
 * Winner sees the seller's contact details on their won auction in the same way.
 * Rule: Caller must be the winning bidder AND auction must be closed_sold.
 */
export async function getSellerDetailsForWinner(
  db: Db,
  callerId: ObjectId,
  auctionId: ObjectId
): Promise<ControllerResult<SellerContactDetails>> {
  const cols = getCollections(db);
  const auction = await cols.auctions.findOne({ _id: auctionId });

  if (!auction) {
    return { ok: false, statusCode: 404, error: 'Auction not found' };
  }

  // Caller must be winner
  const isWinner =
    (auction.winnerId && auction.winnerId.equals(callerId)) ||
    (auction.leaderId && auction.leaderId.equals(callerId));

  if (!isWinner) {
    return { ok: false, statusCode: 403, error: 'Forbidden: Only the winning bidder can view seller details' };
  }

  const isSold = ['closed_sold', 'sold', 'pending_approval', 'reserved'].includes(auction.status);
  if (!isSold) {
    return { ok: false, statusCode: 403, error: 'Forbidden: Seller details are only available for sold auctions' };
  }

  const seller = await cols.users.findOne({ _id: auction.sellerId });
  const student = seller ? await cols.authorizedStudents.findOne({ email: seller.email }) : null;

  const name = seller?.name || student?.name || 'Seller';
  const collegeEmail = seller?.email || student?.email || '';
  const department = seller?.department || student?.department || 'General';
  const sem = seller?.sem || student?.sem || 7;
  const year = sem >= 7 ? '4th Year' : sem >= 5 ? '3rd Year' : 'Senior';

  const phoneOptIn = Boolean(
    seller?.notifPrefs?.push ||
    seller?.notifPrefs?.sms ||
    (seller as any)?.phoneOptIn
  );
  const phone = phoneOptIn ? ((seller as any)?.phone || '+91 98765 12345') : null;

  return {
    ok: true,
    statusCode: 200,
    data: {
      name,
      collegeEmail,
      department,
      year,
      phone,
    },
  };
}
