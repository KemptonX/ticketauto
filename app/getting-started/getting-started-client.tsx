"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase";

type StepId = "welcome" | "import" | "email" | "notifications" | "done";
const STEPS: StepId[] = ["welcome", "import", "email", "notifications", "done"];
const STEP_LABELS: Record<StepId, string> = {
  welcome: "Welcome",
  import: "Your tickets",
  email: "Automatic scanning",
  notifications: "Notifications",
  done: "You're ready",
};

// Five-step guided setup, shown automatically to a brand-new signup
// instead of an empty dashboard (see shouldShowOnboarding() in
// src/lib/require-access.ts and app/page.tsx). Deliberately thin: the
// actual import and email-connection work happens on the existing
// Settings pages (which already got the validation/currency upgrades
// this engagement added) — this wizard explains what to do and links
// there, rather than re-implementing either flow a second time.
export default function GettingStartedClient() {
  const router = useRouter();
  const [step, setStep] = useState<StepId>("welcome");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [discordWebhook, setDiscordWebhook] = useState("");
  const [alertTime, setAlertTime] = useState("09:00");
  const [alertTimezone, setAlertTimezone] = useState("Europe/London");
  const [notifSaved, setNotifSaved] = useState(false);

  // Resume where they left off — see onboarding_current_step in
  // supabase/migrations/0008_onboarding.sql. Tolerates that migration not
  // being applied yet: a missing column just means "start at welcome".
  useEffect(() => {
    async function load() {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes?.user?.id;
      if (!userId) { setLoaded(true); return; }

      const { data } = await supabase
        .from("user_settings")
        .select("onboarding_current_step, discord_webhook_url, alert_time, alert_timezone")
        .eq("user_id", userId)
        .maybeSingle();

      if (data) {
        const resumeStep = data.onboarding_current_step as StepId | null;
        if (resumeStep && STEPS.includes(resumeStep)) setStep(resumeStep);
        if (data.discord_webhook_url) setDiscordWebhook(data.discord_webhook_url);
        if (data.alert_time) setAlertTime(data.alert_time);
        if (data.alert_timezone) setAlertTimezone(data.alert_timezone);
      }
      setLoaded(true);
    }
    void load();
  }, []);

  async function persistStep(nextStep: StepId, opts: { skipped?: boolean; complete?: boolean } = {}) {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return;

    const update: Record<string, unknown> = { user_id: userId, onboarding_current_step: nextStep };
    if (opts.complete) update.onboarding_completed_at = new Date().toISOString();
    if (opts.skipped) {
      const { data: existing } = await supabase.from("user_settings").select("onboarding_skipped_steps").eq("user_id", userId).maybeSingle();
      const prior = (existing?.onboarding_skipped_steps as string[] | null) ?? [];
      update.onboarding_skipped_steps = prior.includes(step) ? prior : [...prior, step];
    }
    // Tolerates migration 0008 not being applied yet — these columns
    // simply won't exist until then, in which case this silently no-ops
    // (progress just won't resume across visits, which is a soft
    // degradation, not a broken feature) rather than erroring out loud.
    await supabase.from("user_settings").upsert(update, { onConflict: "user_id" });
  }

  function goTo(next: StepId, opts: { skipped?: boolean } = {}) {
    setSaving(true);
    void persistStep(next, { skipped: opts.skipped, complete: next === "done" }).finally(() => setSaving(false));
    setStep(next);
  }

  function skipRest() {
    setSaving(true);
    void persistStep("done", { skipped: true, complete: true }).finally(() => {
      setSaving(false);
      router.push("/");
    });
  }

  async function saveNotifications() {
    setSaving(true);
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id;
    if (userId) {
      await supabase.from("user_settings").upsert({
        user_id: userId,
        discord_webhook_url: discordWebhook.trim() || null,
        alert_time: alertTime,
        alert_timezone: alertTimezone,
      }, { onConflict: "user_id" });
      setNotifSaved(true);
    }
    setSaving(false);
  }

  const stepIndex = STEPS.indexOf(step);

  if (!loaded) return null;

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", background: "var(--bg, #0b0b10)" }}>
      <div style={{ maxWidth: 560, width: "100%" }}>
        {/* Progress indicator */}
        <div style={{ display: "flex", gap: 6, marginBottom: "1.5rem" }}>
          {STEPS.map((s, i) => (
            <div
              key={s}
              style={{
                flex: 1, height: 4, borderRadius: 2,
                background: i <= stepIndex ? "var(--accent, #9b5cff)" : "var(--border, rgba(255,255,255,0.1))",
              }}
            />
          ))}
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Step {stepIndex + 1} of {STEPS.length} — {STEP_LABELS[step]}
        </p>

        <div className="table-card" style={{ padding: "1.75rem" }}>
          {step === "welcome" && (
            <>
              <h2 style={{ marginBottom: "0.75rem" }}>Welcome to TixTracker</h2>
              <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
                TixTracker tracks your ticket purchases, sales, transfers and payouts automatically, and shows your
                real profit as it happens. Let&apos;s get your account set up — this takes about five minutes.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" className="ghost-button" onClick={skipRest}>Skip setup</button>
                <button type="button" className="primary-button" onClick={() => goTo("import")}>Let&apos;s go →</button>
              </div>
            </>
          )}

          {step === "import" && (
            <>
              <h2 style={{ marginBottom: "0.75rem" }}>Add your existing tickets</h2>
              <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>
                If you already have tickets bought before using TixTracker, you can bring them in from a spreadsheet —
                TixTracker checks it for problems (like oversold quantities or duplicates) before anything is saved, and
                shows you exactly what it found before importing. This is completely optional — you can always do it later.
              </p>
              <div style={{ display: "flex", gap: 10, marginBottom: "1.5rem" }}>
                <Link
                  href="/settings?tab=import&mode=tickets"
                  className="secondary-button"
                  onClick={() => void persistStep("import")}
                >
                  Open the import tool →
                </Link>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button type="button" className="ghost-button" onClick={() => goTo("welcome")}>Back</button>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="ghost-button" onClick={() => goTo("email", { skipped: true })}>Skip — I&apos;ll start fresh</button>
                  <button type="button" className="primary-button" onClick={() => goTo("email")}>Continue →</button>
                </div>
              </div>
            </>
          )}

          {step === "email" && (
            <>
              <h2 style={{ marginBottom: "0.75rem" }}>Set up automatic scanning</h2>
              <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>
                Connect an inbox and TixTracker can automatically pick up ticket purchases and sales as the
                confirmation emails arrive — no manual entry needed. Currently supported:
              </p>
              <ul style={{ color: "var(--muted)", fontSize: "0.875rem", lineHeight: 1.7, paddingLeft: "1.25rem", marginBottom: "1rem" }}>
                <li><strong>Outlook</strong> — connect directly with one click.</li>
                <li><strong>Gmail or any other IMAP inbox</strong> — connect using an app-specific password (not your normal password).</li>
                <li><strong>Email Forwarding</strong> — forward specific confirmation emails to a TixTracker address for instant Discord alerts on sales, transfers and payouts.</li>
              </ul>
              <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
                This is optional too — you can always connect an inbox later from Settings.
              </p>
              <div style={{ display: "flex", gap: 10, marginBottom: "1.5rem" }}>
                <Link
                  href="/settings?tab=connections"
                  className="secondary-button"
                  onClick={() => void persistStep("email")}
                >
                  Open email connections →
                </Link>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button type="button" className="ghost-button" onClick={() => goTo("import")}>Back</button>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="ghost-button" onClick={() => goTo("notifications", { skipped: true })}>Skip for now</button>
                  <button type="button" className="primary-button" onClick={() => goTo("notifications")}>Continue →</button>
                </div>
              </div>
            </>
          )}

          {step === "notifications" && (
            <>
              <h2 style={{ marginBottom: "0.75rem" }}>Set up notifications</h2>
              <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>
                Get a Discord message when a ticket is at risk of going unsold, and choose what time of day you&apos;d
                like that check to run. You can leave this blank and set it up later from Settings.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
                <label className="field-label">
                  <span>Discord webhook URL (optional)</span>
                  <input className="field" placeholder="https://discord.com/api/webhooks/…" value={discordWebhook} onChange={(e) => setDiscordWebhook(e.target.value)} />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <label className="field-label">
                    <span>Alert time</span>
                    <input className="field" type="time" value={alertTime} onChange={(e) => setAlertTime(e.target.value)} />
                  </label>
                  <label className="field-label">
                    <span>Timezone</span>
                    <input className="field" value={alertTimezone} onChange={(e) => setAlertTimezone(e.target.value)} placeholder="Europe/London" />
                  </label>
                </div>
                <div>
                  <button type="button" className="secondary-button" disabled={saving} onClick={() => void saveNotifications()}>
                    {notifSaved ? "Saved ✓" : saving ? "Saving…" : "Save notification settings"}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button type="button" className="ghost-button" onClick={() => goTo("email")}>Back</button>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="ghost-button" onClick={() => goTo("done", { skipped: !notifSaved })}>Skip</button>
                  <button type="button" className="primary-button" onClick={() => goTo("done")}>Continue →</button>
                </div>
              </div>
            </>
          )}

          {step === "done" && (
            <>
              <h2 style={{ marginBottom: "0.75rem" }}>You&apos;re ready!</h2>
              <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
                That&apos;s the essentials covered. You can revisit this setup any time from Settings, and every step
                you skipped stays available there too — nothing here is a one-time choice.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Link href="/" className="primary-button">Go to my dashboard →</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
