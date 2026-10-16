// TixTracker User Guide — content.
//
// Keeping this as a plain typed data file (rather than scattering copy
// across JSX) is what makes the guide maintainable: adding a new article
// is "add an object to ARTICLES", not touching the rendering component.
// guide-data.test.ts validates this file structurally (no dangling
// relatedIds, no unknown internal links, no duplicate ids) so a mistake
// here fails `npm test` rather than silently shipping a broken guide.

export type NoteType = "tip" | "warning" | "beta";
export type ImportantNote = { type: NoteType; text: string };

export type Article = {
  id: string;
  title: string;
  categoryId: string;
  summary: string; // one-liner shown in search results and related-article cards
  isBeta?: boolean;
  appLink?: { href: string; label: string };
  relatedIds?: string[];
  whatIsIt: string[];
  whyUseIt: string[];
  howToUseIt: string[];
  whatHappensNext: string[];
  importantNotes: ImportantNote[];
};

export type Category = { id: string; label: string; emoji: string };

export const CATEGORIES: Category[] = [
  { id: "getting-started", label: "Getting Started", emoji: "🚀" },
  { id: "dashboard", label: "Dashboard", emoji: "📊" },
  { id: "tickets", label: "Tickets & Inventory", emoji: "🎫" },
  { id: "sales", label: "Sales & Fulfilment", emoji: "💰" },
  { id: "scanning", label: "Scanning & Matching", emoji: "📡" },
  { id: "email", label: "Email Connections", emoji: "✉️" },
  { id: "import-export", label: "Import & Export", emoji: "📁" },
  { id: "notifications", label: "Notifications", emoji: "🔔" },
  { id: "analytics", label: "Analytics & Cash Flow", emoji: "📈" },
  { id: "costs-tax", label: "Costs & Tax", emoji: "🧾" },
  { id: "tools", label: "Other Tools", emoji: "🛠️" },
  { id: "settings", label: "Settings", emoji: "⚙️" },
];

export const ARTICLES: Article[] = [
  // ── GETTING STARTED ──────────────────────────────────────────────────────
  {
    id: "getting-started-order",
    title: "Getting set up, in the right order",
    categoryId: "getting-started",
    summary: "The full first-time setup sequence, from signing up to your first scan.",
    appLink: { href: "/getting-started", label: "Open the setup guide" },
    relatedIds: ["email-connecting", "import-overview", "import-fixing-errors", "notifications-overview"],
    whatIsIt: [
      "A new account is walked through this same order automatically, in a short five-step guide (Welcome → Tickets → Email scanning → Notifications → Done) the first time you sign in. Every step there can be skipped and picked up again later from Settings — this article is the same sequence as plain reference, and for anyone who skipped ahead.",
    ],
    whyUseIt: [
      "Following this order means your dashboard shows real numbers from day one instead of an empty screen, and your historic sales/purchases get picked up correctly instead of needing to be re-imported.",
    ],
    howToUseIt: [
      "1. Sign in with Discord — this is the only way in, and it checks for an active subscription via Whop as part of signing in.",
      "2. Set your basics in Settings — your display currency (Settings → Currency) if you buy or sell in anything other than GBP.",
      "3. Connect your email. Go to Settings → Connections. Outlook connects directly. Gmail currently only works through the IMAP option here (direct Gmail sign-in is marked 'Coming soon'), using an app-specific password rather than your normal Gmail password.",
      "4. Decide if you also want Email Forwarding set up (see the Email Connections category) — this is required if you want instant Discord notifications for new sales, transfers and payouts, not just daily scans.",
      "5. Import your existing inventory. If you already have tickets bought before using TixTracker, use Settings → Import rather than typing them in one by one — see the Import & Export category for how the column mapping and error checking works.",
      "6. Look at the Dashboard. Once email is connected or your import has run, the dashboard (the '/' page) starts showing real figures.",
      "7. Check Tickets and Sales. Confirm what got imported looks right before you rely on it.",
      "8. Set up Notifications if you want them (Settings → Notifications) — see the Notifications category, since what you get depends on how your email is connected.",
      "9. Explore Analytics, Cash Flow, Costs, Tax & Accounts and the Calculator once your core data looks right — these all build on your Tickets/Sales data, so they're most useful once that's accurate.",
    ],
    whatHappensNext: [
      "Once email is connected, TixTracker automatically re-scans it once a day. You don't need to keep opening the app to catch new tickets or sales — though for sales specifically, this only applies if you're using Email Forwarding (see Notifications category for why).",
    ],
    importantNotes: [
      { type: "tip", text: "Do the import before you start manually adding lots of tickets by hand — it's far faster to import a spreadsheet of 50 tickets than add them one at a time." },
      { type: "tip", text: "TixTracker checks your import file for common mistakes (oversold quantities, duplicates, missing information) before saving anything — see 'Fixing import errors' if a row gets flagged." },
    ],
  },

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  {
    id: "dashboard-overview",
    title: "Understanding your Dashboard",
    categoryId: "dashboard",
    summary: "What every card on the home screen actually means.",
    appLink: { href: "/", label: "Open Dashboard" },
    relatedIds: ["analytics-overview", "tickets-statuses"],
    whatIsIt: [
      "The Dashboard (the page you land on when you sign in) is a month-by-month snapshot of how your reselling is going — revenue, ROI, stock still unsold, and what needs attention soon.",
    ],
    whyUseIt: [
      "It's the fastest way to answer 'how am I doing this month' and 'what do I need to deal with before an event happens' without digging through the Tickets or Sales pages.",
    ],
    howToUseIt: [
      "Use the month dropdown at the top to look at any month from a year ago to six months ahead — everything on the page recalculates for that month.",
      "The two goal cards (Monthly profit goal, Yearly profit goal) let you set a £ target and see a progress bar plus a 'Projected' figure for the rest of the period.",
      "The 'Unsold — event within 7 days' table lists tickets that haven't sold yet where the event is a week away or less — your action list.",
      "'Unmatched sales' (only appears if you have any) lists sales that came in but couldn't be linked to a specific ticket purchase — click through to Sales to match them manually.",
      "Use Export (top right) to download a CSV combining every sale with its matched purchase details.",
    ],
    whatHappensNext: [
      "Nothing on this page changes your data — it's a read-only view built from your Tickets and Sales. To fix something you see here (an unmatched sale, stock about to go unsold), you'll do that on the Sales or Tickets page.",
    ],
    importantNotes: [
      { type: "tip", text: "Your profit goal targets are saved in your browser, not your TixTracker account — if you open the dashboard on a different device or browser, you'll need to set them again." },
      { type: "warning", text: "The 'Projected' figure is a simple straight-line estimate (profit so far ÷ days elapsed × days in the period) — not a smart forecast. Early in a month, one or two big sales can make it look dramatically higher or lower than reality. Don't treat it as a guarantee." },
    ],
  },

  // ── TICKETS & INVENTORY ──────────────────────────────────────────────────
  {
    id: "tickets-adding",
    title: "Adding tickets to TixTracker",
    categoryId: "tickets",
    summary: "The two ways tickets get into your inventory: scanning and manual entry.",
    appLink: { href: "/orders", label: "Open Tickets" },
    relatedIds: ["scanning-overview", "import-overview"],
    whatIsIt: [
      "Every ticket you buy needs a record on the Tickets page before TixTracker can track its profit, listing status or sale. There are two ways to create that record.",
    ],
    whyUseIt: [
      "Scanning means you never have to type in a purchase by hand. Manual entry covers anything a scan can't catch — a purchase from a platform with no email confirmation, or something bought before you connected your email.",
    ],
    howToUseIt: [
      "Automatic: once your email is connected (see Email Connections), TixTracker scans it once a day on its own, or you can click 'Scan Mail' on the Tickets page any time for an on-demand check.",
      "Manual: use the add-ticket form on the Tickets page. Only the event name is required — everything else (venue, date, section, cost, quantity) is optional, so you can start rough and fill in details later.",
      "For adding a lot of historic tickets at once, don't add them one by one — use Import instead (see Import & Export).",
    ],
    whatHappensNext: [
      "A new ticket starts as 'Unlisted'. You update its status yourself as you list it, sell it, or decide not to sell it — TixTracker doesn't guess your listing status for you.",
      "Costs you enter are converted to your display currency (set in Settings → Currency) at the time you save.",
    ],
    importantNotes: [
      { type: "tip", text: "If a scan says '0 new' but you know you have a confirmation email, check it's actually from a supported platform/format, and give it a few minutes — large inboxes take longer to scan." },
    ],
  },
  {
    id: "tickets-statuses",
    title: "Ticket statuses and how to organise your inventory",
    categoryId: "tickets",
    summary: "What each status means, and how grouping, filtering and archiving work.",
    appLink: { href: "/orders", label: "Open Tickets" },
    relatedIds: ["tickets-adding", "tickets-bulk-actions"],
    whatIsIt: [
      "Every ticket has a status that drives how it's counted across the app (Dashboard, Analytics, Cash Flow). There are eight: Unlisted, Listed, Partially Sold, Sold, Problem / Missing, Archived, Personal, and Ignored.",
    ],
    whyUseIt: [
      "Keeping statuses accurate is what makes your profit and ROI figures trustworthy — most of the app's calculations key directly off this field.",
    ],
    howToUseIt: [
      "Unlisted, Listed, Partially Sold, Sold and Problem / Missing are set from the quick-status dropdown on a ticket (or in bulk — see Bulk Actions).",
      "Archived, Personal and Ignored are set via their own dedicated actions, not the dropdown — use them to clean up your active view without losing the record.",
      "Archived: for events that have happened and you're done with — hidden from the active view but still counted in your history.",
      "Personal: tickets you bought for yourself, not to resell — excluded from all business profit/ROI figures everywhere in the app.",
      "Ignored: hidden from your active view without being counted as either sold or a write-off — useful for something you're not ready to deal with yet.",
      "Use the search bar, filter chips (event, venue, status, source, account, 'New only') and the Active/Archived/Ignored/Personal tabs to find what you need. Tickets are automatically grouped by event, venue and date.",
    ],
    whatHappensNext: [
      "Changing a ticket's status only affects that ticket and anything calculated from it — it doesn't touch other tickets in the same event group.",
    ],
    importantNotes: [
      { type: "warning", text: "Partially Sold is a specific, exact status — if you've sold some but not all of a batch and the status doesn't actually say 'Partially Sold', the Analytics page's cost-splitting won't apply, and you'll see the full purchase cost counted against only part of the revenue, which distorts that event's profit and ROI." },
    ],
  },
  {
    id: "tickets-bulk-actions",
    title: "Bulk actions, merging and deleting tickets",
    categoryId: "tickets",
    summary: "What each bulk action actually does, and which ones can't be undone.",
    appLink: { href: "/orders", label: "Open Tickets" },
    relatedIds: ["tickets-statuses"],
    whatIsIt: [
      "Selecting multiple tickets on the Tickets page opens a toolbar of bulk actions — archive, mark personal, ignore, delete, edit fields, set status, and merge.",
    ],
    whyUseIt: [
      "Fixing or cleaning up dozens of tickets one at a time is slow. Bulk actions apply the same change to every selected row at once.",
    ],
    howToUseIt: [
      "Archive selected / Mark personal / Ignore selected — all reversible. You can restore a ticket back out of these views later.",
      "Set status — apply one status to every selected ticket.",
      "✏️ Edit Fields — overwrite event name, venue, section, row, seats or date across the whole selection at once.",
      "Merge — only appears when you've selected tickets from two or more different event groups. It renames every ticket in the other selected groups to match the first group's event name, venue and date.",
      "Delete selected — removes the tickets completely.",
    ],
    whatHappensNext: [
      "Archive/Personal/Ignore can be undone from their respective tabs. Edit Fields and Merge change data in place — double check your selection before confirming.",
    ],
    importantNotes: [
      { type: "warning", text: "Delete (bulk or single) is permanent — there is no Deleted/Recycle view for tickets like there is for Sales. The confirmation dialog says this plainly; take it seriously." },
      { type: "warning", text: "Merge does not combine or deduplicate individual duplicate ticket rows into one — it only renames the event-group labels of everything you selected so they match. If you have two literally duplicate ticket purchases, Merge won't remove the duplicate; you'd need to delete the extra one yourself." },
    ],
  },

  // ── SALES & FULFILMENT ────────────────────────────────────────────────────
  {
    id: "sales-recording",
    title: "Recording and matching sales",
    categoryId: "sales",
    summary: "How a sale gets onto TixTracker, and why matching to the right ticket matters.",
    appLink: { href: "/sales", label: "Open Sales" },
    relatedIds: ["scanning-overview", "sales-deleting", "notifications-overview"],
    whatIsIt: [
      "A sale is a separate record from a ticket purchase, linked back to the original ticket it came from. A sale with no link back to a ticket shows up as 'unmatched'.",
    ],
    whyUseIt: [
      "Linking sales to the right ticket is what lets TixTracker calculate real profit (sale price minus what you actually paid) instead of just tracking revenue on its own.",
    ],
    howToUseIt: [
      "Sales arrive automatically via Email Forwarding (see Email Connections) — this is the primary way sales get into TixTracker today.",
      "You can also add a sale manually from the Sales page and match it to an existing ticket yourself.",
      "If a sale can't be auto-matched (new booking reference, mismatched details), it appears unmatched — find it on the Sales page or via the Dashboard's 'Unmatched sales' table and match it manually.",
      "Importing historic sales in bulk uses the Sales page's own Import — a separate tool from the Settings → Import wizard. It can only attach sales to tickets that already exist in your Tickets list; it cannot create a brand-new ticket record for you.",
    ],
    whatHappensNext: [
      "Once matched, the ticket's status updates (to Partially Sold or Sold depending on quantity), and the sale's revenue flows into Analytics, Cash Flow and the Dashboard.",
    ],
    importantNotes: [
      { type: "tip", text: "If you're importing historic sales and the matching ticket doesn't exist yet, import or add the ticket first — the Sales import can only match to tickets that are already there." },
    ],
  },
  {
    id: "sales-fulfilment-payouts",
    title: "Transfers, payouts and fulfilment status",
    categoryId: "sales",
    summary: "Tracking whether a sold ticket has actually been transferred and paid.",
    appLink: { href: "/sales", label: "Open Sales" },
    relatedIds: ["sales-recording", "analytics-overview"],
    whatIsIt: [
      "Selling a ticket isn't the end of the process — it still needs transferring to the buyer and the payout needs to land. TixTracker tracks transfer status and payment status separately from the sale itself.",
    ],
    whyUseIt: [
      "This is how you can tell the difference between 'I've sold this' and 'I've actually been paid for this' — two very different things when it comes to real cash in hand.",
    ],
    howToUseIt: [
      "Use the bulk action bar on the Sales page to mark selected sales as Transferred, Paid Out, or both at once.",
      "Payment status (Paid / not yet) and transfer status (Awaiting Transfer / Transfer Completed) can be checked per-sale or via the Analytics page's 'Sales operations' panel for an account-wide count.",
    ],
    whatHappensNext: [
      "Cash Flow and Analytics both read directly from these two fields — marking something Paid is what moves it from 'awaiting payment' into your received-revenue totals.",
    ],
    importantNotes: [],
  },
  {
    id: "sales-deleting",
    title: "Deleting sales and fixing duplicates",
    categoryId: "sales",
    summary: "How to safely remove a duplicate sale without breaking your profit figures.",
    appLink: { href: "/sales", label: "Open Sales" },
    relatedIds: ["sales-recording"],
    whatIsIt: [
      "Sales can be deleted individually or in bulk (select rows, then 'Delete selected' in the toolbar). Unlike Tickets, a deleted sale is recoverable.",
    ],
    whyUseIt: [
      "The most common reason to delete a sale is a genuine duplicate — the same real-world sale recorded twice, usually from importing or matching it more than once.",
    ],
    howToUseIt: [
      "Select the duplicate sale(s) and click Delete selected (or use the single 'x' on one row). Confirm when prompted.",
      "Deleted sales move to the Deleted tab — nothing is gone for good, so you can restore one if you deleted the wrong row.",
      "Deleting a sale automatically recalculates the linked ticket's totals and status, so your Dashboard and Analytics figures update correctly.",
    ],
    whatHappensNext: [
      "The ticket this sale was linked to gets its revenue and status recalculated from whatever sales remain on it — if you deleted the only sale it had, it goes back to Unlisted.",
    ],
    importantNotes: [
      { type: "tip", text: "Before deleting what looks like a duplicate, check the two sales aren't both genuinely real (e.g. two tickets from the same batch sold separately on the same day for the same price) — look at the quantity and timestamps, not just the amount." },
    ],
  },

  // ── SCANNING & MATCHING ───────────────────────────────────────────────────
  {
    id: "scanning-overview",
    title: "How scanning works",
    categoryId: "scanning",
    summary: "What gets scanned, when, and how matching prevents duplicates.",
    appLink: { href: "/scans", label: "Open Scans" },
    relatedIds: ["email-connecting", "email-forwarding", "sales-recording"],
    whatIsIt: [
      "Scanning is how TixTracker reads your connected inbox and turns confirmation emails into ticket and sale records automatically.",
    ],
    whyUseIt: [
      "It replaces manually copying details out of every confirmation email — purchase confirmations become tickets, and (if you're using Email Forwarding) sale/transfer/payout confirmations become sales.",
    ],
    howToUseIt: [
      "Automatic: every connected account is scanned once a day without you doing anything.",
      "On demand: click 'Scan Mail' on the Tickets page to trigger an immediate check of your connected Gmail/Outlook/IMAP accounts for new purchase confirmations.",
      "Check the Scans page any time to see a history of every scan run — per-account results, and any errors.",
    ],
    whatHappensNext: [
      "New purchase confirmations become new Tickets. If a scan finds an update to something already on file (a status change in a follow-up email, say), it updates the existing record rather than creating a second one — matching is done by booking reference and other identifying details, so you shouldn't end up with duplicates from re-scanning the same email twice.",
    ],
    importantNotes: [
      { type: "warning", text: "There is no 'Scan Sales' button — sales are not picked up by scanning your inbox directly. Sales only come in via Email Forwarding (see Email Connections and Notifications). If you've only connected Gmail/Outlook/IMAP directly, your tickets will import fine but your sales won't appear unless you also set up forwarding." },
    ],
  },
  {
    id: "scanning-platforms",
    title: "Supported platforms and sources",
    categoryId: "scanning",
    summary: "Which ticketing sites and marketplaces TixTracker can actually read confirmations from.",
    relatedIds: ["scanning-overview"],
    whatIsIt: [
      "TixTracker can recognise confirmation emails from a specific set of ticketing platforms and resale marketplaces — it can't read an email format it's never seen before.",
    ],
    whyUseIt: [
      "Knowing what's actually supported avoids the confusion of 'why didn't this import' when the real answer is simply that the source isn't recognised yet.",
    ],
    howToUseIt: [
      "Ticket purchase confirmations: Ticketmaster (multiple regions), AXS, and others recognised by the scan log's provider list.",
      "Resale/marketplace sale confirmations: Viagogo and Lysted are both genuinely supported today. Others may be added over time.",
      "If you sell somewhere that isn't recognised, you can still add the sale manually on the Sales page.",
    ],
    whatHappensNext: [],
    importantNotes: [
      { type: "warning", text: "Don't rely on marketing pages elsewhere for an up-to-date list of supported platforms — check the Scans page's own provider breakdown for what's genuinely been scanning successfully on your account." },
    ],
  },

  // ── EMAIL CONNECTIONS ─────────────────────────────────────────────────────
  {
    id: "email-connecting",
    title: "Connecting your email",
    categoryId: "email",
    summary: "Gmail, Outlook and IMAP — what's actually available today.",
    appLink: { href: "/settings", label: "Open Settings → Connections" },
    relatedIds: ["email-forwarding", "scanning-overview"],
    whatIsIt: [
      "Settings → Connections is where you link an email account so TixTracker can scan it for ticket and sale confirmations.",
    ],
    whyUseIt: [
      "This is what makes scanning possible at all — without a connected account, nothing can be automatically imported.",
    ],
    howToUseIt: [
      "Outlook: click 'Connect Outlook' and sign in — this connects directly via Microsoft's own login.",
      "Gmail: direct Gmail sign-in is currently marked 'Coming soon' and isn't available. Use the IMAP option instead, with an app-specific password (not your regular Gmail password) — Settings explains how to generate one.",
      "IMAP also supports iCloud Mail, Yahoo, and custom domains, using the same app-specific-password approach.",
      "You can connect more than one account — one is marked as your primary.",
    ],
    whatHappensNext: [
      "Once connected, the account is included in the daily scan automatically, and in any manual 'Scan Mail' you trigger from the Tickets page.",
    ],
    importantNotes: [
      { type: "warning", text: "If you were told Gmail connects directly, that's currently inaccurate — it only works via the IMAP + app-specific-password route for now." },
    ],
  },
  {
    id: "email-forwarding",
    title: "Email forwarding — and why it matters for notifications",
    categoryId: "email",
    summary: "The alternative to direct connection, and the only path that enables instant Discord alerts.",
    appLink: { href: "/forward-mail", label: "Open Forward Mail" },
    relatedIds: ["email-connecting", "notifications-overview", "sales-recording"],
    whatIsIt: [
      "Email Forwarding gives you a dedicated TixTracker email address. Instead of (or alongside) connecting your whole inbox, you forward specific ticket-related emails to that address, and TixTracker processes them as they arrive.",
    ],
    whyUseIt: [
      "This is the only way sales, transfer and payout confirmations currently reach TixTracker — and the only path that triggers instant Discord notifications for them. Direct Gmail/Outlook/IMAP connection only covers ticket purchase scanning.",
    ],
    howToUseIt: [
      "Find your forwarding address in Settings, and follow the step-by-step setup instructions for your email provider (Gmail, Outlook, Apple Mail, Yahoo and ProtonMail are all covered) on the How to Forward page.",
      "Set up a forwarding rule in your own mailbox so ticket-related emails (purchase confirmations, sale confirmations, transfer and payout emails) get sent on automatically — you don't need to forward every single email manually once the rule is set.",
      "Check the Forward Mail page any time to see a log of everything that's come in and how it was processed (Imported, Updated, Duplicate, Failed, and a few other statuses).",
    ],
    whatHappensNext: [
      "A forwarded ticket purchase becomes a new Ticket. A forwarded sale/transfer/payout confirmation becomes or updates a Sale, and — if you've set up Discord notifications — triggers an instant alert.",
    ],
    importantNotes: [
      { type: "tip", text: "If you want instant notifications for new sales, this is the setup step that actually enables it — connecting Gmail/Outlook/IMAP on its own does not." },
      { type: "warning", text: "A duplicate forward (forwarding the same email twice) is logged as 'Duplicate' and skipped — it won't create a second record, so forwarding something twice by accident is safe." },
    ],
  },

  // ── IMPORT & EXPORT ───────────────────────────────────────────────────────
  {
    id: "import-overview",
    title: "Importing your existing records",
    categoryId: "import-export",
    summary: "TixTracker checks your file for problems before anything is saved — here's what it looks for.",
    appLink: { href: "/settings", label: "Open Settings → Import" },
    relatedIds: ["getting-started-order", "tickets-adding", "import-fixing-errors"],
    whatIsIt: [
      "A guided 4-step wizard (Upload → Map fields → Preview → Done) for bringing in tickets and sales you already have in a spreadsheet, instead of adding them one at a time. A separate importer on the Sales page handles a spreadsheet of sales on its own, matched automatically against your existing tickets.",
    ],
    whyUseIt: [
      "If you're moving from spreadsheets or another tool, this is by far the fastest way to get your historic data into TixTracker.",
    ],
    howToUseIt: [
      "Go to Settings → Import. Upload a .csv, .xlsx, .xls, .tsv or .ods file (max 5MB) — drag and drop or click to browse.",
      "If you only want to import ticket purchases (no sale/transfer/payment data), use the 'import as tickets' mode — reached via the link from the Tickets page — which clearly marks every row as Unlisted.",
      "On the mapping step, TixTracker auto-matches your spreadsheet's column headers to the right fields — check every mapping, especially anything financial, rather than trusting the autofill blindly.",
      "Tell TixTracker what currency your file's money values are in — they're converted automatically before saving, so this matters even if your figures look right at a glance.",
      "Not sure what headers to use? Use 'Download Template CSV' to get an example file with the exact expected column names.",
      "The preview step checks every row — not just the first few — before anything is saved, and sorts them into three groups: ready to import, need attention, and can't be imported yet. See 'Fixing import errors' for what each of those means.",
    ],
    whatHappensNext: [
      "Only rows that passed the check (plus any 'need attention' rows you explicitly chose to include) become real Ticket/Sale records — rows marked 'can't be imported yet' are never written to your account, and nothing is changed silently to force a row through.",
      "A short record of what was imported and when appears under 'Recent imports' on the Import tab.",
    ],
    importantNotes: [
      { type: "warning", text: "The checks catch the common mistakes (oversold quantities, duplicates, missing information, wrong currency) but can't read your mind — always glance over the preview before confirming, especially for anything financial." },
      { type: "tip", text: "Importing a smaller test batch first (10-20 rows) is a good way to confirm your mapping is right before committing to everything at once." },
    ],
  },
  {
    id: "import-fixing-errors",
    title: "Fixing import errors",
    categoryId: "import-export",
    summary: "What 'needs attention' and 'can't import yet' actually mean, in plain English.",
    relatedIds: ["import-overview"],
    whatIsIt: [
      "Before anything is saved, every row in your file is sorted into one of three groups: ready to import, needs attention, or can't be imported yet.",
    ],
    whyUseIt: [
      "This is what stops a messy spreadsheet from quietly creating wrong quantities, duplicate records, or misleading profit figures — which is exactly how a batch of incorrect data can end up looking like real inventory.",
    ],
    howToUseIt: [
      "Ready to import: no problems found — these rows import as soon as you confirm.",
      "Needs attention: something unusual but not necessarily wrong — a duplicate-looking order, an unusually large amount, a sale price far below the purchase cost. Each one is explained in plain English (e.g. \"This order has 2 tickets, but 4 are marked sold\") with the row number so you can find it in your file. Tick 'Also import rows that need attention' to include them as-is, or fix your file and re-upload.",
      "Can't be imported yet: a hard problem — a missing event name, an invalid quantity, or a sale that would oversell a ticket. These rows are never written to your account until the underlying file is corrected and re-uploaded.",
      "Nothing is ever defaulted to zero or guessed on your behalf — a missing cost or sale price is always flagged, never silently treated as £0, since that would misrepresent your profit.",
    ],
    whatHappensNext: [
      "Fixing the file usually means correcting it in your spreadsheet and re-uploading — the import never partially commits a row, so re-uploading the corrected file is always safe.",
    ],
    importantNotes: [
      { type: "tip", text: "If a row keeps getting flagged as a possible duplicate but it's genuinely a second, separate purchase of the same event, you can still choose to import it — the duplicate check is a warning, not a block." },
    ],
  },
  {
    id: "export-overview",
    title: "Exporting your data",
    categoryId: "import-export",
    summary: "Where to find CSV exports across the app.",
    relatedIds: ["import-overview"],
    whatIsIt: [
      "Several pages let you download your data as a CSV file — useful for backups, sharing with an accountant, or working in a spreadsheet alongside TixTracker.",
    ],
    whyUseIt: [
      "Keeps you from being locked into the app for anything you need to do outside it.",
    ],
    howToUseIt: [
      "Tickets page: Export downloads every ticket (excluding Ignored/Personal).",
      "Dashboard: Export downloads a combined sale + matched-ticket CSV.",
      "Analytics: Export downloads only the tickets currently counted as sold, with full profit/ROI columns.",
      "Tax & Accounts has its own dedicated accountant export — see the Costs & Tax category.",
    ],
    whatHappensNext: [],
    importantNotes: [],
  },

  // ── NOTIFICATIONS (major section) ────────────────────────────────────────
  {
    id: "notifications-overview",
    title: "How notifications work",
    categoryId: "notifications",
    summary: "The only two delivery methods that exist today, and what actually triggers each.",
    appLink: { href: "/settings", label: "Open Settings → Notifications" },
    relatedIds: ["notifications-discord-setup", "notifications-unsold-alerts", "notifications-sms-codes", "email-forwarding"],
    whatIsIt: [
      "TixTracker currently delivers notifications in exactly two ways: Discord messages via a webhook you create yourself, and SMS verification codes forwarded to Discord. There is no browser push notification, no native mobile app, and no in-app notification bell — if you want an alert, it arrives in Discord.",
    ],
    whyUseIt: [
      "Instant alerts mean you don't have to keep the app open to know when a ticket sells, a transfer completes, a payout lands, or a verification code arrives for a purchase.",
    ],
    howToUseIt: [
      "Set up a Discord webhook first (see 'Setting up Discord alerts') — everything else builds on having one.",
      "Decide which events you actually want pinged for in Settings → Notifications → Notification format — order, sale, transfer and payout alerts can each be switched on or off independently, and you can choose which fields appear in each message.",
      "If you want alerts the moment a sale/transfer/payout happens — not just a daily summary — make sure Email Forwarding is set up (see Email Connections). This is the only path that triggers those instant pings.",
    ],
    whatHappensNext: [
      "If nothing is configured — no webhook saved, no Email Forwarding set up — nothing happens and no error is shown. TixTracker simply has nothing to send, so it skips sending silently rather than failing loudly.",
    ],
    importantNotes: [
      { type: "warning", text: "Connecting Gmail, Outlook or IMAP directly (without Email Forwarding) gets your tickets imported, but will NOT trigger Discord pings for sales, transfers or payouts — only the daily unsold-ticket digest applies to that setup. If you're not seeing per-sale notifications, this is almost always why." },
      { type: "tip", text: "\"Mobile notifications\" here means the Discord mobile app's own push notifications for your server — not anything TixTracker sends directly to your phone." },
    ],
  },
  {
    id: "notifications-discord-setup",
    title: "Setting up Discord alerts",
    categoryId: "notifications",
    summary: "Create a webhook in your own Discord server and connect it.",
    appLink: { href: "/settings", label: "Open Settings → Notifications" },
    relatedIds: ["notifications-overview"],
    whatIsIt: [
      "A Discord webhook is a private URL that lets TixTracker post messages into one specific channel of your Discord server. You create it yourself — TixTracker never has access to your whole server.",
    ],
    whyUseIt: [
      "This is the one-time setup every other notification feature in TixTracker depends on.",
    ],
    howToUseIt: [
      "In Discord: Server Settings → Integrations → Webhooks → New Webhook. Choose which channel it should post to, then Copy Webhook URL.",
      "In TixTracker: Settings → Notifications, paste the URL into the Discord webhook field, click Save.",
      "Click 'Send test ping' to confirm it's working — you should see a message appear in the Discord channel you chose within a few seconds.",
      "To turn alerts off later, clear the field and save — this disables everything that depends on it.",
    ],
    whatHappensNext: [
      "Once saved, this one webhook is used by every alert type unless you've given a specific feature (like SMS code forwarding) its own separate webhook.",
    ],
    importantNotes: [
      { type: "tip", text: "If the test ping doesn't arrive, double-check you copied the full webhook URL (it should start with https://discord.com/api/webhooks/) and that the channel permissions allow webhook messages." },
    ],
  },
  {
    id: "notifications-unsold-alerts",
    title: "Unsold ticket alerts",
    categoryId: "notifications",
    summary: "The daily digest warning you about events coming up with unsold stock.",
    appLink: { href: "/settings", label: "Open Settings → Notifications" },
    relatedIds: ["notifications-discord-setup", "dashboard-overview"],
    whatIsIt: [
      "A daily Discord message listing any tickets that haven't sold yet where the event is 7, 3, 2 or 1 day(s) away.",
    ],
    whyUseIt: [
      "Catches stock you might forget about before it becomes worthless — this is the same information as the Dashboard's 'Unsold — event within 7 days' table, delivered to you automatically instead of you having to check.",
    ],
    howToUseIt: [
      "Requires a Discord webhook to already be set up (see 'Setting up Discord alerts').",
      "Nothing else to configure — it runs automatically once a webhook is saved.",
    ],
    whatHappensNext: [
      "The check runs once a day. If nothing qualifies that day, no message is sent at all — you won't get an empty 'nothing to report' ping.",
    ],
    importantNotes: [
      { type: "warning", text: "The Notifications tab lets you pick a preferred send time and timezone, but this doesn't currently change anything — the check genuinely only runs once a day at a fixed time, and the settings page's own text says custom scheduling isn't active yet. Don't rely on it for a specific time of day." },
    ],
  },
  {
    id: "notifications-sms-codes",
    title: "SMS verification code forwarding",
    categoryId: "notifications",
    summary: "Get a Ticketmaster/marketplace verification code pushed to Discord without checking SMSPass yourself.",
    appLink: { href: "/settings", label: "Open Settings → SMS verification codes" },
    relatedIds: ["notifications-discord-setup"],
    whatIsIt: [
      "If you use a third-party SMS-receiving service (SMSPass.io) to get verification codes for purchases, TixTracker can check for new codes on your behalf and forward them straight to Discord — this is the one notification type that's near-instant (checked every few seconds) rather than daily.",
    ],
    whyUseIt: [
      "Saves you having to keep SMSPass's own site open and refreshing it during a checkout that needs a verification code.",
    ],
    howToUseIt: [
      "You need your own SMSPass.io account and API key — this is a separate paid service, not something TixTracker provides.",
      "In Settings, paste your SMSPass API key into the 'SMS verification codes' section. Make sure you paste only the key itself, not the full URL from SMSPass's own site.",
      "Optionally set a dedicated Discord webhook just for codes — if you leave this blank, it uses your main notification webhook instead.",
      "Click Save, then 'Test connection' to confirm the key is valid and a test message reaches Discord.",
    ],
    whatHappensNext: [
      "From then on, any new code sent to your SMSPass number is forwarded to Discord automatically — typically within a few seconds, not the next day.",
    ],
    importantNotes: [
      { type: "tip", text: "The first time you turn this on, it only looks at messages from the last 5 minutes — it won't flood your Discord channel with your entire SMS history." },
      { type: "warning", text: "If nothing arrives, the most common cause is pasting the whole SMSPass URL instead of just the key — re-check and re-save if 'Test connection' fails." },
    ],
  },

  // ── ANALYTICS & CASH FLOW ─────────────────────────────────────────────────
  {
    id: "analytics-overview",
    title: "Analytics: profit, ROI and performance",
    categoryId: "analytics",
    summary: "Understanding Closed vs Full portfolio, and what each stat actually measures.",
    appLink: { href: "/analytics", label: "Open Analytics" },
    relatedIds: ["cash-flow-overview", "dashboard-overview"],
    whatIsIt: [
      "A detailed profit and ROI reporting page, with flexible date ranges and event-level breakdowns — the deeper counterpart to the Dashboard's headline numbers.",
    ],
    whyUseIt: [
      "Answers questions like 'which events made me the most money', 'what's my real ROI this year', and 'how fast do my tickets typically sell'.",
    ],
    howToUseIt: [
      "Pick a date range: All Time, This Week, This Month, This Year, Last Year, or a Custom range.",
      "Switch the portfolio toggle between 'Closed' (only counts cost for tickets that have actually sold) and 'Full portfolio' (counts the cost of everything you've bought, including stock still unsold, against only the revenue that's actually come in) — these two views can show quite different ROI numbers from the exact same data, so check which one you're looking at before comparing figures.",
      "Use the Best/Worst 3 events tables and the full sortable event table (click any column header) to see performance by event.",
      "The 'Sales operations' panel shows revenue received vs pending, and transfer/payment status counts — pulled from the same underlying data Cash Flow uses, so the two pages should broadly agree.",
      "You can edit a ticket's Sold Total or status directly in the 'Sold tickets' table on this page — a second way to mark something sold, separate from the Tickets or Sales pages.",
      "Export downloads a CSV of everything currently counted as sold.",
    ],
    whatHappensNext: [],
    importantNotes: [
      { type: "warning", text: "'Closed' and 'Full portfolio' are genuinely different calculations, not just different labels for the same number — always check which mode you're in before drawing conclusions from the ROI figure." },
      { type: "warning", text: "Cost-splitting for a partially-sold batch only kicks in when a ticket's status is exactly 'Partially Sold' — see Tickets & Inventory for why keeping statuses accurate matters here." },
    ],
  },
  {
    id: "cash-flow-overview",
    title: "Cash Flow: when the money actually lands",
    categoryId: "analytics",
    summary: "A tax-year view of cash timing, distinct from Analytics' profit/ROI focus.",
    appLink: { href: "/cash-flow", label: "Open Cash Flow" },
    relatedIds: ["analytics-overview"],
    whatIsIt: [
      "A UK tax-year view (6 April to 5 April) focused purely on cash timing — when money actually arrived or is expected, month by month.",
    ],
    whyUseIt: [
      "Analytics answers 'was this profitable'. Cash Flow answers 'do I actually have the money yet' — useful for knowing your real available cash versus money that's sold but not yet paid out.",
    ],
    howToUseIt: [
      "Pick a tax year from the selector (only years with events show up).",
      "The month-by-month grid (April to March) is colour-coded — green means received, blue means projected/future, amber is mixed, grey means no sales that month. Click any month for a detailed breakdown of events and cash-in for that month.",
      "The four summary cards show revenue received, amount awaiting payment, your total cash position (received + awaiting), and the cost tied up in unsold stock for future events this tax year.",
    ],
    whatHappensNext: [],
    importantNotes: [
      { type: "tip", text: "Cash Flow only works in UK tax years and has no custom date range — use Analytics instead if you need a different period." },
    ],
  },

  // ── COSTS & TAX ───────────────────────────────────────────────────────────
  {
    id: "costs-overview",
    title: "Tracking costs and overheads",
    categoryId: "costs-tax",
    summary: "Subscriptions, recurring bills and one-off business expenses.",
    appLink: { href: "/costs", label: "Open Costs" },
    relatedIds: ["tax-accounts-overview"],
    whatIsIt: [
      "A dedicated place to log business running costs that aren't tied to a specific ticket — subscriptions, tools, recurring overheads, and one-off expenses.",
    ],
    whyUseIt: [
      "Ticket purchase cost isn't your only outgoing — this is how tools, subscriptions and other overhead get factored into your real running costs for Tax & Accounts.",
    ],
    howToUseIt: [
      "Add a cost with its amount, category, billing cycle (one-off or recurring) and the date it was actually billed.",
      "Recurring monthly charges can be auto-added each month rather than re-entered by hand.",
    ],
    whatHappensNext: [
      "Costs logged here feed into Tax & Accounts as running costs for the relevant accounting period — using the date you actually billed them, not when you happened to enter them into TixTracker.",
    ],
    importantNotes: [],
  },
  {
    id: "tax-accounts-overview",
    title: "Tax & Accounts",
    categoryId: "costs-tax",
    summary: "Accounting periods, readiness checks and accountant exports — and what it isn't.",
    appLink: { href: "/tax-accounts", label: "Open Tax & Accounts" },
    relatedIds: ["costs-overview"],
    whatIsIt: [
      "A hub that organises your tickets, sales and costs into proper accounting periods (UK tax years for a sole trader, or your company's own accounting year if you're a limited company), with a readiness check for how complete your records are, and an export aimed at handing to an accountant.",
    ],
    whyUseIt: [
      "Turns your raw transaction history into something closer to what an accountant actually needs — grouped by the right period, with gaps and issues flagged rather than hidden.",
    ],
    howToUseIt: [
      "On first use, you'll be asked to set up your business history — whether you're a sole trader, a limited company, or transitioned between the two, and when. This matters because it decides which legal entity owns which period of your history.",
      "Each period shows a readiness score covering records actually in that period, plus a separate check for any historic records still missing a date and therefore not assigned to any period yet.",
      "Review flagged issues (missing dates, unclear fees, missing evidence) before treating a period as finished.",
      "Use the Accountant Pack tab to see what's blocking a clean export, and generate one once your records are in good shape.",
    ],
    whatHappensNext: [],
    importantNotes: [
      { type: "warning", text: "Figures shown here — including any tax or profit estimate — are provisional, built from the records currently assigned to that period. They are not a guaranteed tax calculation and should not replace checking with a real accountant, especially while any records are still flagged as missing or unresolved." },
      { type: "tip", text: "TixTracker deliberately won't guess a missing purchase or sale date for you — a record with an unknown date stays clearly marked as unassigned rather than being silently placed in the wrong tax year." },
    ],
  },

  // ── OTHER TOOLS ───────────────────────────────────────────────────────────
  {
    id: "calculator-overview",
    title: "Calculator",
    categoryId: "tools",
    summary: "A standalone tool for estimating Viagogo UK fees and converting foreign purchases to GBP.",
    appLink: { href: "/viagogo-calculator", label: "Open Calculator" },
    relatedIds: [],
    whatIsIt: [
      "A quick scratchpad for two specific calculations: Viagogo UK listing/payout fees, and converting a foreign-currency ticket cost into GBP using a live exchange rate.",
    ],
    whyUseIt: [
      "Useful for working out roughly what you'd actually receive before listing on Viagogo, or what a foreign purchase really cost you in GBP.",
    ],
    howToUseIt: [
      "Viagogo calculator: enter any one of Display price, Listing price or Payout — the other two update automatically using Viagogo's own UK fee structure.",
      "Currency converter: enter a foreign amount, and it converts to GBP using a live rate fetched on page load, or enter your own rate manually (handy for layering in card/FX fees).",
      "Use Reset to clear the Viagogo fields.",
    ],
    whatHappensNext: [
      "Nothing here is saved or linked to a ticket — it's a standalone calculator, reset whenever you refresh the page.",
    ],
    importantNotes: [
      { type: "warning", text: "This calculator is specific to Viagogo's UK site fee structure. It does not apply to StubHub, Ticombo, AXS or other marketplaces, which have their own, different fee structures." },
    ],
  },
  {
    id: "presale-overview",
    title: "Presale & Codes",
    categoryId: "tools",
    summary: "A dedicated tracker for LA28 Olympics presale access — not a general presale tool.",
    appLink: { href: "/presale", label: "Open Presale & Codes" },
    relatedIds: ["import-overview"],
    whatIsIt: [
      "A specific tracker for LA28 Olympics presale slots — which account is registered, when its access window opens and closes, and whether it needs a code.",
    ],
    whyUseIt: [
      "If you're managing multiple accounts' presale access for this event, it keeps slot windows and status (Live now / Upcoming / Expired) in one place instead of scattered notes.",
    ],
    howToUseIt: [
      "Add entries manually, or use Rescan Emails to pick up new ones from your forwarded mail automatically.",
      "Import a spreadsheet of entries in bulk, with the same column-mapping and duplicate-detection approach as the main Import wizard.",
      "Export your current entries to CSV or Excel.",
    ],
    whatHappensNext: [],
    importantNotes: [
      { type: "tip", text: "This page is currently built specifically around the LA28 Olympics — it isn't a general-purpose tool for tracking presale codes for any event." },
    ],
  },
  {
    id: "clients-overview",
    title: "Clients",
    categoryId: "tools",
    summary: "A simple buyer directory built automatically from your sales history.",
    appLink: { href: "/clients", label: "Open Clients" },
    relatedIds: ["sales-recording"],
    whatIsIt: [
      "A list of everyone who's bought from you, grouped by their email, with their purchase history and total spend — built automatically from your Sales data, nothing to set up separately.",
    ],
    whyUseIt: [
      "Useful for spotting repeat buyers, or emailing a group of past buyers directly from the page.",
    ],
    howToUseIt: [
      "Search or filter by real vs. proxy email, or past vs. future events.",
      "Use the bulk email composer with templates to message a selection of clients at once, sent from one of your connected email accounts.",
    ],
    whatHappensNext: [],
    importantNotes: [
      { type: "warning", text: "Whether you've already emailed a client is tracked in your browser, not your TixTracker account — switching browsers or devices means that tracking starts fresh." },
    ],
  },
  {
    id: "marketplace-accounts",
    title: "Marketplace accounts & auto-listing",
    categoryId: "tools",
    summary: "Connecting a Viagogo login so TixTracker can list tickets on your behalf.",
    appLink: { href: "/settings", label: "Open Settings → Accounts" },
    relatedIds: ["tickets-adding"],
    isBeta: true,
    whatIsIt: [
      "Settings → Accounts lets you connect a Viagogo login. Once connected, you can start an auto-listing job from a ticket on the Tickets page, which logs in and lists it on your behalf.",
    ],
    whyUseIt: [
      "Saves manually logging into Viagogo and filling in the listing form yourself for every ticket.",
    ],
    howToUseIt: [
      "In Settings → Accounts, add your Viagogo email and password — this is encrypted, never stored as plain text.",
      "From a ticket on the Tickets page, start a listing job and fill in the draft details (quantity, price, section, etc.).",
      "If Viagogo asks for a verification code during the process, TixTracker will prompt you to check your email or phone and enter it — this step is never skipped or automated.",
    ],
    whatHappensNext: [
      "You can follow the job's progress through each step. If the outcome is ambiguous, it's marked as needing manual review rather than assumed successful — always double-check Viagogo directly if you see that status.",
    ],
    importantNotes: [
      { type: "beta", text: "This feature is still maturing — treat auto-listed tickets as something to double-check on Viagogo directly, especially the first few times you use it." },
    ],
  },

  // ── SETTINGS ──────────────────────────────────────────────────────────────
  {
    id: "settings-map",
    title: "Settings, at a glance",
    categoryId: "settings",
    summary: "What each Settings tab is for, and where to go for the full details.",
    appLink: { href: "/settings", label: "Open Settings" },
    relatedIds: ["email-connecting", "import-overview", "notifications-overview", "marketplace-accounts"],
    whatIsIt: [
      "Settings has six tabs: Connections, Import, Currency, Clients, Notifications, and Accounts.",
    ],
    whyUseIt: [
      "A quick map of where everything lives, since most of these are covered in depth elsewhere in this guide.",
    ],
    howToUseIt: [
      "Connections — email accounts (Gmail/Outlook/IMAP). See Email Connections.",
      "Import — the spreadsheet import wizard. See Import & Export.",
      "Currency — your display currency for cost conversions.",
      "Clients — settings for the Clients feature's email templates.",
      "Notifications — Discord webhook, unsold alerts, and SMS code forwarding. See Notifications.",
      "Accounts — marketplace (Viagogo) login connections. See Marketplace accounts & auto-listing.",
    ],
    whatHappensNext: [],
    importantNotes: [],
  },
];
