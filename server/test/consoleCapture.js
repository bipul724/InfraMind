// Keeps the console output of code that runs inside a test file's own process (the agents'
// progress lines, utils/logger.js) out of that process's stdout and stderr (T-410).
//
// Why: node:test's parent process reads each test file's stdout as a mix of its own
// v8-serialized messages and plain text. In Node 22 (internal/test_runner/runner.js,
// #processRawBuffer), text that follows a message in the same read is taken for the next
// message's length header; when the text's third byte is 0x80 or above (a line that starts
// with an emoji such as "🚀 Starting AI Agent Pipeline..."), the computed length is negative,
// the text is deserialized, and the whole file fails with "Unable to deserialize cloned data
// due to invalid or unsupported version". ASCII text is never misread this way.
//
// Call captureConsole() once at the top of a test file. It mocks console.log, info, warn,
// error and debug for the whole file (before/after hooks) and keeps each call as
// { method, text }, so a test can still assert on what was logged. Production logging is
// unchanged: only this process's console methods are replaced, and only during the tests.
import { after, before, mock } from 'node:test';
import { format } from 'node:util';

const METHODS = ['log', 'info', 'warn', 'error', 'debug'];

export function captureConsole() {
  const lines = [];
  let mocked = [];
  before(() => {
    mocked = METHODS.map((method) => mock.method(console, method, (...args) => {
      lines.push({ method, text: format(...args) });
    }));
  });
  after(() => {
    for (const fn of mocked) fn.mock.restore();
    mocked = [];
  });
  return lines;
}
