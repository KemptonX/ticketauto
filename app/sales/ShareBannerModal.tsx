"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency } from "@/src/lib/currency";

// ─── Types (mirrored from sales-client) ──────────────────────────────────────

type Sale = {
  id: number;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  sold_at: string | null;
  qty_sold: number | null;
  price_per_ticket: number | null;
  sale_total: number | null;
  payout_total: number | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  source: string;
  account_email: string | null;
};

type MatchedOrder = {
  total_cost: number | null;
  qty_bought: number | null;
  booking_ref: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSource(source: string): string {
  if (source === "viagogo") return "Viagogo";
  if (source.startsWith("ticketmaster")) return "Ticketmaster";
  if (source === "axs") return "AXS";
  if (source === "manual") return "Manual";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function formatEventDate(value: string | null): string {
  if (!value) return "";
  if (/^[A-Za-z]{2,3}\s+\d{1,2}\s+[A-Za-z]{3}/i.test(value)) return value;
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return `${DAYS[date.getDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
  }
  return value;
}

// ─── Count-up hook ────────────────────────────────────────────────────────────

function useCountUp(target: number, running: boolean, duration = 1100): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!running) return;
    let raf: number;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 4); // easeOutQuart
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, running, duration]);
  return val;
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ["#ff4fa3", "#9b5cff", "#4fc3ff", "#ffd700", "#ff6b6b", "#a8edca"];

function Confetti() {
  const particles = useMemo(() =>
    Array.from({ length: 28 }, (_, i) => {
      const angle = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist = 80 + Math.random() * 120;
      return {
        id: i,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist - 30,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 5 + Math.random() * 5,
        delay: Math.random() * 200,
        shape: i % 4 === 0 ? "square" : "circle",
      };
    }), []);

  return (
    <div style={{ position: "absolute", top: "50%", left: "50%", pointerEvents: "none", zIndex: 10 }}>
      {particles.map(p => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.shape === "circle" ? "50%" : "2px",
            transform: "translate(-50%, -50%)",
            animation: `tx-confetti-fly 1s ease-out ${p.delay}ms both`,
            ["--tx" as string]: `${p.x}px`,
            ["--ty" as string]: `${p.y}px`,
            boxShadow: `0 0 6px ${p.color}`,
          }}
        />
      ))}
    </div>
  );
}

// ─── TicketX Logo mark (SVG) ──────────────────────────────────────────────────

function TxMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="tx-share-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#9B5CFF" />
          <stop offset="100%" stopColor="#FF4FA3" />
        </linearGradient>
      </defs>
      <path d="M4.5 4.5L19.5 19.5" stroke="url(#tx-share-grad)" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M19.5 4.5L4.5 19.5" stroke="url(#tx-share-grad)" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── The shareable banner card ────────────────────────────────────────────────

type BannerProps = {
  sale: Sale;
  order: MatchedOrder | null;
  animated: boolean;
};

export function SaleBanner({ sale, order, animated }: BannerProps) {
  const revenue = sale.payout_total ?? sale.sale_total ?? 0;
  const cost = (() => {
    if (!order?.total_cost) return 0;
    if (!order.qty_bought || !sale.qty_sold || order.qty_bought <= 0) return order.total_cost;
    return (order.total_cost / order.qty_bought) * sale.qty_sold;
  })();
  const profit = revenue - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : null;
  const isPositive = profit >= 0;

  const animatedProfit = useCountUp(profit, animated);
  const animatedRoi = useCountUp(roi ?? 0, animated && roi !== null);

  const displayProfit = animated ? animatedProfit : profit;
  const displayRoi = animated ? animatedRoi : (roi ?? 0);

  const profitColor = isPositive ? "#4ade80" : "#f87171";
  const profitGlow = isPositive
    ? "0 0 40px rgba(74,222,128,0.35), 0 0 80px rgba(74,222,128,0.15)"
    : "0 0 40px rgba(248,113,113,0.35), 0 0 80px rgba(248,113,113,0.15)";

  return (
    <div
      style={{
        width: 540,
        height: 540,
        background: "linear-gradient(145deg, #0c0c16 0%, #080810 60%, #0e0a14 100%)",
        position: "relative",
        overflow: "hidden",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
        flexShrink: 0,
      }}
    >
      {/* Background glow orbs */}
      <div style={{
        position: "absolute", top: -60, left: -60, width: 320, height: 320,
        background: "radial-gradient(circle, rgba(155,92,255,0.10) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", bottom: -40, right: -40, width: 280, height: 280,
        background: "radial-gradient(circle, rgba(255,79,163,0.12) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", top: "40%", left: "50%", transform: "translate(-50%,-50%)",
        width: 300, height: 300,
        background: `radial-gradient(circle, ${isPositive ? "rgba(74,222,128,0.07)" : "rgba(248,113,113,0.07)"} 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      {/* Watermark X */}
      <div style={{
        position: "absolute", bottom: 48, right: 32,
        opacity: 0.04, pointerEvents: "none",
      }}>
        <svg width="180" height="180" viewBox="0 0 24 24" fill="none">
          <path d="M4.5 4.5L19.5 19.5" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M19.5 4.5L4.5 19.5" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      </div>

      {/* Top bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "24px 28px 0",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TxMark size={20} />
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "rgba(255,255,255,0.9)" }}>
            Ticket<span style={{ background: "linear-gradient(135deg,#9b5cff,#ff4fa3)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>X</span>
          </span>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 7,
          background: "rgba(74,222,128,0.12)",
          border: "1px solid rgba(74,222,128,0.3)",
          borderRadius: 999, padding: "5px 12px",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 6px #4ade80" }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#4ade80" }}>
            Sale Completed
          </span>
        </div>
      </div>

      {/* Event info */}
      <div style={{ padding: "18px 28px 0" }}>
        <div style={{
          fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em",
          color: "rgba(255,255,255,0.95)", lineHeight: 1.2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {sale.event_name || "Event"}
        </div>
        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>
            {sale.venue || "Venue"}
          </span>
          {sale.event_date && (
            <>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>·</span>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap" }}>
                {formatEventDate(sale.event_date)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ margin: "16px 28px 0", height: 1, background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))" }} />

      {/* Hero profit */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "0 28px",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", marginBottom: 10 }}>
          Total Profit
        </div>
        <div style={{
          fontSize: 62, fontWeight: 800, letterSpacing: "-0.04em",
          color: profitColor,
          textShadow: profitGlow,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}>
          {isPositive ? "" : "−"}{formatCurrency(Math.abs(displayProfit))}
        </div>
        {roi !== null && (
          <div style={{
            marginTop: 10, display: "flex", alignItems: "center", gap: 8,
            background: `${isPositive ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)"}`,
            border: `1px solid ${isPositive ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`,
            borderRadius: 999, padding: "6px 16px",
          }}>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: profitColor, fontVariantNumeric: "tabular-nums" }}>
              {isPositive ? "+" : "−"}{Math.abs(displayRoi).toFixed(1)}%
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: profitColor, opacity: 0.7 }}>
              ROI
            </span>
          </div>
        )}
      </div>

      {/* Stat boxes */}
      <div style={{ padding: "0 24px 20px", display: "flex", gap: 12 }}>
        {/* Bought For */}
        <div style={{
          flex: 1, background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14, padding: "14px 18px",
          backdropFilter: "blur(8px)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 6 }}>
            Bought For
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: "rgba(255,255,255,0.85)" }}>
            {cost > 0 ? formatCurrency(cost) : "—"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>
            {sale.qty_sold ? `${sale.qty_sold} × ticket${sale.qty_sold > 1 ? "s" : ""}` : "—"}
          </div>
        </div>

        {/* Sold For */}
        <div style={{
          flex: 1, background: "rgba(255,79,163,0.06)",
          border: "1px solid rgba(255,79,163,0.15)",
          borderRadius: 14, padding: "14px 18px",
          backdropFilter: "blur(8px)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,79,163,0.6)", marginBottom: 6 }}>
            Sold For
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: "rgba(255,255,255,0.85)" }}>
            {revenue > 0 ? formatCurrency(revenue) : "—"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>
            via {formatSource(sale.source)}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: "12px 28px 22px",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <TxMark size={14} />
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", color: "rgba(255,255,255,0.25)" }}>
            ticketx.app
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {sale.section && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.22)" }}>
              {sale.section}{sale.row ? ` · Row ${sale.row}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Share Modal ──────────────────────────────────────────────────────────────

type Props = {
  sale: Sale;
  order: MatchedOrder | null;
  onClose: () => void;
};

export default function ShareBannerModal({ sale, order, onClose }: Props) {
  const bannerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 16);
    const t2 = setTimeout(() => setShowConfetti(true), 200);
    const t3 = setTimeout(() => setShowConfetti(false), 1400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  async function capture() {
    if (!bannerRef.current) throw new Error("No banner ref");
    const { default: html2canvas } = await import("html2canvas");
    return html2canvas(bannerRef.current, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
      logging: false,
    });
  }

  async function handleCopy() {
    setCopying(true);
    try {
      const canvas = await capture();
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) { reject(new Error("No blob")); return; }
          try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            resolve();
          } catch {
            // Clipboard API blocked — fall back to download
            const url = canvas.toDataURL("image/png");
            const a = document.createElement("a");
            a.href = url;
            a.download = `${sale.event_name ?? "sale"}-ticketx.png`;
            a.click();
            resolve();
          }
        }, "image/png");
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* ignore */ }
    setCopying(false);
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const canvas = await capture();
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sale.event_name ?? "sale"}-ticketx.png`;
      a.click();
    } catch { /* ignore */ }
    setDownloading(false);
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return createPortal(
    <div
      onClick={handleOverlayClick}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
        opacity: visible ? 1 : 0,
        transition: "opacity 250ms ease",
      }}
    >
      <div
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
          transform: visible ? "scale(1) translateY(0)" : "scale(0.92) translateY(16px)",
          transition: "transform 300ms cubic-bezier(0.16,1,0.3,1), opacity 300ms ease",
          opacity: visible ? 1 : 0,
          position: "relative",
          maxHeight: "100vh",
          overflowY: "auto",
        }}
      >
        {/* Confetti */}
        {showConfetti && <Confetti />}

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em", color: "rgba(255,255,255,0.95)" }}>
              Share your win
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
              Copy the banner and paste it anywhere
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10, width: 36, height: 36, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,255,255,0.55)", fontSize: 18, lineHeight: 1,
              transition: "background 150ms ease",
            }}
          >
            ×
          </button>
        </div>

        {/* Banner preview — wrapped to clip corners for display */}
        <div style={{
          borderRadius: 20, overflow: "hidden",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 80px rgba(0,0,0,0.7), 0 0 60px rgba(155,92,255,0.12)",
          flexShrink: 0,
        }}>
          <div ref={bannerRef}>
            <SaleBanner sale={sale} order={order} animated={visible} />
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={copying}
            style={{
              flex: 1, padding: "14px 0",
              background: copied
                ? "rgba(74,222,128,0.15)"
                : "linear-gradient(135deg, rgba(155,92,255,0.25), rgba(255,79,163,0.25))",
              border: copied
                ? "1px solid rgba(74,222,128,0.4)"
                : "1px solid rgba(255,79,163,0.3)",
              borderRadius: 14, cursor: copying ? "wait" : "pointer",
              color: copied ? "#4ade80" : "rgba(255,255,255,0.9)",
              fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em",
              transition: "all 200ms ease",
              boxShadow: copied ? "0 0 20px rgba(74,222,128,0.2)" : "0 0 20px rgba(255,79,163,0.1)",
            }}
          >
            {copying ? "Capturing…" : copied ? "✓ Copied to clipboard!" : "Copy to Clipboard"}
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            style={{
              padding: "14px 20px",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14, cursor: downloading ? "wait" : "pointer",
              color: "rgba(255,255,255,0.55)",
              fontSize: 14, fontWeight: 600,
              transition: "all 150ms ease",
              whiteSpace: "nowrap",
            }}
          >
            {downloading ? "…" : "Download"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
