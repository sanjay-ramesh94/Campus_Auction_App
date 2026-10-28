import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet: MongoMemoryReplSet | null = null;

export async function setup() {
  replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger',
    },
  });

  const uri = replSet.getUri();
  process.env.TEST_MONGO_URI = uri;

  return async () => {
    if (replSet) {
      await replSet.stop();
    }
  };
}
