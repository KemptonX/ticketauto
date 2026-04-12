import { Suspense } from "react";
import SettingsClient from "./settings-client";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsClient />
    </Suspense>
  );
}
