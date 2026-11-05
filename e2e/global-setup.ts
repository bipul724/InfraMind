import { startHarness } from './harness.mjs';

export default async function globalSetup() {
  await startHarness();
}
