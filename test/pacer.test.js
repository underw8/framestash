// Run: node igd/test/pacer.test.js
const assert = require("node:assert/strict");
const p = require("../extension/pacer.js");

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Jitter: seconds in, ms out, both ends reachable.
assert.equal(p.jitter(3, 6, () => 0), 3000);
assert.equal(Math.round(p.jitter(3, 6, () => 0.999)), 5997);
for (let i = 0; i < 1000; i++) {
  const ms = p.jitter(0.3, 1);
  assert.ok(ms >= 300 && ms <= 1000, String(ms));
}
const b = p.nextBreakAt(p.PACING_DEFAULTS, () => 0);
assert.ok(b === 135 && p.nextBreakAt(p.PACING_DEFAULTS, () => 0.999) <= 165);

// Settings: defaults for missing, NaN, empty or negative values; reversed pairs swapped.
assert.deepEqual(p.pacingSettings(undefined), p.PACING_DEFAULTS);
const s = p.pacingSettings({ apiMin: "abc", apiMax: -1, cdnMin: "", jobMin: 120, jobMax: 40, perHour: "50", perDay: 0, breakMin: NaN });
assert.equal(s.apiMin, 3);
assert.equal(s.apiMax, 6);
assert.equal(s.cdnMin, 0.3);
assert.equal(s.jobMin, 40);
assert.equal(s.jobMax, 120);
assert.equal(s.perHour, 50);
assert.equal(s.perDay, 1500);
assert.equal(s.breakMin, 5);
assert.equal(p.pacingSettings({ apiMin: 0 }).apiMin, 0);

// Budgets: rolling hour and day windows.
const now = 10 * DAY;
const d = p.PACING_DEFAULTS;
assert.equal(p.budgetWait([], now, d).resumeAt, null);
const under = Array.from({ length: 199 }, (_, i) => now - 50 * MIN + i * 1000);
assert.equal(p.budgetWait(under, now, d).resumeAt, null);
const hour = [...under, now - 1000];
assert.equal(p.budgetWait(hour, now, d).resumeAt, now - 50 * MIN + HOUR);
const day = Array.from({ length: 1500 }, (_, i) => now - 20 * HOUR + i * 30e3);
assert.equal(p.budgetWait(day, now, { ...d, perHour: 1e6 }).resumeAt, now - 20 * HOUR + DAY);
const pruned = p.budgetWait([now - DAY - 1, now - 2 * DAY, now - 5], now, d);
assert.deepEqual(pruned.stamps, [now - 5]);
assert.equal(pruned.resumeAt, null);

// Classification.
const rate = { reason: "rate", manual: false };
const shape = { reason: "shape", manual: false };
const login = { reason: "login", manual: true };
const challenge = { reason: "challenge", manual: true };
const cases = [
  ["profilePosts", { error: "HTTP 429", status: 429 }, rate],
  ["post", { error: "Please wait a few minutes before you try again.", block: true }, rate],
  ["post", { error: "Please wait a few minutes before you try again." }, null],
  ["post", { error: "feedback_required", spam: true }, rate],
  ["profilePosts", { error: "checkpoint_required", checkpoint: true }, challenge],
  ["profilePosts", { error: "redirected to /challenge/abc/" }, challenge],
  ["profilePosts", { error: "login required", login: true }, login],
  ["stories", { error: "redirected to /accounts/login/" }, login],
  ["post", { error: "HTTP 401", status: 401 }, login],
  ["post", { error: "Please wait a few minutes", login: true }, login],
  ["profilePosts", { error: "response is not JSON (Instagram may have changed the query)" }, shape],
  ["profilePosts", { error: "unexpected response shape (Instagram may have changed the query)" }, shape],
  ["profilePosts", { error: "malformed reply" }, shape],
  ["post", { error: "unexpected response shape (Instagram may have changed the query)", requests: 1 }, shape],
  ["profilePosts", { error: "redirected to /" }, shape],
  ["profilePosts", { next: null }, shape],
  ["userId", {}, shape],
  ["post", { error: "post not found" }, null],
  ["userId", { error: "account @x not found" }, null],
  ["userId", { error: "account @spam_bot not found" }, null],
  ["userId", { error: "account @challenge.x not found" }, null],
  ["userId", { error: "account @login_required not found" }, null],
  ["profilePosts", { nodes: [] }, null],
  ["userId", { pk: "123" }, null],
];
for (const [op, r, want] of cases) assert.deepEqual(p.classify(op, r), want, JSON.stringify([op, r]));

// Cool-down growth.
assert.equal(p.cooldownMs(1), 30 * MIN);
assert.equal(p.cooldownMs(2), 60 * MIN);
assert.equal(p.cooldownMs(3), 120 * MIN);
assert.equal(p.cooldownMs(20), DAY);
assert.equal(p.nextTrips(0, 0, now), 1);
assert.equal(p.nextTrips(2, now - HOUR, now), 3);
assert.equal(p.nextTrips(5, now - DAY - 1, now), 1);

console.log("pacer: all checks passed");
