# Google OAuth Verification Notes — TixTracker

## 1. App Name
TixTracker

## 2. Homepage
https://www.tixtracker.app

## 3. Privacy Policy
https://www.tixtracker.app/privacy

## 4. Terms of Service
https://www.tixtracker.app/terms

## 5. Authorised Domain (add in Google Cloud Console → OAuth consent screen)
tixtracker.app

## 6. Required OAuth Scopes

| Scope | Reason |
|-------|--------|
| `openid` | Standard OpenID Connect — user identity |
| `https://www.googleapis.com/auth/userinfo.email` | User's email address |
| `https://www.googleapis.com/auth/userinfo.profile` | User's display name |
| `https://www.googleapis.com/auth/gmail.modify` | Read ticket emails; mark processed emails as read |
| `https://www.googleapis.com/auth/gmail.labels` | Create and apply organisational labels to processed ticket emails |

**Note:** TixTracker does NOT request `mail.google.com`, `gmail.send`, `gmail.compose` or `gmail.readonly`.

## 7. Scope Justification (for Google submission form)

TixTracker uses Gmail access to scan a user's ticket-related emails and automatically
import ticket purchase, sale, transfer and payout information into their private
TixTracker dashboard. The app also marks successfully processed ticket emails as read
and applies Gmail labels to them for organisation and duplicate-scan prevention.

The Gmail data is used to help users track ticket inventory, sales, transfer status,
payouts, profit and cash flow without manually entering each order.

TixTracker only reads ticket-related emails from supported providers such as
Ticketmaster, AXS, Viagogo, StubHub and Ticombo. The app does not send emails,
compose emails, delete emails, permanently delete emails, or access Gmail data for
advertising.

**gmail.modify** is required because:
- Ticket order confirmations, resale confirmations, transfer confirmations and payout
  emails are delivered to the user's Gmail inbox and must be read to extract ticket
  data.
- After successfully importing a ticket email, TixTracker marks it as read so the same
  email is not re-scanned on subsequent runs.

**gmail.labels** is required because:
- TixTracker creates and applies a Gmail label (e.g. "My Tickets") to successfully
  processed ticket emails so users can clearly see which emails have already been
  imported into TixTracker.
- This label is used only for organising ticket emails processed by TixTracker and is
  never applied to unrelated emails.

TixTracker does not request `mail.google.com`, `gmail.send`, `gmail.compose` or
`gmail.readonly`. The combination of `gmail.modify` + `gmail.labels` is the minimum
required to deliver the described functionality.

## 8. Redirect URI — add ALL of these in Google Cloud Console → Credentials → OAuth 2.0 Client IDs

**Production:**
```
https://www.tixtracker.app/api/gmail/callback
https://tixtracker.app/api/gmail/callback
```

**Local development:**
```
http://localhost:3000/api/gmail/callback
```

The redirect URI is constructed dynamically from the request origin in
`app/api/gmail/connect/route.ts`:
```typescript
const callbackUrl = new URL("/api/gmail/callback", request.url).toString();
```

## 9. Gmail Access — Separate From Login

Gmail connection is **completely separate from user login**.

- **Login flow:** Discord OAuth or email/password via Supabase. No Google scopes requested.
- **Gmail connection:** Optional. User must already be logged in. Initiated via
  Settings → Connections → "Connect Gmail" button → `/api/gmail/connect`.

Users can disconnect Gmail at any time via Settings → Connections → "Disconnect Gmail".

## 10. Demo Video Script (for Google verification submission)

1. Open https://www.tixtracker.app — show homepage explaining what TixTracker does
2. Log in with Discord or email/password
3. Navigate to **Settings → Connections**
4. Click **Connect Gmail**
5. Show Google OAuth consent screen — note `gmail.readonly` scope only
6. Approve access and return to TixTracker
7. Go to **Scans** and run a Gmail scan
8. Show ticket/order/sale/payout data imported into the Orders dashboard
9. Return to **Settings → Connections** — show **Disconnect Gmail** button
10. Explain: TixTracker only reads ticket emails from Ticketmaster, AXS, Viagogo,
    StubHub and Ticombo — it does not send, delete, modify or read unrelated emails

## 11. Data Usage Summary (for Google verification form)

| Question | Answer |
|----------|--------|
| Do you store Google user data? | Yes — OAuth tokens stored server-side in database; extracted ticket fields stored in user account |
| Do you share Google user data? | No |
| Do you sell Google user data? | No |
| Do you use Google user data for advertising? | No |
| Can users revoke access? | Yes — Settings → Connections → Disconnect Gmail; or via Google Account permissions page |
| Can users request data deletion? | Yes — via support@tixtracker.app |

## 12. Key Files

| File | Purpose |
|------|---------|
| `app/api/gmail/connect/route.ts` | Initiates OAuth — defines scopes |
| `app/api/gmail/callback/route.ts` | Exchanges code for tokens, stores in DB |
| `src/lib/gmail-sync.ts` | Gmail scan logic — reads emails, extracts ticket data |
| `app/api/scan-gmail/route.ts` | API endpoint that triggers Gmail scan |
| `app/settings/settings-client.tsx` | Connect Gmail UI and Disconnect Gmail button |
| `app/privacy/page.tsx` | Privacy Policy (public) |
| `app/terms/page.tsx` | Terms of Service (public) |

## 13. Checklist Before Submitting

- [x] Scopes set to `gmail.modify` + `gmail.labels` (not gmail.readonly, not mail.google.com)
- [x] Privacy Policy live at https://www.tixtracker.app/privacy
- [x] Terms of Service live at https://www.tixtracker.app/terms
- [x] Gmail connection is separate from login
- [x] Disconnect Gmail button exists in Settings
- [x] Privacy Policy covers Google data usage, no-sell, no-ad clauses
- [x] Homepage explains what TixTracker does
- [x] Footer links to Privacy Policy and Terms
- [ ] Add `tixtracker.app` as authorised domain in Google Cloud Console
- [ ] Add production redirect URIs in Google Cloud Console (see Section 8)
- [ ] Record demo video showing consent screen, scan and disconnect flow
- [ ] Submit for Google verification
