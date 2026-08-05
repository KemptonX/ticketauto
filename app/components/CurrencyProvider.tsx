"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { initCurrencyRates } from "@/src/lib/currency";

const RatesCtx = createContext(false);

export function useRatesReady(): boolean {
  return useContext(RatesCtx);
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void initCurrencyRates().then(() => setReady(true));
  }, []);

  return <RatesCtx.Provider value={ready}>{children}</RatesCtx.Provider>;
}
