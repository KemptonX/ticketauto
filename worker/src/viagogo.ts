import type { Browser, Page, BrowserContext, Locator } from "playwright";
import type { Job, ReportFn } from "./types.js";
import { encrypt } from "./crypto.js";
import * as fs from "fs";
import * as path from "path";

const API_URL = (process.env.TIXTRACKER_API_URL ?? "").trim().replace(/\/$/, "");
const SECRET = process.env.LISTING_WORKER_SECRET ?? "";

async function pollForOtp(accountId: string, timeoutMs = 300_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/api/worker/otp?accountId=${accountId}`, {
        headers: { Authorization: `Bearer ${SECRET}` },
      });
      if (res.ok) {
        const data = await res.json() as { otp: string | null };
        if (data.otp) return data.otp;
      }
    } catch { /* ignore network errors, keep polling */ }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return null;
}

const VIAGOGO_ORIGIN = "https://www.viagogo.co.uk";
const LOGIN_URL = `${VIAGOGO_ORIGIN}/login`;
const MY_ACCOUNT_URL = `${VIAGOGO_ORIGIN}/myaccount`;
const TIMEOUT = 30_000;

export async function runViagogoListing(browser: Browser, job: Job, report: ReportFn): Promise<void> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-GB",
    extraHTTPHeaders: {
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });

  // Hide automation fingerprint
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).chrome?.runtime;
  });

  try {
    // Restore saved session cookies
    if (job.account.sessionData?.cookies?.length) {
      await context.addCookies(job.account.sessionData.cookies as Parameters<BrowserContext["addCookies"]>[0]);
      console.log(`[viagogo] Restored ${job.account.sessionData.cookies.length} session cookies`);
    }

    const page = await context.newPage();

    // ── 1. Verify session is still valid ─────────────────────────────────────
    // Session cookies are imported manually by the user (via the Accounts tab in
    // TixTracker). Headless login is not attempted here because Viagogo uses invisible
    // reCAPTCHA which blocks form submission in headless Chrome.
    await report("session_checking");
    await page.goto(MY_ACCOUNT_URL, { waitUntil: "load", timeout: TIMEOUT });
    // Allow up to 5s for any client-side redirect (auth guard) to fire after load
    await page.waitForTimeout(2_000);

    const isLoggedIn =
      !page.url().includes("/login") &&
      !page.url().includes("/signin") &&
      !page.url().includes("/account/login") &&
      !page.url().includes("/Authenticate");

    if (!isLoggedIn) {
      console.log(`[viagogo] Session expired or missing — URL: ${page.url()}`);
      throw new Error("SESSION_EXPIRED: Re-import session cookies in TixTracker → Accounts → Import session cookies");
    }

    console.log(`[viagogo] Session valid. Current URL: ${page.url()}`);

    // ── 2. Navigate to event page ─────────────────────────────────────────────
    await report("opening_event_page");
    const eventUrl = job.eventMatch.viagogoEventUrl;
    console.log(`[viagogo] Navigating to event: ${eventUrl}`);
    await page.goto(eventUrl, { waitUntil: "load", timeout: TIMEOUT });
    await dismissCookieBanner(page);

    // ── 3. Navigate to sell pipeline ─────────────────────────────────────────
    await report("clicking_sell");
    const sellPipelineUrl = `${VIAGOGO_ORIGIN}/Secure/Pipeline/Sell/Initialise?EventID=${job.eventMatch.viagogoEventId}`;
    console.log(`[viagogo] Navigating to sell pipeline: ${sellPipelineUrl}`);
    await page.goto(sellPipelineUrl, { waitUntil: "load", timeout: TIMEOUT });
    console.log(`[viagogo] Sell pipeline loaded, now at: ${page.url()}`);

    // ── 4. Multi-step listing form ────────────────────────────────────────────
    // Viagogo's form varies but follows a consistent pattern of steps with Next buttons.
    // We detect which step we're on by page content and handle each one.

    // Viagogo can jump straight to ListingNotes after any step (e.g. for GA events
    // with no seat selection).  Check URL before each intermediate step and skip it
    // if the page has already advanced to the final combined page.
    const onFinalPage = () => /listingnotes/i.test(page.url());

    await report("selecting_quantity");
    await handleQuantityStep(page, job.draft.quantity);

    if (!onFinalPage()) {
      await report("selecting_split_rule");
      await handleSplitRuleStep(page, job.draft.splitRule);
    }

    if (!onFinalPage()) {
      await report("selecting_ticket_provider");
      await handleTicketTypeStep(page, job.draft.ticketStorageProvider);
    }

    if (!onFinalPage()) {
      await report("filling_seat_details");
      await handleSeatDetailsStep(page, job.draft.section, job.draft.row, job.draft.seatFrom, job.draft.seatTo);
    }

    await report("filling_price");
    await handlePriceStep(page, job.draft.pricePerTicket, job.draft.faceValuePerTicket);

    await report("filling_features_restrictions");
    await handleFeaturesStep(page, job.draft.listingFeatures, job.draft.restrictions);

    // ── 5. Review & submit ────────────────────────────────────────────────────
    await report("final_review");
    console.log(`[viagogo] At review step, URL: ${page.url()}`);

    await report("submitting_listing");
    // The submit button on ListingNotes changes text from "Continue" (disabled) →
    // "create listing" (enabled) as required fields are filled.  It's always
    // button[type="submit"] — wait up to 20s for it to become enabled.
    const submitBtn = page.locator('button[type="submit"]').first();
    console.log(`[viagogo] Waiting for submit button to become enabled...`);
    await submitBtn.waitFor({ state: "visible", timeout: 10_000 });
    const submitText = await submitBtn.textContent().catch(() => "");
    console.log(`[viagogo] Submit button text: "${submitText?.trim()}"`);
    await submitBtn.click({ timeout: 20_000 }); // Playwright waits for enabled state

    // ── 6. Wait for confirmation ──────────────────────────────────────────────
    await report("waiting_for_confirmation");
    await page.waitForLoadState("load", { timeout: TIMEOUT });
    const confirmUrl = page.url();
    console.log(`[viagogo] Post-submit URL: ${confirmUrl}`);

    // Extract listing ID from URL or page content
    let resultListingId: string | undefined;
    let resultListingUrl: string | undefined;

    const urlIdMatch = confirmUrl.match(/\/listings?\/(\d+)/i) ?? confirmUrl.match(/[?&]listingId=(\d+)/i);
    if (urlIdMatch) {
      resultListingId = urlIdMatch[1];
      resultListingUrl = confirmUrl;
    } else {
      // Try page content
      const bodyText = await page.textContent("body").catch(() => "");
      const bodyMatch = bodyText?.match(/listing\s+(?:id|#|number)[:\s]+(\d{6,})/i);
      if (bodyMatch) resultListingId = bodyMatch[1];

      // Try data attributes
      const listingEl = page.locator("[data-listing-id]");
      if (await listingEl.count() > 0) {
        resultListingId = (await listingEl.getAttribute("data-listing-id")) ?? undefined;
      }
      resultListingUrl = confirmUrl;
    }

    // Fallback ID so the job always completes
    if (!resultListingId) {
      resultListingId = `manual-check-${job.id}`;
      console.warn(`[viagogo] Could not extract listing ID from page — using fallback`);
    }

    const finalCookies = await context.cookies();

    await report("listed", {
      resultListingId,
      resultListingUrl: resultListingUrl ?? confirmUrl,
      encryptedSession: encrypt(JSON.stringify({ cookies: finalCookies })),
    });

    console.log(`[viagogo] Job ${job.id} listed. ID: ${resultListingId}`);
  } catch (err) {
    // Save a debug screenshot when something goes wrong
    try {
      const screenshotDir = "/tmp/worker-screenshots";
      if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
      const pages = context.pages();
      if (pages.length > 0) {
        await pages[0].screenshot({ path: path.join(screenshotDir, `error-${job.id}.png`), fullPage: true });
        console.log(`[viagogo] Error screenshot saved to ${screenshotDir}/error-${job.id}.png`);
      }
    } catch { /* best-effort */ }

    throw err;
  } finally {
    await context.close();
  }
}

// ── Step handlers ─────────────────────────────────────────────────────────────

async function handleQuantityStep(page: Page, quantity: number): Promise<void> {
  await waitForAnyVisible(page, [
    'select[name*="quantity" i]',
    'input[type="radio"][value]',
    '[class*="quantity" i]',
    `label:has-text("${quantity}")`,
  ]);

  const select = page.locator('select[name*="quantity" i], select[name*="qty" i], select[id*="quantity" i]');
  if (await select.count() > 0) {
    await select.first().selectOption(String(quantity));
    console.log(`[viagogo] Selected quantity ${quantity} via dropdown`);
  } else {
    // Radio buttons (e.g., "2 tickets", or just "2")
    const radio = page.locator(`input[type="radio"][value="${quantity}"]`);
    const label = page.locator(`label`).filter({ hasText: new RegExp(`^${quantity}(\\s|$)`) });
    if (await radio.count() > 0) {
      await radio.first().click();
    } else if (await label.count() > 0) {
      await label.first().click();
    } else {
      console.warn(`[viagogo] Could not find quantity selector for ${quantity}`);
    }
  }

  await clickNext(page);
}

async function handleSplitRuleStep(page: Page, splitRule: string): Promise<void> {
  // Only proceed if a split step is actually shown
  const splitKeywords = ["split", "together", "single", "quantity"];
  const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
  if (!splitKeywords.some((k) => bodyText.toLowerCase().includes(k))) {
    console.log("[viagogo] No split rule step detected — skipping");
    return;
  }

  const textMap: Record<string, RegExp> = {
    any_quantity:         /sell any/i,
    all_together:         /all together|sell all/i,
    no_single_left:       /no single|don.?t leave.*single/i,
    no_one_or_three_left: /one or three|1 or 3/i,
  };

  const pattern = textMap[splitRule] ?? /sell any/i;
  const el = page.locator("label, button, div[role='radio']").filter({ hasText: pattern });
  if (await el.count() > 0) {
    await forceClick(el.first());
    console.log(`[viagogo] Selected split rule: ${splitRule}`);
  } else {
    console.warn(`[viagogo] Could not find split rule option for: ${splitRule}`);
  }

  await clickNext(page);
}

async function handleTicketTypeStep(page: Page, storageProvider: string): Promise<void> {
  const bodyText = (await page.textContent("body").catch(() => "")) ?? "";

  // This screen can contain two distinct sub-questions:
  // 1. "What type of tickets are you listing?" (ticket delivery method)
  // 2. "Where are your tickets stored?" (Ticketmaster / AXS / SeatGeek / Other / Unknown)
  // Both or either may be visible.  The Continue button stays disabled until both
  // required selections are made.

  const hasTypeQuestion = /what type of tickets|how (do you|are your tickets|will you)|ticket type|delivery method/i.test(bodyText);
  const hasStorageQuestion = /where are your tickets stored/i.test(bodyText);

  if (!hasTypeQuestion && !hasStorageQuestion) {
    console.log("[viagogo] No ticket type step detected — skipping");
    return;
  }

  // ── Sub-step A: ticket delivery type ──────────────────────────────────────
  // Only select if the question is present AND the type isn't already committed
  // ("Edit this ticket type" link means it was set in a previous step — leave it alone).
  const typeAlreadySet = /edit this ticket type/i.test(bodyText);
  if (hasTypeQuestion && !typeAlreadySet) {
    const typePatterns: Record<string, RegExp[]> = {
      ticketmaster: [/mobile ticket transfer/i, /mobile ticket/i],
      axs:          [/axs/i, /mobile ticket/i],
      seatgeek:     [/seatgeek/i, /mobile ticket/i],
      other:        [/e.?ticket/i, /pdf/i, /print/i],
    };
    const patterns = typePatterns[storageProvider] ?? typePatterns.other;

    let clicked = false;
    for (const pattern of patterns) {
      // Use a broad selector — Viagogo renders these as styled cards, not always <button>
      const el = page.locator("label, button, li, [role='radio'], [role='button'], div[class]")
        .filter({ hasText: pattern });
      if (await el.count() > 0) {
        await forceClick(el.first());
        console.log(`[viagogo] Selected ticket type for ${storageProvider}`);
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      console.warn(`[viagogo] Could not select ticket type for: ${storageProvider}`);
    }
    await page.waitForTimeout(500);
  }

  // ── Sub-step B: storage provider ──────────────────────────────────────────
  // "Where are your tickets stored?" — must click one for Continue to enable.
  if (hasStorageQuestion) {
    // Map our internal storageProvider value to the exact label Viagogo shows
    const storageLabels: Record<string, string[]> = {
      ticketmaster: ["Ticketmaster"],
      axs:          ["AXS"],
      seatgeek:     ["SeatGeek"],
      other:        ["Other"],
    };
    const labels = storageLabels[storageProvider?.toLowerCase()] ?? ["Other"];

    let clicked = false;
    for (const label of labels) {
      // Try several selector strategies — Viagogo's storage cards are not standard
      // radio/label elements; the selector must cover <li>, <div>, and custom components.
      const strategies = [
        // Exact text via Playwright's :text pseudo-class (innermost match)
        page.locator(`:text-is("${label}")`),
        // Broader: any of these element types containing the label text
        page.locator(`button, label, li, [role="radio"], [role="button"]`).filter({ hasText: new RegExp(`^${label}$`, "i") }),
        // Last resort: any visible element containing the text
        page.locator(`*:visible`).filter({ hasText: new RegExp(`^${label}$`, "i") }),
      ];

      for (const el of strategies) {
        if (await el.count() > 0) {
          await forceClick(el.first());
          console.log(`[viagogo] Selected storage provider: ${label}`);
          clicked = true;
          break;
        }
      }
      if (clicked) break;
    }

    if (!clicked) {
      // Fallback: click "Other" so Continue becomes enabled
      const other = page.locator(`:text-is("Other"), button:has-text("Other"), li:has-text("Other")`).first();
      if (await other.count() > 0) {
        await forceClick(other);
        console.log(`[viagogo] Fell back to "Other" storage provider`);
      } else {
        console.warn(`[viagogo] Could not find any storage provider option`);
      }
    }
    // Wait for the Continue button to enable after selection
    await page.waitForTimeout(500);
  }

  await clickNext(page);
}

async function handleSeatDetailsStep(
  page: Page,
  section: string,
  row: string,
  seatFrom: string,
  seatTo: string,
): Promise<void> {
  const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
  if (!/section|row|seat/i.test(bodyText)) {
    console.log("[viagogo] No seat details step detected — skipping");
    return;
  }

  const fillIfFound = async (selectors: string, value: string, label: string) => {
    const el = page.locator(selectors).first();
    if (await el.count() > 0 && value) {
      await el.fill(value);
      console.log(`[viagogo] Filled ${label}: ${value}`);
    }
  };

  await fillIfFound(
    'input[name*="section" i], input[placeholder*="section" i], input[id*="section" i], input[aria-label*="section" i]',
    section,
    "section",
  );
  await fillIfFound(
    'input[name*="row" i], input[placeholder*="row" i], input[id*="row" i], input[aria-label*="row" i]',
    row,
    "row",
  );

  if (seatFrom && seatTo) {
    // Try "from" and "to" seat inputs
    await fillIfFound(
      'input[name*="seat_from" i], input[name*="seatfrom" i], input[placeholder*="from" i], input[aria-label*="first seat" i]',
      seatFrom,
      "seat from",
    );
    await fillIfFound(
      'input[name*="seat_to" i], input[name*="seatto" i], input[placeholder*="to" i], input[aria-label*="last seat" i]',
      seatTo,
      "seat to",
    );

    // Viagogo sometimes uses a single "seats" input as a range (e.g., "5-7")
    const seatSingle = page.locator(
      'input[name*="seat" i]:not([name*="from" i]):not([name*="to" i]), input[placeholder*="seat number" i]',
    ).first();
    if (await seatSingle.count() > 0 && !(await page.locator('input[name*="seat_from" i]').count())) {
      await seatSingle.fill(seatFrom === seatTo ? seatFrom : `${seatFrom}-${seatTo}`);
      console.log(`[viagogo] Filled seat(s): ${seatFrom}-${seatTo}`);
    }
  }

  await clickNext(page);
}

async function handlePriceStep(page: Page, pricePerTicket: number, faceValuePerTicket: number): Promise<void> {
  console.log(`[viagogo] Price/final step — URL: ${page.url()}`);

  // ── 0. Wait for page to fully hydrate, then diagnose ────────────────────────
  // ListingNotes is a React SPA that fetches pricing strategy data after load.
  // Scroll to top first in case the page renders the pricing section above fold.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(4_000);

  const dumpInputs = async (label: string) => {
    const allInputs = await page.locator("input").all();
    const summary = await Promise.all(allInputs.map(async (el) => {
      const name = await el.getAttribute("name").catch(() => "");
      const type = await el.getAttribute("type").catch(() => "");
      const value = await el.getAttribute("value").catch(() => "");
      const visible = await el.isVisible().catch(() => false);
      return `  name="${name}" type="${type}" value="${value}" visible=${visible}`;
    }));
    console.log(`[viagogo] ${label} — inputs (${allInputs.length}):\n${summary.join("\n")}`);
    return allInputs.length;
  };

  await dumpInputs("After 4s wait");
  await page.screenshot({ path: "/tmp/worker-screenshots/price-step-start.png" }).catch(() => {});

  // Also log visible headings so we know which section is on screen
  const headings = await page.locator("h1, h2, h3, h4").allInnerTexts().catch(() => [] as string[]);
  console.log(`[viagogo] Page headings: ${headings.join(" | ")}`);

  // Both inputs targeted by name (confirmed from DevTools).
  const priceInput = page.locator('input[name="ticketPrice_non_decimal"]');
  const faceInput  = page.locator('input[name="faceValue_non_decimal"]');

  // ── 1. Unlock price input — the pricing section loads after initial render ───
  const priceVisible = await priceInput.isVisible().catch(() => false);
  if (!priceVisible) {
    console.log(`[viagogo] Price input still absent — dumping form HTML for analysis`);
    const formHtml = await page.locator("body").innerHTML().catch(() => "");
    console.log(`[viagogo] Body HTML (first 8000):\n${formHtml.slice(0, 8_000)}`);
    throw new Error("[viagogo] Price input not in DOM after 4s — see HTML dump above");
  }

  // ── 2. Set listing price ─────────────────────────────────────────────────────
  await priceInput.waitFor({ state: "visible", timeout: 5_000 });
  await priceInput.fill(String(pricePerTicket));
  await priceInput.press("Tab");
  const acceptedPrice = await priceInput.inputValue().catch(() => "");
  console.log(`[viagogo] Price set: "${acceptedPrice}" (wanted "${pricePerTicket}")`);

  // ── 2. Set face value ────────────────────────────────────────────────────────
  // Filling the price triggers React to reveal the face value field.
  const faceCount = await faceInput.count();
  console.log(`[viagogo] Face value input in DOM: ${faceCount > 0} (count=${faceCount})`);
  await faceInput.waitFor({ state: "visible", timeout: 8_000 });
  const faceValue = faceValuePerTicket > 0 ? Math.floor(faceValuePerTicket) : 1;
  await faceInput.fill(String(faceValue));
  await faceInput.press("Tab");
  console.log(`[viagogo] Set face value: £${faceValue}`);
  await page.waitForTimeout(300);

  // ── 4. Payout method ────────────────────────────────────────────────────────
  // "Select payout method" may be a collapsed dropdown — try expanding it first.
  const selectPayoutBtn = page.locator("*")
    .filter({ hasText: /^select payout method$/i })
    .first();
  if (await selectPayoutBtn.count() > 0) {
    await forceClick(selectPayoutBtn);
    console.log(`[viagogo] Opened payout method dropdown`);
    await page.waitForTimeout(500);
  }

  // Also try native <select> for payout method
  const payoutSelect = page.locator("select").filter({ hasText: /direct deposit/i }).first();
  if (await payoutSelect.count() > 0) {
    await payoutSelect.selectOption({ label: "Direct deposit" });
    console.log(`[viagogo] Selected payout via <select>: Direct deposit`);
  } else {
    // Click the "Direct deposit" card/option — match any element type
    const ddExact = page.getByText("Direct deposit", { exact: true }).first();
    const ddAny = page.locator("*").filter({ hasText: /^direct deposit$/i }).first();
    const directDeposit = (await ddExact.count() > 0) ? ddExact : ddAny;
    if (await directDeposit.count() > 0) {
      await forceClick(directDeposit);
      console.log(`[viagogo] Selected payout: Direct deposit`);
      await page.waitForTimeout(300);
    } else {
      console.warn(`[viagogo] Could not find "Direct deposit" — may already be selected or section not loaded`);
    }
  }

  // ── 5. Terms & conditions ────────────────────────────────────────────────────
  // Only check the two specific T&C checkboxes — not pricing strategy radio/checkboxes.
  const tcPatterns: RegExp[] = [
    /i agree.*terms|terms.*conditions/i,
    /allow viagogo.*provide|provide.*information.*buyer/i,
  ];
  for (const pattern of tcPatterns) {
    // Look for a <label> whose text matches, click it (toggles associated checkbox)
    const label = page.locator("label").filter({ hasText: pattern }).first();
    if (await label.count() > 0) {
      // Only click if associated checkbox isn't already checked
      const cb = label.locator('input[type="checkbox"]').first();
      const alreadyChecked = await cb.count() > 0 && await cb.isChecked().catch(() => false);
      if (!alreadyChecked) {
        await label.click();
        console.log(`[viagogo] Checked: ${pattern}`);
      }
      continue;
    }
    // Fallback: find standalone checkbox near matching text
    const nearby = page.locator("*").filter({ hasText: pattern }).locator('input[type="checkbox"]').first();
    if (await nearby.count() > 0 && !await nearby.isChecked().catch(() => false)) {
      await nearby.check();
      console.log(`[viagogo] Checked (nearby): ${pattern}`);
    }
  }

  await page.waitForTimeout(500);
}

async function handleFeaturesStep(page: Page, _features: string, _restrictions: string): Promise<void> {
  // The ListingNotes page is the combined final page (price + payout + terms + submit).
  // It triggers the feature/restriction regex but has no separate "Next" button — skip it.
  if (/listingnotes/i.test(page.url())) {
    console.log("[viagogo] On ListingNotes final page — features step skipped");
    return;
  }

  const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
  if (!/feature|restriction|limit|about.*ticket/i.test(bodyText)) {
    console.log("[viagogo] No features/restrictions step detected — skipping");
    return;
  }

  console.log("[viagogo] On features step, proceeding without selecting optional features");
  await clickNext(page);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

// Viagogo renders many controls as styled cards whose pointer events are intercepted
// by React event capture layers.  Try a normal click first; if it times out (element
// is visible/stable but something overlaps), fall back to a direct JS .click() call.
async function forceClick(locator: Locator): Promise<void> {
  try {
    await locator.click({ timeout: 5_000, force: true });
  } catch {
    await locator.evaluate((el) => (el as HTMLElement).click());
  }
}

async function clickNext(page: Page): Promise<void> {
  // Exclude button[type="submit"] — the ListingNotes page has a disabled one that
  // would cause a 30s timeout if matched after a same-session page navigation.
  const candidates = [
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'a:has-text("Next")',
  ];

  const clicked = await clickButton(page, candidates);
  if (clicked) {
    await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
  } else {
    console.warn("[viagogo] Could not find Next/Continue button — page may have advanced automatically");
  }
}

async function clickButton(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (
      await el.count() > 0 &&
      await el.isVisible() &&
      await el.isEnabled()
    ) {
      const urlBefore = page.url();
      try {
        // Short timeout: if the page navigates mid-click (element detaches and the
        // retry lands on a disabled button on the new page) we want to bail quickly.
        await el.click({ timeout: 8_000 });
      } catch {
        // If the URL changed, the click triggered a navigation — treat as success.
        if (page.url() !== urlBefore) return true;
        // Otherwise the element genuinely could not be clicked — try next candidate.
        continue;
      }
      return true;
    }
  }
  return false;
}

async function handleTwoFactor(page: Page, context: BrowserContext, accountId: string, report: ReportFn): Promise<void> {
  const cookies = await context.cookies();
  await report("verification_required", {
    pendingVerification: true,
    encryptedSession: encrypt(JSON.stringify({ cookies })),
  });
  console.log(`[viagogo] 2FA required — waiting up to 5 min for OTP from user`);
  const otp = await pollForOtp(accountId);
  if (!otp) throw new Error("Timed out waiting for 2FA code — enter it in TixTracker and retry");
  console.log(`[viagogo] OTP received, entering code`);
  const otpInput = page.locator(
    'input[type="text"], input[type="number"], input[autocomplete*="one-time"], input[name*="code" i], input[id*="code" i], input[placeholder*="code" i]'
  ).first();
  await otpInput.fill(otp);
  await page.click('button[type="submit"], button:has-text("Verify"), button:has-text("Confirm"), button:has-text("Submit")');
  await page.waitForLoadState("load", { timeout: 15_000 });
}


async function dismissCookieBanner(page: Page): Promise<void> {
  try {
    const btn = page.locator(
      'button:has-text("Accept all"), button:has-text("Accept"), button:has-text("Allow all"), [id*="cookie"] button:has-text("OK")',
    ).first();
    if (await btn.isVisible({ timeout: 3_000 })) {
      await btn.click();
      console.log("[viagogo] Dismissed cookie banner");
    }
  } catch { /* no banner — that's fine */ }
}

async function waitForAnyVisible(page: Page, selectors: string[]): Promise<void> {
  const combined = selectors.join(", ");
  await page.locator(combined).first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
    console.warn(`[viagogo] Timeout waiting for: ${combined}`);
  });
}
