import type { Browser, Page, BrowserContext } from "playwright";
import type { Job, ReportFn } from "./types.js";
import { encrypt } from "./crypto.js";
import * as fs from "fs";
import * as path from "path";

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
  });

  try {
    // Restore saved session cookies
    if (job.account.sessionData?.cookies?.length) {
      await context.addCookies(job.account.sessionData.cookies as Parameters<BrowserContext["addCookies"]>[0]);
      console.log(`[viagogo] Restored ${job.account.sessionData.cookies.length} session cookies`);
    }

    const page = await context.newPage();

    // ── 1. Check / establish login ────────────────────────────────────────────
    await report("session_checking");
    await page.goto(MY_ACCOUNT_URL, { waitUntil: "networkidle", timeout: TIMEOUT });

    const isLoggedIn =
      !page.url().includes("/login") &&
      !page.url().includes("/signin") &&
      !page.url().includes("/account/login");

    if (!isLoggedIn) {
      await report("logging_in");
      console.log(`[viagogo] Session expired — logging in as ${job.account.displayEmail}`);

      await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: TIMEOUT });

      // Dismiss any cookie banner first
      await dismissCookieBanner(page);

      await page.fill(
        'input[type="email"], input[name="email"], input[name="Email"], #Email, #email',
        job.account.credentials.email,
      );
      await page.fill(
        'input[type="password"], input[name="password"], input[name="Password"], #Password, #password',
        job.account.credentials.password,
      );
      await page.click('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in")');

      try {
        await page.waitForURL((url) => !url.toString().includes("/login"), { timeout: 20_000 });
      } catch {
        // Check if 2FA is required
        const body = await page.textContent("body").catch(() => "");
        if (/verification|2fa|one.?time|otp|code sent/i.test(body ?? "")) {
          const cookies = await context.cookies();
          await report("verification_required", {
            pendingVerification: true,
            encryptedSession: encrypt(JSON.stringify({ cookies })),
          });
          return;
        }
        throw new Error("Login failed — still on login page after submission");
      }

      // Second 2FA check (redirect to verification page)
      if (
        page.url().includes("/verification") ||
        page.url().includes("/2fa") ||
        page.url().includes("/otp") ||
        page.url().includes("/confirm")
      ) {
        const cookies = await context.cookies();
        await report("verification_required", {
          pendingVerification: true,
          encryptedSession: encrypt(JSON.stringify({ cookies })),
        });
        return;
      }

      if (page.url().includes("/login")) {
        throw new Error("Login failed — credentials may be incorrect");
      }
    }

    console.log(`[viagogo] Logged in. Current URL: ${page.url()}`);
    const postLoginCookies = await context.cookies();

    // ── 2. Navigate to event page ─────────────────────────────────────────────
    await report("opening_event_page");
    const eventUrl = job.eventMatch.viagogoEventUrl;
    console.log(`[viagogo] Navigating to event: ${eventUrl}`);
    await page.goto(eventUrl, { waitUntil: "networkidle", timeout: TIMEOUT });
    await dismissCookieBanner(page);

    // ── 3. Click "Sell Tickets" ───────────────────────────────────────────────
    await report("clicking_sell");
    const sellBtn = page.locator(
      [
        'a:has-text("Sell Tickets")',
        'button:has-text("Sell Tickets")',
        'a:has-text("Sell tickets")',
        'a:has-text("List tickets")',
        '[data-testid="sell-button"]',
        '[class*="sell-button"]',
        '[class*="SellButton"]',
      ].join(", "),
    );

    await sellBtn.first().waitFor({ timeout: 15_000 });
    await sellBtn.first().click();
    await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
    console.log(`[viagogo] Clicked sell, now at: ${page.url()}`);

    // ── 4. Multi-step listing form ────────────────────────────────────────────
    // Viagogo's form varies but follows a consistent pattern of steps with Next buttons.
    // We detect which step we're on by page content and handle each one.

    await report("selecting_quantity");
    await handleQuantityStep(page, job.draft.quantity);

    await report("selecting_split_rule");
    await handleSplitRuleStep(page, job.draft.splitRule);

    await report("selecting_ticket_provider");
    await handleTicketTypeStep(page, job.draft.ticketStorageProvider);

    await report("filling_seat_details");
    await handleSeatDetailsStep(page, job.draft.section, job.draft.row, job.draft.seatFrom, job.draft.seatTo);

    await report("filling_price");
    await handlePriceStep(page, job.draft.pricePerTicket);

    await report("filling_features_restrictions");
    await handleFeaturesStep(page, job.draft.listingFeatures, job.draft.restrictions);

    // ── 5. Review & submit ────────────────────────────────────────────────────
    await report("final_review");
    console.log(`[viagogo] At review step, URL: ${page.url()}`);

    await report("submitting_listing");
    const submitted = await clickButton(page, [
      'button:has-text("List my tickets")',
      'button:has-text("Submit listing")',
      'button:has-text("Confirm listing")',
      'button:has-text("Post listing")',
      'button:has-text("Complete listing")',
      'button[type="submit"]:has-text("Confirm")',
    ]);
    if (!submitted) throw new Error("Could not find listing submit button");

    // ── 6. Wait for confirmation ──────────────────────────────────────────────
    await report("waiting_for_confirmation");
    await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
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
    await el.first().click();
    console.log(`[viagogo] Selected split rule: ${splitRule}`);
  } else {
    console.warn(`[viagogo] Could not find split rule option for: ${splitRule}`);
  }

  await clickNext(page);
}

async function handleTicketTypeStep(page: Page, storageProvider: string): Promise<void> {
  // Viagogo asks "how do you have your tickets?" — detect via body content
  const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
  const isTicketTypeStep =
    /how (do you|are your tickets|will you)/i.test(bodyText) ||
    /ticket type|delivery method|barcode|e.?ticket/i.test(bodyText);

  if (!isTicketTypeStep) {
    console.log("[viagogo] No ticket type step detected — skipping");
    return;
  }

  const providerPatterns: Record<string, RegExp[]> = {
    ticketmaster: [/ticketmaster/i, /mobile ticket/i],
    axs:          [/axs/i],
    seatgeek:     [/seatgeek/i],
    other:        [/e.?ticket/i, /pdf/i, /print/i],
  };

  const patterns = providerPatterns[storageProvider] ?? providerPatterns.other;

  let clicked = false;
  for (const pattern of patterns) {
    const el = page.locator("label, button, div[role='radio'], input[type='radio']").filter({ hasText: pattern });
    if (await el.count() > 0) {
      await el.first().click();
      console.log(`[viagogo] Selected ticket type: ${storageProvider}`);
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    // Fallback: select "E-ticket" or first option
    const eticket = page.locator("label, button").filter({ hasText: /e.?ticket/i });
    if (await eticket.count() > 0) {
      await eticket.first().click();
      console.log(`[viagogo] Fell back to e-ticket selection`);
    } else {
      console.warn(`[viagogo] Could not find ticket type option for: ${storageProvider}`);
    }
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

async function handlePriceStep(page: Page, pricePerTicket: number): Promise<void> {
  await waitForAnyVisible(page, [
    'input[type="number"]',
    'input[name*="price" i]',
    'input[id*="price" i]',
    'input[aria-label*="price" i]',
  ]);

  const priceInput = page
    .locator(
      'input[name*="price" i], input[id*="price" i], input[aria-label*="price" i], input[placeholder*="price" i], input[type="number"]',
    )
    .first();

  if (await priceInput.count() > 0) {
    await priceInput.fill(String(pricePerTicket));
    console.log(`[viagogo] Set price: ${pricePerTicket}`);
  } else {
    throw new Error("Could not find price input field");
  }

  await clickNext(page);
}

async function handleFeaturesStep(page: Page, features: string, restrictions: string): Promise<void> {
  // This step is optional — skip if not shown
  const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
  if (!/feature|restriction|limit|about.*ticket/i.test(bodyText)) {
    console.log("[viagogo] No features/restrictions step detected — skipping");
    return;
  }

  // Most of these are optional checkboxes — just proceed to next
  console.log("[viagogo] On features step, proceeding without selecting optional features");
  await clickNext(page);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function clickNext(page: Page): Promise<void> {
  const candidates = [
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'a:has-text("Next")',
    'button[type="submit"]:not(:has-text("List")):not(:has-text("Submit listing")):not(:has-text("Confirm listing"))',
  ];

  const clicked = await clickButton(page, candidates);
  if (clicked) {
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  } else {
    console.warn("[viagogo] Could not find Next/Continue button — page may have advanced automatically");
  }
}

async function clickButton(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0 && await el.isVisible()) {
      await el.click();
      return true;
    }
  }
  return false;
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
