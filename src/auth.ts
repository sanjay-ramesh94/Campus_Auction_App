import crypto from 'node:crypto';
import { Db, ObjectId } from 'mongodb';
import { getCollections } from './db.js';
import { User, UserRole, AuthorizedStudent } from './types.js';

const JWT_SECRET = process.env.JWT_SECRET || 'campus-auction-super-secret-key-2026';

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  sem: number;
  name: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, originalHash] = stored.split(':');
  if (!salt || !originalHash) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

export function signToken(payload: AuthTokenPayload): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 3600 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (signature !== expected) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (parsed.exp && parsed.exp < Date.now()) return null;
    return parsed as AuthTokenPayload;
  } catch {
    return null;
  }
}

export function computeRoleFromSem(sem: number | null | undefined): { role?: UserRole; error?: string } {
  if (sem === null || sem === undefined || typeof sem !== 'number' || isNaN(sem) || sem < 1 || sem > 9) {
    return { error: 'Contact admin' };
  }
  if (sem >= 7 && sem <= 9) {
    return { role: 'seller' };
  }
  return { role: 'buyer' };
}

/**
 * Finds a student in the authorizedStudents collection.
 * Flexibly handles college sheet columns: 'email' or 'Mail ID', 'sem' or 'Sem', 'name' or 'Name'.
 */
export async function findStudentInRoster(db: Db, inputEmail: string): Promise<AuthorizedStudent | null> {
  const normalized = String(inputEmail || '').trim().toLowerCase();
  if (!normalized) return null;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cols = getCollections(db);

  const doc = await cols.authorizedStudents.findOne(
    {
      $or: [
        { email: normalized },
        { email: new RegExp(`^${escaped}$`, 'i') },
        { 'Mail ID': normalized },
        { 'Mail ID': new RegExp(`^${escaped}$`, 'i') },
      ],
    },
    { sort: { sem: -1, Sem: -1 } }
  );
  if (!doc) return null;

  const rawSem = doc.sem !== undefined ? doc.sem : (doc as any).Sem;
  const semNum = rawSem !== null && rawSem !== undefined && rawSem !== '' ? Number(rawSem) : null;
  const emailVal = (doc.email || (doc as any)['Mail ID'] || normalized).toLowerCase();
  const nameVal = doc.name || (doc as any).Name || emailVal.split('@')[0];
  const deptVal = doc.department || (doc as any).Branch || (doc as any)['Roll No'] || 'Campus';

  return {
    _id: doc._id,
    email: emailVal,
    name: nameVal,
    sem: semNum as any,
    department: deptVal,
    createdAt: doc.createdAt || new Date(),
  };
}

/**
 * Seeds initial student roster demo accounts if not already present.
 */
export async function seedAuthorizedStudents(db: Db): Promise<void> {
  const cols = getCollections(db);
  const demoRoster: Omit<AuthorizedStudent, '_id'>[] = [
    // Sellers (Sem 7, 8, 9)
    {
      email: 'seller.sam@campus.edu',
      name: 'Sam Wilson',
      sem: 8,
      department: 'Computer Science',
      createdAt: new Date(),
    },
    {
      email: 'priya.senior@campus.edu',
      name: 'Priya Sharma',
      sem: 7,
      department: 'Electrical Engineering',
      createdAt: new Date(),
    },
    {
      email: 'rahul.senior@campus.edu',
      name: 'Rahul Verma',
      sem: 9,
      department: 'Mechanical Engineering',
      createdAt: new Date(),
    },

    // Buyers (Sem 1 to 6)
    {
      email: 'buyer.bob@campus.edu',
      name: 'Bob Miller',
      sem: 4,
      department: 'Business & Management',
      createdAt: new Date(),
    },
    {
      email: 'arun.buyer@campus.edu',
      name: 'Arun Patel',
      sem: 2,
      department: 'Physics',
      createdAt: new Date(),
    },
    {
      email: 'charlie.buyer@campus.edu',
      name: 'Charlie Davis',
      sem: 5,
      department: 'Design & Media',
      createdAt: new Date(),
    },

    // Edge case: student with blank/invalid sem
    {
      email: 'unassigned.student@campus.edu',
      name: 'Taylor Reed',
      sem: null as any,
      department: 'Undeclared',
      createdAt: new Date(),
    },
  ];

  for (const s of demoRoster) {
    await cols.authorizedStudents.updateOne(
      { $or: [{ email: s.email }, { 'Mail ID': s.email }] },
      { $setOnInsert: { ...s, _id: new ObjectId() } },
      { upsert: true }
    );
  }
}
