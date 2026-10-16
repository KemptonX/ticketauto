import { Suspense } from "react";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import SettingsClient from "./settings-client";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return (
    <Suspense fallback={null}>
      <SettingsClient />
    </Suspense>
  );
}
