import { defineConfig } from 'vitest/config';
import fs from 'node:fs';

const potentialPaths = [
  'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
  'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe',
  '/usr/bin/mongod',
  '/usr/local/bin/mongod',
];

if (!process.env.MONGOMS_SYSTEM_BINARY) {
  for (const p of potentialPaths) {
    if (fs.existsSync(p)) {
      process.env.MONGOMS_SYSTEM_BINARY = p;
      break;
    }
  }
}

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    hookTimeout: 180000,
    environment: 'node',
    fileParallelism: false,
    maxConcurrency: 1,
    globalSetup: ['./tests/globalSetup.ts'],
  },
});
