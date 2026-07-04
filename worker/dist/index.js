"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
const viagogo_js_1 = require("./viagogo.js");
const API_URL = (process.env.TIXTRACKER_API_URL ?? "").trim().replace(/\/$/, "");
const SECRET = process.env.LISTING_WORKER_SECRET ?? "";
const WORKER_ID = `railway-${Math.random().toString(36).slice(2, 10)}`;
const POLL_MS = 12_000;
async function pollForJob() {
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
    const data = (await res.json());
    return data.job ?? null;
}
async function reportProgress(jobId, payload) {
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
    }
    catch (err) {
        console.error(`[report] Job ${jobId} — network error:`, err instanceof Error ? err.message : err);
    }
}
async function main() {
    console.log(`[worker] Starting TixTracker Viagogo worker (id=${WORKER_ID})`);
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
    const browser = await playwright_1.chromium.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
        ],
    });
    console.log(`[worker] Browser ready. Polling every ${POLL_MS / 1000}s`);
    const loop = async () => {
        try {
            const job = await pollForJob();
            if (!job) {
                setTimeout(loop, POLL_MS);
                return;
            }
            console.log(`\n[worker] ── Job ${job.id} ──────────────────────────────`);
            console.log(`[worker] Order: ${job.orderId}  Event: ${job.eventMatch.viagogoEventName}`);
            console.log(`[worker] Qty: ${job.draft.quantity}  Price: £${job.draft.pricePerTicket}  Account: ${job.account.displayEmail}`);
            const report = (status, extra = {}) => reportProgress(job.id, { status, currentStep: status, ...extra });
            try {
                await (0, viagogo_js_1.runViagogoListing)(browser, job, report);
            }
            catch (err) {
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
        }
        catch (err) {
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
