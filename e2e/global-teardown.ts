import { stopHarness } from './harness.mjs';

export default async function globalTeardown() {
  await stopHarness();
}
