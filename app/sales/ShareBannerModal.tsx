"use client";

import { useEffect, useMemo, useState } from "react";
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
      <path d="M4.5 4.5L19.5 19.5" stroke="#9B5CFF" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M19.5 4.5L4.5 19.5" stroke="#FF4FA3" strokeWidth="3.5" strokeLinecap="round" />
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
            Ticket<span style={{ color: "#b87bff" }}>X</span>
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

// ─── Multi-sale banner ────────────────────────────────────────────────────────

export type MultiSaleStats = {
  salesCount: number;
  totalTickets: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  roi: number | null;
  eventNames: string[];
};

export function MultiSaleBanner({ stats, animated }: { stats: MultiSaleStats; animated: boolean }) {
  const { totalRevenue, totalCost, totalProfit, roi, salesCount, totalTickets, eventNames } = stats;
  const isPositive = totalProfit >= 0;

  const animatedProfit = useCountUp(totalProfit, animated);
  const animatedRoi = useCountUp(roi ?? 0, animated && roi !== null);
  const displayProfit = animated ? animatedProfit : totalProfit;
  const displayRoi = animated ? animatedRoi : (roi ?? 0);

  const profitColor = isPositive ? "#4ade80" : "#f87171";
  const profitGlow = isPositive
    ? "0 0 40px rgba(74,222,128,0.35), 0 0 80px rgba(74,222,128,0.15)"
    : "0 0 40px rgba(248,113,113,0.35), 0 0 80px rgba(248,113,113,0.15)";

  return (
    <div style={{
      width: 540, height: 540,
      background: "linear-gradient(145deg, #0c0c16 0%, #080810 60%, #0e0a14 100%)",
      position: "relative", overflow: "hidden",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display: "flex", flexDirection: "column",
      borderRadius: 0, flexShrink: 0,
    }}>
      <div style={{ position: "absolute", top: -60, left: -60, width: 320, height: 320, background: "radial-gradient(circle, rgba(155,92,255,0.10) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: -40, right: -40, width: 280, height: 280, background: "radial-gradient(circle, rgba(255,79,163,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "40%", left: "50%", transform: "translate(-50%,-50%)", width: 300, height: 300, background: `radial-gradient(circle, ${isPositive ? "rgba(74,222,128,0.07)" : "rgba(248,113,113,0.07)"} 0%, transparent 70%)`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: 48, right: 32, opacity: 0.04, pointerEvents: "none" }}>
        <svg width="180" height="180" viewBox="0 0 24 24" fill="none">
          <path d="M4.5 4.5L19.5 19.5" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M19.5 4.5L4.5 19.5" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 28px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TxMark size={20} />
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "rgba(255,255,255,0.9)" }}>
            Ticket<span style={{ color: "#b87bff" }}>X</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 999, padding: "5px 12px" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 6px #4ade80" }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#4ade80" }}>
            {salesCount} Sales Completed
          </span>
        </div>
      </div>

      <div style={{ padding: "18px 28px 0" }}>
        {eventNames.length === 1 ? (
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em", color: "rgba(255,255,255,0.95)", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {eventNames[0]}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {eventNames.slice(0, 3).map((name, i) => (
              <div key={i} style={{ fontSize: eventNames.length === 2 ? 15 : 13, fontWeight: 700, letterSpacing: "-0.025em", color: "rgba(255,255,255,0.9)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {name}
              </div>
            ))}
            {eventNames.length > 3 && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>+{eventNames.length - 3} more</div>
            )}
          </div>
        )}
        <div style={{ marginTop: 5, fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
          {totalTickets} ticket{totalTickets !== 1 ? "s" : ""} · {salesCount} sale{salesCount !== 1 ? "s" : ""}
        </div>
      </div>

      <div style={{ margin: "16px 28px 0", height: 1, background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))" }} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 28px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", marginBottom: 10 }}>Total Profit</div>
        <div style={{ fontSize: 62, fontWeight: 800, letterSpacing: "-0.04em", color: profitColor, textShadow: profitGlow, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {isPositive ? "" : "−"}{formatCurrency(Math.abs(displayProfit))}
        </div>
        {roi !== null && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, background: isPositive ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)", border: `1px solid ${isPositive ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`, borderRadius: 999, padding: "6px 16px" }}>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: profitColor, fontVariantNumeric: "tabular-nums" }}>
              {isPositive ? "+" : "−"}{Math.abs(displayRoi).toFixed(1)}%
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: profitColor, opacity: 0.7 }}>ROI</span>
          </div>
        )}
      </div>

      <div style={{ padding: "0 24px 20px", display: "flex", gap: 12 }}>
        <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 6 }}>Total Cost</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: "rgba(255,255,255,0.85)" }}>{totalCost > 0 ? formatCurrency(totalCost) : "—"}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>{totalTickets} ticket{totalTickets !== 1 ? "s" : ""}</div>
        </div>
        <div style={{ flex: 1, background: "rgba(255,79,163,0.06)", border: "1px solid rgba(255,79,163,0.15)", borderRadius: 14, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,79,163,0.6)", marginBottom: 6 }}>Total Revenue</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: "rgba(255,255,255,0.85)" }}>{totalRevenue > 0 ? formatCurrency(totalRevenue) : "—"}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>{salesCount} sale{salesCount !== 1 ? "s" : ""}</div>
        </div>
      </div>

      <div style={{ padding: "12px 28px 22px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <TxMark size={14} />
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", color: "rgba(255,255,255,0.25)" }}>ticketx.app</span>
        </div>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.22)" }}>{salesCount} combined sales</span>
      </div>
    </div>
  );
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────

function _rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

const _F = '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';

function _txMark(ctx: CanvasRenderingContext2D, x: number, y: number, cssSize: number, sc: number) {
  const s = cssSize * sc;
  const r = s / 24;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 3.5 * r;
  ctx.strokeStyle = "#9B5CFF";
  ctx.beginPath();
  ctx.moveTo(x + 4.5 * r, y + 4.5 * r);
  ctx.lineTo(x + 19.5 * r, y + 19.5 * r);
  ctx.stroke();
  ctx.strokeStyle = "#FF4FA3";
  ctx.beginPath();
  ctx.moveTo(x + 19.5 * r, y + 4.5 * r);
  ctx.lineTo(x + 4.5 * r, y + 19.5 * r);
  ctx.stroke();
  ctx.restore();
}

function _bannerBg(ctx: CanvasRenderingContext2D, W: number, H: number, isPos: boolean, sc: number) {
  ctx.fillStyle = "#0c0c16";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(155,92,255,0.07)";
  ctx.fillRect(0, 0, W * 0.55, H * 0.45);
  ctx.fillStyle = "rgba(255,79,163,0.07)";
  ctx.fillRect(W * 0.45, H * 0.55, W * 0.55, H * 0.45);
  ctx.fillStyle = isPos ? "rgba(74,222,128,0.04)" : "rgba(248,113,113,0.04)";
  ctx.fillRect(W * 0.2, H * 0.25, W * 0.6, H * 0.3);
  ctx.save();
  ctx.globalAlpha = 0.04;
  const wx = (540 - 32 - 180) * sc, wy = (540 - 48 - 180) * sc;
  const wmS = 180 * sc, wmR = wmS / 24;
  ctx.lineCap = "round";
  ctx.lineWidth = 3.5 * wmR;
  ctx.strokeStyle = "white";
  ctx.beginPath();
  ctx.moveTo(wx + 4.5 * wmR, wy + 4.5 * wmR);
  ctx.lineTo(wx + 19.5 * wmR, wy + 19.5 * wmR);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(wx + 19.5 * wmR, wy + 4.5 * wmR);
  ctx.lineTo(wx + 4.5 * wmR, wy + 19.5 * wmR);
  ctx.stroke();
  ctx.restore();
}

function _badge(ctx: CanvasRenderingContext2D, rightX: number, cy: number, text: string, sc: number) {
  const fontSize = 11 * sc;
  ctx.save();
  ctx.font = `700 ${fontSize}px ${_F}`;
  const textW = ctx.measureText(text).width;
  const dotR = 3 * sc, gap = 7 * sc, ph = 5 * sc, pw = 12 * sc;
  const pillW = pw + dotR * 2 + gap + textW + pw;
  const pillH = fontSize + ph * 2;
  const px = rightX - pillW, py = cy - pillH / 2;
  _rr(ctx, px, py, pillW, pillH, pillH / 2);
  ctx.fillStyle = "rgba(74,222,128,0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(74,222,128,0.3)";
  ctx.lineWidth = sc;
  ctx.stroke();
  ctx.save();
  ctx.fillStyle = "#4ade80";
  ctx.beginPath();
  ctx.arc(px + pw + dotR, cy, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#4ade80";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, px + pw + dotR * 2 + gap, cy);
  ctx.restore();
}

function _statBox(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string, value: string, sub: string,
  sc: number, pink: boolean,
) {
  ctx.save();
  _rr(ctx, x, y, w, h, 14 * sc);
  ctx.fillStyle = pink ? "rgba(255,79,163,0.06)" : "rgba(255,255,255,0.04)";
  ctx.fill();
  ctx.strokeStyle = pink ? "rgba(255,79,163,0.15)" : "rgba(255,255,255,0.08)";
  ctx.lineWidth = sc;
  ctx.stroke();
  ctx.restore();
  const ix = x + 18 * sc;
  let iy = y + 14 * sc;
  ctx.save();
  ctx.font = `700 ${10 * sc}px ${_F}`;
  ctx.fillStyle = pink ? "rgba(255,79,163,0.6)" : "rgba(255,255,255,0.28)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, ix, iy);
  iy += (10 + 6) * sc;
  ctx.restore();
  ctx.save();
  ctx.font = `700 ${22 * sc}px ${_F}`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(value, ix, iy);
  iy += (22 + 3) * sc;
  ctx.restore();
  ctx.save();
  ctx.font = `400 ${11 * sc}px ${_F}`;
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(sub, ix, iy);
  ctx.restore();
}

function _clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

function _heroSection(
  ctx: CanvasRenderingContext2D,
  W: number,
  heroAreaTop: number, heroAreaBot: number,
  profitStr: string, roi: number | null, isPos: boolean,
  profitColor: string, sc: number,
) {
  const heroCY = (heroAreaTop + heroAreaBot) / 2;
  const bigSz = 62 * sc, labelSz = 11 * sc;
  const roiPillH = roi !== null ? (6 * 2 + 20) * sc : 0;
  const contentH = labelSz + 10 * sc + bigSz + (roi !== null ? 10 * sc + roiPillH : 0);
  const top = heroCY - contentH / 2;

  ctx.save();
  ctx.font = `700 ${labelSz}px ${_F}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText("TOTAL PROFIT", W / 2, top);
  ctx.restore();

  const numTop = top + labelSz + 10 * sc;
  ctx.save();
  ctx.font = `800 ${bigSz}px ${_F}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = profitColor;
  ctx.fillText(profitStr, W / 2, numTop);
  ctx.restore();

  if (roi !== null) {
    const roiTop = numTop + bigSz + 10 * sc;
    const roiStr = (isPos ? "+" : "−") + Math.abs(roi).toFixed(1) + "%";
    const roiLabel = "ROI";
    const ph = 6 * sc, pw = 16 * sc, gap = 8 * sc;
    ctx.save();
    ctx.font = `800 ${20 * sc}px ${_F}`;
    const roiNumW = ctx.measureText(roiStr).width;
    ctx.font = `600 ${12 * sc}px ${_F}`;
    const roiLabelW = ctx.measureText(roiLabel).width;
    ctx.restore();
    const pillW = pw + roiNumW + gap + roiLabelW + pw;
    const pillH = 20 * sc + ph * 2;
    const pillX = W / 2 - pillW / 2;
    ctx.save();
    _rr(ctx, pillX, roiTop, pillW, pillH, pillH / 2);
    ctx.fillStyle = isPos ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)";
    ctx.fill();
    ctx.strokeStyle = isPos ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)";
    ctx.lineWidth = sc;
    ctx.stroke();
    ctx.restore();
    const pillCY = roiTop + pillH / 2;
    ctx.save();
    ctx.font = `800 ${20 * sc}px ${_F}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = profitColor;
    ctx.fillText(roiStr, pillX + pw, pillCY);
    ctx.restore();
    ctx.save();
    ctx.font = `600 ${12 * sc}px ${_F}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = profitColor;
    ctx.globalAlpha = 0.7;
    ctx.fillText(roiLabel, pillX + pw + roiNumW + gap, pillCY);
    ctx.restore();
  }
}

function _bannerFooter(
  ctx: CanvasRenderingContext2D,
  W: number, footerTop: number, spad: number, sc: number, rightText: string,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = sc;
  ctx.beginPath();
  ctx.moveTo(0, footerTop);
  ctx.lineTo(W, footerTop);
  ctx.stroke();
  ctx.restore();
  const fIconSz = 14, fY = footerTop + 12 * sc;
  _txMark(ctx, spad, fY, fIconSz, sc);
  ctx.save();
  ctx.font = `600 ${12 * sc}px ${_F}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText("ticketx.app", spad + fIconSz * sc + 6 * sc, fY);
  ctx.restore();
  if (rightText) {
    ctx.save();
    ctx.font = `400 ${11 * sc}px ${_F}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillText(rightText, W - spad, fY + sc);
    ctx.restore();
  }
}

// Draw the single-sale banner into an existing 2D context.
// W and H are the physical pixel dimensions (e.g. 1080×1080 for 2× scale).
function _drawSaleBanner(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  sale: Sale, order: MatchedOrder | null,
): void {
  const sc = W / 540;
  const revenue = sale.payout_total ?? sale.sale_total ?? 0;
  const cost = (() => {
    if (!order?.total_cost) return 0;
    if (!order.qty_bought || !sale.qty_sold || order.qty_bought <= 0) return order.total_cost;
    return (order.total_cost / order.qty_bought) * sale.qty_sold;
  })();
  const profit = revenue - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : null;
  const isPos = profit >= 0;
  const profitColor = isPos ? "#4ade80" : "#f87171";

  _bannerBg(ctx, W, H, isPos, sc);

  const spad = 28 * sc, topY = 24 * sc, iconSz = 20;
  const iconCY = topY + (iconSz * sc) / 2;
  _txMark(ctx, spad, topY, iconSz, sc);

  ctx.save();
  ctx.font = `700 ${15 * sc}px ${_F}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  const txStart = spad + iconSz * sc + 8 * sc;
  ctx.fillText("Ticket", txStart, iconCY);
  const tW = ctx.measureText("Ticket").width;
  ctx.fillStyle = "#b87bff";
  ctx.fillText("X", txStart + tW, iconCY);
  ctx.restore();

  _badge(ctx, W - spad, iconCY, "Sale Completed", sc);

  const eventInfoTop = topY + iconSz * sc + 18 * sc;
  ctx.save();
  ctx.font = `700 ${17 * sc}px ${_F}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(_clip(ctx, sale.event_name || "Event", W - spad * 2), spad, eventInfoTop);
  ctx.restore();

  const venueY = eventInfoTop + 17 * sc * 1.2 + 4 * sc;
  ctx.save();
  ctx.font = `400 ${13 * sc}px ${_F}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  let curX = spad;
  if (sale.venue) {
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    const vStr = _clip(ctx, sale.venue, 260 * sc);
    ctx.fillText(vStr, curX, venueY);
    curX += ctx.measureText(vStr).width;
    if (sale.event_date) {
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillText(" · ", curX, venueY);
      curX += ctx.measureText(" · ").width;
    }
  }
  if (sale.event_date) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(formatEventDate(sale.event_date), curX, venueY);
  }
  ctx.restore();

  const divY = venueY + 13 * sc + 16 * sc;
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(spad, divY, W - spad * 2, sc);

  const footerTop = H - (1 + 12 + 14 + 22) * sc;
  const boxH = 86 * sc, boxOutPadB = 20 * sc;
  const boxTop = footerTop - boxOutPadB - boxH;
  const bOL = 24 * sc, bGap = 12 * sc;
  const bW = (W - 2 * bOL - bGap) / 2;

  _statBox(ctx, bOL, boxTop, bW, boxH, "BOUGHT FOR",
    cost > 0 ? formatCurrency(cost) : "—",
    sale.qty_sold ? `${sale.qty_sold} × ticket${sale.qty_sold > 1 ? "s" : ""}` : "—",
    sc, false);
  _statBox(ctx, bOL + bW + bGap, boxTop, bW, boxH, "SOLD FOR",
    revenue > 0 ? formatCurrency(revenue) : "—",
    `via ${formatSource(sale.source)}`,
    sc, true);

  const rightFooter = sale.section
    ? sale.section + (sale.row ? ` · Row ${sale.row}` : "")
    : "";
  _bannerFooter(ctx, W, footerTop, spad, sc, rightFooter);

  _heroSection(ctx, W, divY + sc, boxTop,
    (isPos ? "" : "−") + formatCurrency(Math.abs(profit)),
    roi, isPos, profitColor, sc);
}

// Draw the multi-sale banner into an existing 2D context.
function _drawMultiBanner(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  stats: MultiSaleStats,
): void {
  const { totalRevenue, totalCost, totalProfit, roi, salesCount, totalTickets, eventNames } = stats;
  const sc = W / 540;
  const isPos = totalProfit >= 0;
  const profitColor = isPos ? "#4ade80" : "#f87171";

  _bannerBg(ctx, W, H, isPos, sc);

  const spad = 28 * sc, topY = 24 * sc, iconSz = 20;
  const iconCY = topY + (iconSz * sc) / 2;
  _txMark(ctx, spad, topY, iconSz, sc);

  ctx.save();
  ctx.font = `700 ${15 * sc}px ${_F}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  const txStart = spad + iconSz * sc + 8 * sc;
  ctx.fillText("Ticket", txStart, iconCY);
  const tW = ctx.measureText("Ticket").width;
  ctx.fillStyle = "#b87bff";
  ctx.fillText("X", txStart + tW, iconCY);
  ctx.restore();

  _badge(ctx, W - spad, iconCY, `${salesCount} Sales Completed`, sc);

  const eventInfoTop = topY + iconSz * sc + 18 * sc;
  let eventInfoBottom = eventInfoTop;

  if (eventNames.length === 1) {
    ctx.save();
    ctx.font = `700 ${17 * sc}px ${_F}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(_clip(ctx, eventNames[0], W - spad * 2), spad, eventInfoTop);
    ctx.restore();
    eventInfoBottom = eventInfoTop + 17 * sc * 1.2;
  } else {
    const nfs = eventNames.length === 2 ? 15 : 13;
    const lh = nfs * sc * 1.3;
    let ny = eventInfoTop;
    for (const name of eventNames.slice(0, 3)) {
      ctx.save();
      ctx.font = `700 ${nfs * sc}px ${_F}`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(_clip(ctx, name, W - spad * 2), spad, ny);
      ctx.restore();
      ny += lh;
    }
    if (eventNames.length > 3) {
      ctx.save();
      ctx.font = `400 ${12 * sc}px ${_F}`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillText(`+${eventNames.length - 3} more`, spad, ny);
      ctx.restore();
      ny += 12 * sc * 1.3;
    }
    eventInfoBottom = ny;
  }

  const subLineY = eventInfoBottom + 5 * sc;
  ctx.save();
  ctx.font = `400 ${12 * sc}px ${_F}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillText(
    `${totalTickets} ticket${totalTickets !== 1 ? "s" : ""} · ${salesCount} sale${salesCount !== 1 ? "s" : ""}`,
    spad, subLineY,
  );
  ctx.restore();

  const divY = subLineY + 12 * sc + 16 * sc;
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(spad, divY, W - spad * 2, sc);

  const footerTop = H - (1 + 12 + 14 + 22) * sc;
  const boxH = 86 * sc, boxOutPadB = 20 * sc;
  const boxTop = footerTop - boxOutPadB - boxH;
  const bOL = 24 * sc, bGap = 12 * sc;
  const bW = (W - 2 * bOL - bGap) / 2;

  _statBox(ctx, bOL, boxTop, bW, boxH, "TOTAL COST",
    totalCost > 0 ? formatCurrency(totalCost) : "—",
    `${totalTickets} ticket${totalTickets !== 1 ? "s" : ""}`,
    sc, false);
  _statBox(ctx, bOL + bW + bGap, boxTop, bW, boxH, "TOTAL REVENUE",
    totalRevenue > 0 ? formatCurrency(totalRevenue) : "—",
    `${salesCount} sale${salesCount !== 1 ? "s" : ""}`,
    sc, true);

  _bannerFooter(ctx, W, footerTop, spad, sc, `${salesCount} combined sales`);

  _heroSection(ctx, W, divY + sc, boxTop,
    (isPos ? "" : "−") + formatCurrency(Math.abs(totalProfit)),
    roi, isPos, profitColor, sc);
}

// Render banner to JPEG blob.
// Three-path strategy to avoid Chrome's GPU compositor createPattern crash:
//
// Path 1 — OffscreenCanvas.convertToBlob(): off-main-thread, most isolated.
// Path 2 — getImageData → createImageBitmap(ImageData) → fresh CPU canvas → toBlob:
//   getImageData on a willReadFrequently canvas reads from CPU memory (no GPU readback).
//   createImageBitmap(ImageData) creates a bitmap from CPU memory, not a GPU canvas.
//   The fresh canvas with willReadFrequently stays on CPU, so toBlob never hits the
//   internal GPU createPattern path that Chrome bugs on.
// Path 3 — direct toBlob on willReadFrequently canvas (simple last resort).
async function renderBannerToBlob(
  drawFn: (ctx: CanvasRenderingContext2D, W: number, H: number) => void,
): Promise<Blob> {
  const W = 1080, H = 1080;

  // Path 1: OffscreenCanvas
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const oc = new OffscreenCanvas(W, H);
      const ctx = oc.getContext("2d") as CanvasRenderingContext2D | null;
      if (ctx) {
        drawFn(ctx, W, H);
        return await oc.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      }
    } catch { /* fall through */ }
  }

  // Path 2: draw → getImageData → createImageBitmap → fresh canvas → toBlob
  // This breaks the GPU path entirely: pixels go CPU → ImageBitmap → CPU canvas → blob.
  try {
    const drawCanvas = document.createElement("canvas");
    drawCanvas.width = W;
    drawCanvas.height = H;
    const drawCtx = drawCanvas.getContext("2d", { willReadFrequently: true });
    if (!drawCtx) throw new Error("no ctx");
    drawFn(drawCtx, W, H);
    const imageData = drawCtx.getImageData(0, 0, W, H);
    const bitmap = await createImageBitmap(imageData);
    const encCanvas = document.createElement("canvas");
    encCanvas.width = W;
    encCanvas.height = H;
    const encCtx = encCanvas.getContext("2d", { willReadFrequently: true });
    if (!encCtx) throw new Error("no enc ctx");
    encCtx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await new Promise<Blob>((res, rej) =>
      encCanvas.toBlob(b => b ? res(b) : rej(new Error("toBlob null")), "image/jpeg", 0.92)
    );
  } catch { /* fall through */ }

  // Path 3: direct toBlob on willReadFrequently canvas
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  drawFn(ctx, W, H);
  return new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob returned null")), "image/jpeg", 0.92)
  );
}

function _downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ─────────────────────────────────────────────────────────────────────────────

type MultiShareProps = {
  stats: MultiSaleStats;
  onClose: () => void;
};

export function ShareMultiBannerModal({ stats, onClose }: MultiShareProps) {
  const [visible, setVisible] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [bannerBlob, setBannerBlob] = useState<Blob | null>(null);
  const [genError, setGenError] = useState("");

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 16);
    const t2 = setTimeout(() => setShowConfetti(true), 200);
    const t3 = setTimeout(() => setShowConfetti(false), 1400);
    renderBannerToBlob((ctx, W, H) => _drawMultiBanner(ctx, W, H, stats))
      .then(blob => setBannerBlob(blob))
      .catch(err => setGenError(err instanceof Error ? err.message : String(err)));
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Non-async: blob is pre-generated, so clipboard.write() is called immediately
  // within the user-gesture context with no async work in between.
  function handleCopy() {
    if (!bannerBlob) return;
    const blob = bannerBlob;
    setCopying(true);
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      void navigator.clipboard.write([new ClipboardItem({ "image/jpeg": blob })])
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        })
        .catch(() => {
          _downloadBlob(blob, "sales-summary-ticketx.jpg");
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        })
        .finally(() => setCopying(false));
    } else {
      _downloadBlob(blob, "sales-summary-ticketx.jpg");
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      setCopying(false);
    }
  }

  function handleDownload() {
    if (!bannerBlob) return;
    _downloadBlob(bannerBlob, "sales-summary-ticketx.jpg");
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return createPortal(
    <div onClick={handleOverlayClick} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, opacity: visible ? 1 : 0, transition: "opacity 250ms ease" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, transform: visible ? "scale(1) translateY(0)" : "scale(0.92) translateY(16px)", transition: "transform 300ms cubic-bezier(0.16,1,0.3,1), opacity 300ms ease", opacity: visible ? 1 : 0, position: "relative", maxHeight: "100vh", overflowY: "auto" }}>
        {showConfetti && <Confetti />}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em", color: "rgba(255,255,255,0.95)" }}>Share your wins</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Copy the banner and paste it anywhere</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.55)", fontSize: 18, lineHeight: "1" }}>×</button>
        </div>

        <div style={{ borderRadius: 20, overflow: "hidden", boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 80px rgba(0,0,0,0.7), 0 0 60px rgba(155,92,255,0.12)", flexShrink: 0 }}>
          <div>
            <MultiSaleBanner stats={stats} animated={visible} />
          </div>
        </div>

        {genError && (
          <div style={{ width: "100%", padding: "10px 14px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, fontSize: 12, color: "#fca5a5", lineHeight: 1.4 }}>
            {genError}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!bannerBlob || copying}
            style={{
              flex: 1, padding: "14px 0",
              background: copied ? "rgba(74,222,128,0.15)" : !bannerBlob ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg, rgba(155,92,255,0.25), rgba(255,79,163,0.25))",
              border: copied ? "1px solid rgba(74,222,128,0.4)" : "1px solid rgba(255,79,163,0.3)",
              borderRadius: 14, cursor: (!bannerBlob || copying) ? "wait" : "pointer",
              color: copied ? "#4ade80" : "rgba(255,255,255,0.9)",
              fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", transition: "all 200ms ease",
            }}
          >
            {!bannerBlob && !genError ? "Generating…" : copied ? "✓ Copied!" : copying ? "Copying…" : "Copy to Clipboard"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!bannerBlob}
            style={{ padding: "14px 20px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, cursor: !bannerBlob ? "wait" : "pointer", color: "rgba(255,255,255,0.55)", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}
          >
            Download
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Share Modal ──────────────────────────────────────────────────────────────

type Props = {
  sale: Sale;
  order: MatchedOrder | null;
  onClose: () => void;
};

export default function ShareBannerModal({ sale, order, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [bannerBlob, setBannerBlob] = useState<Blob | null>(null);
  const [genError, setGenError] = useState("");

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 16);
    const t2 = setTimeout(() => setShowConfetti(true), 200);
    const t3 = setTimeout(() => setShowConfetti(false), 1400);
    renderBannerToBlob((ctx, W, H) => _drawSaleBanner(ctx, W, H, sale, order))
      .then(blob => setBannerBlob(blob))
      .catch(err => setGenError(err instanceof Error ? err.message : String(err)));
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Non-async: blob is pre-generated, so clipboard.write() is called immediately
  // within the user-gesture context with no async work in between.
  function handleCopy() {
    if (!bannerBlob) return;
    const blob = bannerBlob;
    const filename = `${sale.event_name ?? "sale"}-ticketx.jpg`;
    setCopying(true);
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      void navigator.clipboard.write([new ClipboardItem({ "image/jpeg": blob })])
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        })
        .catch(() => {
          _downloadBlob(blob, filename);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        })
        .finally(() => setCopying(false));
    } else {
      _downloadBlob(blob, filename);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      setCopying(false);
    }
  }

  function handleDownload() {
    if (!bannerBlob) return;
    _downloadBlob(bannerBlob, `${sale.event_name ?? "sale"}-ticketx.jpg`);
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
        {showConfetti && <Confetti />}

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

        <div style={{
          borderRadius: 20, overflow: "hidden",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 80px rgba(0,0,0,0.7), 0 0 60px rgba(155,92,255,0.12)",
          flexShrink: 0,
        }}>
          <div>
            <SaleBanner sale={sale} order={order} animated={visible} />
          </div>
        </div>

        {genError && (
          <div style={{ width: "100%", padding: "10px 14px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, fontSize: 12, color: "#fca5a5", lineHeight: 1.4 }}>
            {genError}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!bannerBlob || copying}
            style={{
              flex: 1, padding: "14px 0",
              background: copied
                ? "rgba(74,222,128,0.15)"
                : !bannerBlob
                ? "rgba(255,255,255,0.04)"
                : "linear-gradient(135deg, rgba(155,92,255,0.25), rgba(255,79,163,0.25))",
              border: copied
                ? "1px solid rgba(74,222,128,0.4)"
                : "1px solid rgba(255,79,163,0.3)",
              borderRadius: 14, cursor: (!bannerBlob || copying) ? "wait" : "pointer",
              color: copied ? "#4ade80" : "rgba(255,255,255,0.9)",
              fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em",
              transition: "all 200ms ease",
              boxShadow: copied ? "0 0 20px rgba(74,222,128,0.2)" : "0 0 20px rgba(255,79,163,0.1)",
            }}
          >
            {!bannerBlob && !genError ? "Generating…" : copied ? "✓ Copied!" : copying ? "Copying…" : "Copy to Clipboard"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!bannerBlob}
            style={{
              padding: "14px 20px",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14, cursor: !bannerBlob ? "wait" : "pointer",
              color: "rgba(255,255,255,0.55)",
              fontSize: 14, fontWeight: 600,
              transition: "all 150ms ease",
              whiteSpace: "nowrap",
            }}
          >
            Download
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
