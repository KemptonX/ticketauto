import AccountAccessForm from "./account-access-form";

// Deliberately NOT linked from /login, the main nav, or anywhere else in
// the app — this exists only for existing email/password customers who
// were locked out when the public login page became Discord-only. Send
// this URL directly to affected customers; it is not meant to be
// discoverable. Remove once those customers have migrated to Discord (or
// been otherwise handled) and requireActiveAccess()'s Discord-only check
// is re-enabled.
export default function AccountAccessPage() {
  return (
    <main className="auth-page">
      <AccountAccessForm />
    </main>
  );
}
