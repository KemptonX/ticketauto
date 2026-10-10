import { chromium } from "playwright";
import { runViagogoListing } from "./viagogo.js";
import type { Job, JobUpdatePayload, ReportFn } from "./types.js";

const API_URL = (process.env.TIXTRACKER_API_URL ?? "").trim().replace(/\/$/, "");
const SECRET = process.env.LISTING_WORKER_SECRET ?? "";
const WORKER_ID = `railway-${Math.random().toString(36).slice(2, 10)}`;
const POLL_MS = 12_000;

// SMS verification code forwarding (SMSPass.io -> Discord) — a second,
// fully independent loop on this same always-on process. SMSPass has no
// webhook/push option, only a pull API, and a free external HTTP
// scheduler (cron-job.org) can't go below 60s — nowhere near fast enough
// for a code a user needs within seconds. This process is already running
// continuously for the Playwright job queue, so polling our own
// /api/cron/sms-codes endpoint every few seconds here costs nothing extra
// and doesn't touch the job-loop logic above at all.
const SMS_POLL_SECRET = process.env.SMS_POLL_SECRET ?? "";
const SMS_POLL_MS = Number(process.env.SMS_POLL_INTERVAL_MS) || 3_000;

async function pollSmsCodes(): Promise<void> {
  if (!API_URL || !SMS_POLL_SECRET) return; // silently idle if not configured — never crashes the job loop
  try {
    const res = await fetch(`${API_URL}/api/cron/sms-codes?secret=${encodeURIComponent(SMS_POLL_SECRET)}`, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[sms-poll] HTTP ${res.status}`);
      return;
    }
    const data = (await res.json()) as { usersChecked?: number; totalForwarded?: number; errors?: string[] };
    if ((data.totalForwarded ?? 0) > 0) {
      console.log(`[sms-poll] forwarded ${data.totalForwarded} message(s)`);
    }
    if (data.errors && data.errors.length > 0) {
      console.error(`[sms-poll] errors:`, data.errors);
    }
  } catch (err) {
    console.error("[sms-poll] fetch failed:", err instanceof Error ? err.message : err);
  }
}

function startSmsPollLoop(): void {
  if (!SMS_POLL_SECRET) {
    console.log("[sms-poll] SMS_POLL_SECRET not set — SMS forwarding loop disabled");
    return;
  }
  console.log(`[sms-poll] Starting — polling every ${SMS_POLL_MS / 1000}s`);
  const tick = async () => {
    await pollSmsCodes();
    setTimeout(tick, SMS_POLL_MS);
  };
  void tick();
}

async function pollForJob(): Promise<Job | null> {
  const res = await fetch(`${API_URL}/api/worker/jobs`, {
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "x-worker-id": WORKER_ID,
    },
  });
  if (res.status === 401) {
    console.error("[poll] Unauthorized — check LISTING_WORKER_SECRET");
    return null;
  }
  if (!res.ok) {
    console.error(`[poll] HTTP ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { job: Job | null };
  return data.job ?? null;
}

async function reportProgress(jobId: string, payload: JobUpdatePayload): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/api/worker/jobs/${jobId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[report] Job ${jobId} — HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[report] Job ${jobId} — network error:`, err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  console.log(`[worker] Starting TixTracker Viagogo worker (id=${WORKER_ID})`);

  startSmsPollLoop(); // independent of everything below — never blocks or is blocked by the job loop

  if (!API_URL || !SECRET) {
    console.error("[worker] TIXTRACKER_API_URL or LISTING_WORKER_SECRET not set — exiting");
    process.exit(1);
  }
  if (!process.env.VIAGOGO_CREDENTIAL_ENCRYPTION_KEY) {
    console.error("[worker] VIAGOGO_CREDENTIAL_ENCRYPTION_KEY not set — exiting");
    process.exit(1);
  }

  console.log(`[worker] Connecting to ${API_URL}`);
  console.log(`[worker] Launching Chromium...`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  console.log(`[worker] Browser ready. Polling every ${POLL_MS / 1000}s`);

  const loop = async (): Promise<void> => {
    try {
      const job = await pollForJob();

      if (!job) {
        setTimeout(loop, POLL_MS);
        return;
      }

      console.log(`\n[worker] ── Job ${job.id} ──────────────────────────────`);
      console.log(`[worker] Order: ${job.orderId}  Event: ${job.eventMatch.viagogoEventName}`);
      console.log(`[worker] Qty: ${job.draft.quantity}  Price: £${job.draft.pricePerTicket}  Account: ${job.account.displayEmail}`);

      const report: ReportFn = (status, extra = {}) =>
        reportProgress(job.id, { status, currentStep: status, ...extra });

      try {
        await runViagogoListing(browser, job, report);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[worker] Job ${job.id} failed:`, msg);
        const isSessionExpired = msg.startsWith("SESSION_EXPIRED:");
        await reportProgress(job.id, {
          status: "failed",
          errorCode: isSessionExpired ? "session_expired" : "automation_error",
          errorMessage: isSessionExpired
            ? "Session expired — re-import cookies in TixTracker → Accounts → Import session cookies"
            : msg.slice(0, 500),
        });
      }

      // Immediately poll again after completing a job
      setImmediate(loop);
    } catch (err) {
      console.error("[worker] Poll loop error:", err instanceof Error ? err.message : err);
      setTimeout(loop, POLL_MS);
    }
  };

  await loop();
}

main().catch((err) => {
  console.error("[worker] Fatal:", err);
  process.exit(1);
});
