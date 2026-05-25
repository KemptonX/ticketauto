import type { Metadata } from "next";
import FaqClient from "./faq-client";

export const metadata: Metadata = {
  title: "FAQ — TixTracker",
  description:
    "Frequently asked questions about TixTracker — the automated ticket reseller dashboard for tracking purchases, sales, profit, and inventory across Ticketmaster, AXS, Viagogo, and more.",
};

export default function FaqPage() {
  return <FaqClient />;
}
