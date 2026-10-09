// Pure pacing and circuit-breaker rules for the panel (manager.js). Times are ms
// since the epoch; settings are seconds, except the break length in minutes.

const HOUR = 3600e3;
const DAY = 24 * HOUR;

const PACING_DEFAULTS = {
  apiMin: 3, apiMax: 6, cdnMin: 0.3, cdnMax: 1, jobMin: 30, jobMax: 90,
  breakEvery: 150, breakMin: 5, breakMax: 10, perHour: 200, perDay: 1500,
};
// Zero would hold the queue forever or break before every call.
const AT_LEAST_ONE = ["breakEvery", "perHour", "perDay"];

function pacingSettings(raw) {
  const s = {};
  for (const [k, d] of Object.entries(PACING_DEFAULTS)) {
    const v = raw && raw[k];
    const n = v === "" || v == null ? NaN : Number(v);
    s[k] = Number.isFinite(n) && n >= (AT_LEAST_ONE.includes(k) ? 1 : 0) ? n : d;
  }
  for (const p of ["api", "cdn", "job", "break"]) {
    if (s[`${p}Min`] > s[`${p}Max`]) [s[`${p}Min`], s[`${p}Max`]] = [s[`${p}Max`], s[`${p}Min`]];
  }
  return s;
}

// A random wait between min and max seconds, in ms.
const jitter = (min, max, rand = Math.random) => (min + (max - min) * rand()) * 1000;

// Calls until the next long break: breakEvery ± 10 %.
const nextBreakAt = (s, rand = Math.random) => Math.max(1, Math.round(s.breakEvery * (0.9 + 0.2 * rand())));

// resumeAt is when enough stamps have left the exhausted window to allow one more call.
function budgetWait(stamps, now, s) {
  const kept = stamps.filter((t) => t > now - DAY).sort((a, b) => a - b);
  let resumeAt = null;
  for (const [limit, span] of [[s.perHour, HOUR], [s.perDay, DAY]]) {
    const inWindow = kept.filter((t) => t > now - span);
    if (inWindow.length >= limit) resumeAt = Math.max(resumeAt || 0, inWindow[inWindow.length - limit] + span);
  }
  return { stamps: kept, resumeAt };
}

// null: the reply is usable, or its error belongs to the job (e.g. "post not found").
// Otherwise the queue holds; manual holds wait for the user's Resume.
function classify(op, r) {
  const err = String(r.error || "");
  // Only Instagram's own block replies are text-matched; job errors can echo user input.
  const said = (re) => !!r.block && re.test(err);
  const redirect = (err.match(/^redirected to (\S+)/) || [])[1];
  if (r.login || r.status === 401 || r.status === 403 || /^\/accounts\/login/.test(redirect || "") || said(/login_required/i)) {
    return { reason: "login", manual: true };
  }
  if (r.checkpoint || /^\/challenge/.test(redirect || "") || said(/checkpoint|challenge/i)) return { reason: "challenge", manual: true };
  if (r.status === 429 || r.spam || said(/please wait|feedback_required|spam/i)) return { reason: "rate", manual: false };
  if (redirect || /not JSON|unexpected response shape|malformed reply/.test(err)) return { reason: "shape", manual: false };
  if (err) return null;
  const ok = op === "userId" ? typeof r.pk === "string" && r.pk !== "" : Array.isArray(r.nodes);
  return ok ? null : { reason: "shape", manual: false };
}

const cooldownMs = (trips) => Math.min(30 * 60e3 * 2 ** (Math.max(1, trips) - 1), DAY);

// Trip count for a new trip: doubling restarts after a day without one.
const nextTrips = (prev, lastTrip, now) => (lastTrip && now - lastTrip < DAY ? (prev || 0) + 1 : 1);

// A user pause sits on top of a still-running timed hold, which comes back on Resume.
const pauseHold = (hold, now) => ({
  until: null, reason: "You paused the queue.", manual: true, paused: true,
  after: hold && !hold.manual && hold.until > now ? hold : null,
});
const resumeHold = (hold, now) => (hold && hold.after && hold.after.until > now ? hold.after : null);
// A timed trip during a user pause waits under it; a manual trip replaces it.
const tripHold = (current, next) => (current && current.paused && !next.manual ? { ...current, after: next } : next);

function holdText(h, now, clock) {
  if (!h || (!h.manual && h.until <= now)) return "";
  return h.manual ? `${h.reason} Click Resume to continue.` : `${h.reason} The queue resumes at ${clock(h.until)}.`;
}

if (typeof module !== "undefined") {
  module.exports = { PACING_DEFAULTS, pacingSettings, jitter, nextBreakAt, budgetWait, classify, cooldownMs, nextTrips, pauseHold, resumeHold, tripHold, holdText };
}
