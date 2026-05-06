import type { SupabaseClient } from "@supabase/supabase-js";

type AccountRecord = {
  id: string;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
  provider: string;
};

async function refreshGmailToken(supabase: SupabaseClient, account: AccountRecord): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth env vars are missing");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token!,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  const data = (await response.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error || "Failed to refresh Gmail token");

  const nextExpiry = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : account.token_expiry;

  await supabase
    .from("gmail_accounts")
    .update({ access_token: data.access_token, token_expiry: nextExpiry })
    .eq("id", account.id);

  return data.access_token;
}

async function refreshOutlookToken(supabase: SupabaseClient, account: AccountRecord): Promise<string> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Microsoft OAuth env vars are missing");

  const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token!,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !data.access_token) throw new Error(data.error || "Failed to refresh Outlook token");

  const nextExpiry = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : account.token_expiry;

  await supabase
    .from("gmail_accounts")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || account.refresh_token,
      token_expiry: nextExpiry,
    })
    .eq("id", account.id);

  return data.access_token;
}

async function getValidToken(supabase: SupabaseClient, account: AccountRecord): Promise<string> {
  if (!account.access_token) throw new Error(`No access token for account ${account.email}`);
  if (!account.refresh_token || !account.token_expiry) return account.access_token;

  const expiresAt = new Date(account.token_expiry);
  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > Date.now() + 60_000) {
    return account.access_token;
  }

  return account.provider === "outlook"
    ? refreshOutlookToken(supabase, account)
    : refreshGmailToken(supabase, account);
}

async function sendViaGmail(
  accessToken: string,
  from: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join("\r\n");

  const encoded = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail send error ${response.status}: ${text}`);
  }
}

async function sendViaOutlook(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "Text", content: body },
        toRecipients: [{ emailAddress: { address: to } }],
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Outlook send error ${response.status}: ${text}`);
  }
}

export async function sendEmailViaAccount({
  supabase,
  account,
  to,
  subject,
  body,
}: {
  supabase: SupabaseClient;
  account: AccountRecord;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const accessToken = await getValidToken(supabase, account);

  if (account.provider === "outlook") {
    await sendViaOutlook(accessToken, to, subject, body);
  } else {
    await sendViaGmail(accessToken, account.email, to, subject, body);
  }
}
