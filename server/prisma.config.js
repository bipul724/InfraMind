// Prisma CLI configuration (generate, migrate). Current Prisma versions no longer load
// .env themselves, so this file does. The server never reads this file.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Needed only by migrate commands; `prisma generate` works without it
  datasource: { url: process.env.DATABASE_URL }
});
