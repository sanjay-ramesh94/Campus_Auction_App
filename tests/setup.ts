import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { ensureIndexes, getCollections } from '../src/db.js';

let localReplSet: MongoMemoryReplSet | null = null;
let client: MongoClient | null = null;
let db: Db | null = null;

export async function setupTestDatabase(): Promise<{
  client: MongoClient;
  db: Db;
}> {
  if (db && client) {
    return { client, db };
  }

  const uri = process.env.TEST_MONGO_URI;
  if (uri) {
    client = new MongoClient(uri);
  } else {
    localReplSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(localReplSet.getUri());
  }

  await client.connect();
  db = client.db('test_campus_auction');
  await ensureIndexes(db);

  return { client, db };
}

export async function clearDatabase(): Promise<void> {
  if (!db) return;
  const collections = getCollections(db);
  for (const col of Object.values(collections)) {
    await col.deleteMany({});
  }
}

export async function teardownTestDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
  if (localReplSet) {
    await localReplSet.stop();
    localReplSet = null;
  }
}
