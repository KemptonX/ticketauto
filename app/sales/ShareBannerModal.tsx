"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency } from "@/src/lib/currency";

// ─── Types ────────────────────────────────────────────────────────────────────

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
      setVal(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, running, duration]);
  return val;
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ["#ff4fa3","#9b5cff","#4fc3ff","#ffd700","#ff6b6b","#a8edca"];

function Confetti() {
  const particles = useMemo(() =>
    Array.from({ length: 28 }, (_, i) => {
      const angle = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist  = 80 + Math.random() * 120;
      return {
        id: i,
        x: Math.cos(angle) * dist, y: Math.sin(angle) * dist - 30,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 5 + Math.random() * 5,
        delay: Math.random() * 200,
        shape: i % 4 === 0 ? "square" : "circle",
      };
    }), []);

  return (
    <div style={{ position:"absolute", top:"50%", left:"50%", pointerEvents:"none", zIndex:10 }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position:"absolute", width:p.size, height:p.size,
          background:p.color, borderRadius: p.shape==="circle" ? "50%" : "2px",
          transform:"translate(-50%,-50%)",
          animation:`tx-confetti-fly 1s ease-out ${p.delay}ms both`,
          ["--tx" as string]:`${p.x}px`, ["--ty" as string]:`${p.y}px`,
          boxShadow:`0 0 6px ${p.color}`,
        }} />
      ))}
    </div>
  );
}

// ─── ScaledPreview ────────────────────────────────────────────────────────────

function ScaledPreview({ children, w = 520, h = 300 }: { children: React.ReactNode; w?: number; h?: number }) {
  const ref   = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const cw = el.offsetWidth;
      if (cw > 0) setScale(Math.min(1, cw / w));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [w]);

  return (
    <div ref={ref} style={{ width:"100%", height:Math.round(h * scale), position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, width:w, height:h, transform:`scale(${scale})`, transformOrigin:"top left" }}>
        {children}
      </div>
    </div>
  );
}

// ─── Shared banner shell (520 × 300) ─────────────────────────────────────────

function BannerShell({ isPos, children }: { isPos: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      width:520, height:300,
      background:"linear-gradient(145deg, #0e0e1c 0%, #09090e 58%, #0e0b17 100%)",
      position:"relative", overflow:"hidden",
      fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display:"flex", flexDirection:"column",
    }}>
      {/* Ambient glows */}
      <div style={{ position:"absolute", top:-80, left:-80, width:260, height:260, background:"radial-gradient(circle, rgba(155,92,255,0.12) 0%, transparent 70%)", pointerEvents:"none" }} />
      <div style={{ position:"absolute", bottom:-50, right:30, width:200, height:200, background:"radial-gradient(circle, rgba(255,79,163,0.08) 0%, transparent 70%)", pointerEvents:"none" }} />
      <div style={{ position:"absolute", inset:0, background:`radial-gradient(ellipse at 50% 58%, ${isPos?"rgba(74,222,128,0.045)":"rgba(248,113,113,0.045)"} 0%, transparent 55%)`, pointerEvents:"none" }} />
      {/* Watermark — large X partially off right edge */}
      <div style={{ position:"absolute", right:-55, top:"50%", transform:"translateY(-50%)", opacity:0.018, pointerEvents:"none", lineHeight:0 }}>
        <svg width="210" height="210" viewBox="0 0 24 24" fill="none">
          <path d="M3 3L21 21" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M21 3L3 21" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
      {children}
    </div>
  );
}

// ─── Stat box ─────────────────────────────────────────────────────────────────

function StatBox({ label, value, sub, pink }: { label: string; value: string; sub: string; pink?: boolean }) {
  return (
    <div style={{
      flex:1,
      background: pink ? "rgba(255,79,163,0.05)" : "rgba(255,255,255,0.04)",
      border: `1px solid ${pink ? "rgba(255,79,163,0.10)" : "rgba(255,255,255,0.07)"}`,
      borderRadius:10, padding:"9px 12px",
    }}>
      <div style={{ fontSize:7.5, fontWeight:700, letterSpacing:"0.10em", textTransform:"uppercase", color: pink ? "rgba(255,79,163,0.45)" : "rgba(255,255,255,0.22)", marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:16, fontWeight:700, letterSpacing:"-0.03em", color:"rgba(255,255,255,0.90)" }}>{value}</div>
      <div style={{ fontSize:9.5, color:"rgba(255,255,255,0.26)", marginTop:2 }}>{sub}</div>
    </div>
  );
}

// ─── Sale banner ──────────────────────────────────────────────────────────────

type BannerProps = { sale: Sale; order: MatchedOrder | null; animated: boolean; hideDetails?: boolean };

export function SaleBanner({ sale, order, animated, hideDetails = false }: BannerProps) {
  const s = hideDetails
    ? { ...sale, event_name:"••••••••••••", venue:"••••••••", event_date:null, section:null, row:null }
    : sale;

  const revenue = s.payout_total ?? s.sale_total ?? 0;
  const cost = (() => {
    if (!order?.total_cost) return 0;
    if (!order.qty_bought || !s.qty_sold || order.qty_bought <= 0) return order.total_cost;
    return (order.total_cost / order.qty_bought) * s.qty_sold;
  })();
  const profit = revenue - cost;
  const roi    = cost > 0 ? (profit / cost) * 100 : null;
  const isPos  = profit >= 0;

  const animProfit = useCountUp(profit, animated);
  const animRoi    = useCountUp(roi ?? 0, animated && roi !== null);
  const dProfit    = animated ? animProfit : profit;
  const dRoi       = animated ? animRoi    : (roi ?? 0);

  const pc   = isPos ? "#4ade80" : "#f87171";
  const glow = isPos
    ? "0 0 20px rgba(74,222,128,0.32), 0 0 40px rgba(74,222,128,0.10)"
    : "0 0 20px rgba(248,113,113,0.32), 0 0 40px rgba(248,113,113,0.10)";

  return (
    <BannerShell isPos={isPos}>
      {/* Top bar */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 20px 0", flexShrink:0 }}>
        <img src="/logo.png" style={{ height:24, width:"auto" }} alt="TixTracker" />
        <div style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(74,222,128,0.10)", border:"1px solid rgba(74,222,128,0.22)", borderRadius:999, padding:"3px 9px", flexShrink:0 }}>
          <div style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 5px #4ade80", flexShrink:0 }} />
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.10em", textTransform:"uppercase", color:"#4ade80", whiteSpace:"nowrap" }}>Sale Completed</span>
        </div>
      </div>

      {/* Event info */}
      <div style={{ padding:"8px 20px 0", flexShrink:0 }}>
        <div style={{ fontSize:13, fontWeight:700, letterSpacing:"-0.02em", color:"rgba(255,255,255,0.92)", lineHeight:"1.15", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {s.event_name || "Event"}
        </div>
        <div style={{ marginTop:3, display:"flex", alignItems:"center", gap:4, overflow:"hidden" }}>
          {s.venue && <span style={{ fontSize:10.5, color:"rgba(255,255,255,0.34)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:200, flexShrink:1 }}>{s.venue}</span>}
          {s.venue && s.event_date && <span style={{ fontSize:9, color:"rgba(255,255,255,0.16)", flexShrink:0 }}>·</span>}
          {s.event_date && <span style={{ fontSize:10.5, color:"rgba(255,255,255,0.26)", whiteSpace:"nowrap", flexShrink:0 }}>{formatEventDate(s.event_date)}</span>}
        </div>
      </div>

      {/* Divider */}
      <div style={{ margin:"9px 20px 0", height:1, background:"linear-gradient(90deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 70%, transparent 100%)", flexShrink:0 }} />

      {/* Hero */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 20px" }}>
        <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(255,255,255,0.22)", marginBottom:5 }}>Total Profit</div>
        <div style={{ fontSize:40, fontWeight:800, letterSpacing:"-0.04em", color:pc, textShadow:glow, lineHeight:1, fontVariantNumeric:"tabular-nums" }}>
          {isPos ? "" : "−"}{formatCurrency(Math.abs(dProfit))}
        </div>
        {roi !== null && (
          <div style={{ marginTop:7, display:"flex", alignItems:"center", gap:5, background:isPos?"rgba(74,222,128,0.09)":"rgba(248,113,113,0.09)", border:`1px solid ${isPos?"rgba(74,222,128,0.18)":"rgba(248,113,113,0.18)"}`, borderRadius:999, padding:"3px 11px" }}>
            <span style={{ fontSize:13, fontWeight:800, letterSpacing:"-0.02em", color:pc, fontVariantNumeric:"tabular-nums" }}>
              {isPos ? "+" : "−"}{Math.abs(dRoi).toFixed(1)}%
            </span>
            <span style={{ fontSize:8, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:pc, opacity:0.6 }}>ROI</span>
          </div>
        )}
      </div>

      {/* Stat boxes */}
      <div style={{ padding:"0 16px 10px", display:"flex", gap:8, flexShrink:0 }}>
        <StatBox label="Bought For" value={cost > 0 ? formatCurrency(cost) : "—"} sub={s.qty_sold ? `${s.qty_sold} × ticket${s.qty_sold > 1?"s":""}` : "—"} />
        <StatBox label="Sold For" value={revenue > 0 ? formatCurrency(revenue) : "—"} sub={`via ${formatSource(s.source)}`} pink />
      </div>

      {/* Footer */}
      <div style={{ flexShrink:0, height:36, padding:"0 20px", borderTop:"1px solid rgba(255,255,255,0.06)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <img src="/logo.png" style={{ height:14, width:"auto" }} alt="" />
          <span style={{ fontSize:9.5, fontWeight:600, letterSpacing:"0.04em", color:"rgba(255,255,255,0.18)" }}>www.tixtracker.app</span>
        </div>
        {s.section && <span style={{ fontSize:9, color:"rgba(255,255,255,0.16)", letterSpacing:"0.02em" }}>{s.section}{s.row ? ` · Row ${s.row}` : ""}</span>}
      </div>
    </BannerShell>
  );
}

// ─── Multi-sale banner ────────────────────────────────────────────────────────

export type MultiSaleStats = {
  salesCount: number; totalTickets: number; totalRevenue: number;
  totalCost: number; totalProfit: number; roi: number | null; eventNames: string[];
};

export function MultiSaleBanner({ stats, animated }: { stats: MultiSaleStats; animated: boolean }) {
  const { totalRevenue, totalCost, totalProfit, roi, salesCount, totalTickets, eventNames } = stats;
  const isPos = totalProfit >= 0;

  const animProfit = useCountUp(totalProfit, animated);
  const animRoi    = useCountUp(roi ?? 0, animated && roi !== null);
  const dProfit    = animated ? animProfit : totalProfit;
  const dRoi       = animated ? animRoi    : (roi ?? 0);

  const pc   = isPos ? "#4ade80" : "#f87171";
  const glow = isPos
    ? "0 0 20px rgba(74,222,128,0.32), 0 0 40px rgba(74,222,128,0.10)"
    : "0 0 20px rgba(248,113,113,0.32), 0 0 40px rgba(248,113,113,0.10)";

  return (
    <BannerShell isPos={isPos}>
      {/* Top bar */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 20px 0", flexShrink:0 }}>
        <img src="/logo.png" style={{ height:24, width:"auto" }} alt="TixTracker" />
        <div style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(74,222,128,0.10)", border:"1px solid rgba(74,222,128,0.22)", borderRadius:999, padding:"3px 9px", flexShrink:0 }}>
          <div style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 5px #4ade80", flexShrink:0 }} />
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.10em", textTransform:"uppercase", color:"#4ade80", whiteSpace:"nowrap" }}>{salesCount} Sales Completed</span>
        </div>
      </div>

      {/* Event names */}
      <div style={{ padding:"8px 20px 0", flexShrink:0 }}>
        {eventNames.length === 1 ? (
          <div style={{ fontSize:13, fontWeight:700, letterSpacing:"-0.02em", color:"rgba(255,255,255,0.92)", lineHeight:"1.15", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{eventNames[0]}</div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
            {eventNames.slice(0, 2).map((n, i) => (
              <div key={i} style={{ fontSize:12, fontWeight:700, letterSpacing:"-0.02em", color:"rgba(255,255,255,0.88)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{n}</div>
            ))}
            {eventNames.length > 2 && <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", marginTop:1 }}>+{eventNames.length - 2} more</div>}
          </div>
        )}
        <div style={{ marginTop:3, fontSize:10.5, color:"rgba(255,255,255,0.28)" }}>
          {totalTickets} ticket{totalTickets !== 1 ? "s" : ""} · {salesCount} sale{salesCount !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Divider */}
      <div style={{ margin:"9px 20px 0", height:1, background:"linear-gradient(90deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 70%, transparent 100%)", flexShrink:0 }} />

      {/* Hero */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 20px" }}>
        <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(255,255,255,0.22)", marginBottom:5 }}>Total Profit</div>
        <div style={{ fontSize:40, fontWeight:800, letterSpacing:"-0.04em", color:pc, textShadow:glow, lineHeight:1, fontVariantNumeric:"tabular-nums" }}>
          {isPos ? "" : "−"}{formatCurrency(Math.abs(dProfit))}
        </div>
        {roi !== null && (
          <div style={{ marginTop:7, display:"flex", alignItems:"center", gap:5, background:isPos?"rgba(74,222,128,0.09)":"rgba(248,113,113,0.09)", border:`1px solid ${isPos?"rgba(74,222,128,0.18)":"rgba(248,113,113,0.18)"}`, borderRadius:999, padding:"3px 11px" }}>
            <span style={{ fontSize:13, fontWeight:800, letterSpacing:"-0.02em", color:pc, fontVariantNumeric:"tabular-nums" }}>
              {isPos ? "+" : "−"}{Math.abs(dRoi).toFixed(1)}%
            </span>
            <span style={{ fontSize:8, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:pc, opacity:0.6 }}>ROI</span>
          </div>
        )}
      </div>

      {/* Stat boxes */}
      <div style={{ padding:"0 16px 10px", display:"flex", gap:8, flexShrink:0 }}>
        <StatBox label="Total Cost" value={totalCost > 0 ? formatCurrency(totalCost) : "—"} sub={`${totalTickets} ticket${totalTickets !== 1?"s":""}`} />
        <StatBox label="Total Revenue" value={totalRevenue > 0 ? formatCurrency(totalRevenue) : "—"} sub={`${salesCount} sale${salesCount !== 1?"s":""}`} pink />
      </div>

      {/* Footer */}
      <div style={{ flexShrink:0, height:36, padding:"0 20px", borderTop:"1px solid rgba(255,255,255,0.06)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <img src="/logo.png" style={{ height:14, width:"auto" }} alt="" />
          <span style={{ fontSize:9.5, fontWeight:600, letterSpacing:"0.04em", color:"rgba(255,255,255,0.18)" }}>www.tixtracker.app</span>
        </div>
        <span style={{ fontSize:9, color:"rgba(255,255,255,0.16)" }}>{salesCount} combined sales</span>
      </div>
    </BannerShell>
  );
}

// ─── Canvas utilities ─────────────────────────────────────────────────────────

function _rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

const _F = '"Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif';

function _clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

function _badge(ctx: CanvasRenderingContext2D, rightX: number, cy: number, text: string, sc: number) {
  const fontSize = 9 * sc;
  ctx.save();
  ctx.font = `700 ${fontSize}px ${_F}`;
  const textW   = ctx.measureText(text).width;
  const dotR    = 2.5 * sc, gap = 5 * sc, ph = 3 * sc, pw = 9 * sc;
  const pillW   = pw + dotR * 2 + gap + textW + pw;
  const pillH   = fontSize + ph * 2;
  const px      = rightX - pillW, py = cy - pillH / 2;
  _rr(ctx, px, py, pillW, pillH, pillH / 2);
  ctx.fillStyle = "rgba(74,222,128,0.10)"; ctx.fill();
  ctx.strokeStyle = "rgba(74,222,128,0.22)"; ctx.lineWidth = sc; ctx.stroke();
  ctx.fillStyle = "#4ade80";
  ctx.beginPath(); ctx.arc(px + pw + dotR, cy, dotR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4ade80"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(text, px + pw + dotR * 2 + gap, cy);
  ctx.restore();
}

function _statBoxC(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string, value: string, sub: string,
  sc: number, pink: boolean,
) {
  ctx.save();
  _rr(ctx, x, y, w, h, 10 * sc);
  ctx.fillStyle = pink ? "rgba(255,79,163,0.05)" : "rgba(255,255,255,0.04)"; ctx.fill();
  ctx.strokeStyle = pink ? "rgba(255,79,163,0.10)" : "rgba(255,255,255,0.07)";
  ctx.lineWidth = sc; ctx.stroke();
  ctx.restore();
  const ix = x + 12 * sc;
  let iy = y + 9 * sc;
  ctx.save();
  ctx.font = `700 ${7.5 * sc}px ${_F}`; ctx.fillStyle = pink ? "rgba(255,79,163,0.45)" : "rgba(255,255,255,0.22)";
  ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(label, ix, iy); iy += (7.5 + 4) * sc;
  ctx.restore();
  ctx.save();
  ctx.font = `700 ${16 * sc}px ${_F}`; ctx.fillStyle = "rgba(255,255,255,0.90)";
  ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(value, ix, iy); iy += (16 + 2) * sc;
  ctx.restore();
  ctx.save();
  ctx.font = `400 ${9.5 * sc}px ${_F}`; ctx.fillStyle = "rgba(255,255,255,0.26)";
  ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(sub, ix, iy);
  ctx.restore();
}

function _bannerBg(ctx: CanvasRenderingContext2D, W: number, H: number, isPos: boolean, sc: number) {
  ctx.fillStyle = "#0e0e1c"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(155,92,255,0.07)"; ctx.fillRect(0, 0, W * 0.45, H * 0.55);
  ctx.fillStyle = "rgba(255,79,163,0.05)"; ctx.fillRect(W * 0.55, H * 0.45, W * 0.45, H * 0.55);
  ctx.fillStyle = isPos ? "rgba(74,222,128,0.035)" : "rgba(248,113,113,0.035)";
  ctx.fillRect(W * 0.15, H * 0.2, W * 0.7, H * 0.5);
  // Watermark: 210px CSS, partially off right edge (right: -55)
  const wmS = 210 * sc;
  const wmX = W - 155 * sc;   // left edge = W - (210-55)*sc
  const wmY = H / 2 - wmS / 2;
  const wr  = wmS / 24;
  ctx.save();
  ctx.globalAlpha = 0.018; ctx.lineCap = "round"; ctx.lineWidth = 2.5 * wr; ctx.strokeStyle = "white";
  ctx.beginPath(); ctx.moveTo(wmX + 3*wr, wmY + 3*wr); ctx.lineTo(wmX + 21*wr, wmY + 21*wr); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(wmX + 21*wr, wmY + 3*wr); ctx.lineTo(wmX + 3*wr, wmY + 21*wr); ctx.stroke();
  ctx.restore();
}

function _heroSection(
  ctx: CanvasRenderingContext2D,
  W: number, heroTop: number, heroBot: number,
  profitStr: string, roi: number | null, isPos: boolean,
  pc: string, sc: number,
) {
  const heroCY  = (heroTop + heroBot) / 2;
  const bigSz   = 40 * sc, labelSz = 8 * sc;
  const pillH   = roi !== null ? (3 * 2 + 13) * sc : 0;
  const gap1    = 5 * sc, gap2 = 7 * sc;
  const contentH = labelSz + gap1 + bigSz + (roi !== null ? gap2 + pillH : 0);
  const top     = heroCY - contentH / 2;

  ctx.save();
  ctx.font = `700 ${labelSz}px ${_F}`; ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillText("TOTAL PROFIT", W / 2, top);
  ctx.restore();

  const numTop = top + labelSz + gap1;
  ctx.save();
  ctx.font = `800 ${bigSz}px ${_F}`; ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillStyle = pc; ctx.fillText(profitStr, W / 2, numTop);
  ctx.restore();

  if (roi !== null) {
    const roiTop  = numTop + bigSz + gap2;
    const roiStr  = (isPos ? "+" : "−") + Math.abs(roi).toFixed(1) + "%";
    const roiLbl  = "ROI";
    const ph = 3 * sc, pw = 11 * sc, gap = 5 * sc;
    ctx.save();
    ctx.font = `800 ${13 * sc}px ${_F}`; const rnW = ctx.measureText(roiStr).width;
    ctx.font = `700 ${8 * sc}px ${_F}`;  const rlW = ctx.measureText(roiLbl).width;
    ctx.restore();
    const pillW = pw + rnW + gap + rlW + pw;
    const pX = W / 2 - pillW / 2;
    ctx.save();
    _rr(ctx, pX, roiTop, pillW, pillH, pillH / 2);
    ctx.fillStyle = isPos ? "rgba(74,222,128,0.09)" : "rgba(248,113,113,0.09)"; ctx.fill();
    ctx.strokeStyle = isPos ? "rgba(74,222,128,0.18)" : "rgba(248,113,113,0.18)";
    ctx.lineWidth = sc; ctx.stroke();
    ctx.restore();
    const pCY = roiTop + pillH / 2;
    ctx.save();
    ctx.font = `800 ${13 * sc}px ${_F}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = pc; ctx.fillText(roiStr, pX + pw, pCY);
    ctx.restore();
    ctx.save();
    ctx.font = `700 ${8 * sc}px ${_F}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = pc; ctx.globalAlpha = 0.6;
    ctx.fillText(roiLbl, pX + pw + rnW + gap, pCY);
    ctx.restore();
  }
}

function _bannerFooter(
  ctx: CanvasRenderingContext2D,
  W: number, footerTop: number, spad: number, sc: number,
  rightText: string, logo: HTMLImageElement | null,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = sc;
  ctx.beginPath(); ctx.moveTo(0, footerTop); ctx.lineTo(W, footerTop); ctx.stroke();
  ctx.restore();
  const fCY = footerTop + 36 * sc / 2;
  const logoH = 14 * sc;
  let textX = spad;
  if (logo) {
    const logoW = logo.naturalWidth * (logoH / logo.naturalHeight);
    ctx.drawImage(logo, spad, fCY - logoH / 2, logoW, logoH);
    textX = spad + logoW + 5 * sc;
  }
  ctx.save();
  ctx.font = `600 ${9.5 * sc}px ${_F}`; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillText("www.tixtracker.app", textX, fCY);
  ctx.restore();
  if (rightText) {
    ctx.save();
    ctx.font = `400 ${9 * sc}px ${_F}`; ctx.textBaseline = "middle"; ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillText(rightText, W - spad, fCY);
    ctx.restore();
  }
}

function _loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ─── Canvas: single-sale banner (1080 × 623) ─────────────────────────────────

function _drawSaleBanner(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  sale: Sale, order: MatchedOrder | null, logo: HTMLImageElement | null,
) {
  const sc = W / 520;
  const revenue = sale.payout_total ?? sale.sale_total ?? 0;
  const cost = (() => {
    if (!order?.total_cost) return 0;
    if (!order.qty_bought || !sale.qty_sold || order.qty_bought <= 0) return order.total_cost;
    return (order.total_cost / order.qty_bought) * sale.qty_sold;
  })();
  const profit = revenue - cost;
  const roi    = cost > 0 ? (profit / cost) * 100 : null;
  const isPos  = profit >= 0;
  const pc     = isPos ? "#4ade80" : "#f87171";

  _bannerBg(ctx, W, H, isPos, sc);

  const spad = 20 * sc, topY = 14 * sc, logoH = 24 * sc, logoCY = topY + logoH / 2;

  if (logo) {
    const logoW = logo.naturalWidth * (logoH / logo.naturalHeight);
    ctx.drawImage(logo, spad, topY, logoW, logoH);
  }
  _badge(ctx, W - spad, logoCY, "Sale Completed", sc);

  const eventY = topY + logoH + 8 * sc;
  ctx.save();
  ctx.font = `700 ${13 * sc}px ${_F}`; ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText(_clip(ctx, sale.event_name || "Event", W - spad * 2), spad, eventY);
  ctx.restore();

  const venueY = eventY + 13 * sc * 1.15 + 3 * sc;
  ctx.save();
  ctx.font = `400 ${10.5 * sc}px ${_F}`; ctx.textBaseline = "top"; ctx.textAlign = "left";
  let cx = spad;
  if (sale.venue) {
    ctx.fillStyle = "rgba(255,255,255,0.34)";
    const vs = _clip(ctx, sale.venue, 200 * sc);
    ctx.fillText(vs, cx, venueY); cx += ctx.measureText(vs).width;
    if (sale.event_date) { ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillText(" · ", cx, venueY); cx += ctx.measureText(" · ").width; }
  }
  if (sale.event_date) { ctx.fillStyle = "rgba(255,255,255,0.26)"; ctx.fillText(formatEventDate(sale.event_date), cx, venueY); }
  ctx.restore();

  const divY = venueY + 10.5 * sc * 1.15 + 9 * sc;
  ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fillRect(spad, divY, W - spad * 2, sc);

  const footerH = 36 * sc, footerTop = H - footerH;
  const boxH = 58 * sc, boxGap = 8 * sc, boxPadB = 10 * sc;
  const boxTop = footerTop - boxPadB - boxH;
  const bOL = 16 * sc, bW = (W - 2 * bOL - boxGap) / 2;

  _statBoxC(ctx, bOL, boxTop, bW, boxH, "BOUGHT FOR",
    cost > 0 ? formatCurrency(cost) : "—",
    sale.qty_sold ? `${sale.qty_sold} × ticket${sale.qty_sold > 1?"s":""}` : "—",
    sc, false);
  _statBoxC(ctx, bOL + bW + boxGap, boxTop, bW, boxH, "SOLD FOR",
    revenue > 0 ? formatCurrency(revenue) : "—",
    `via ${formatSource(sale.source)}`, sc, true);

  const footerRight = sale.section ? sale.section + (sale.row ? ` · Row ${sale.row}` : "") : "";
  _bannerFooter(ctx, W, footerTop, spad, sc, footerRight, logo);
  _heroSection(ctx, W, divY + sc, boxTop, (isPos?"":"−") + formatCurrency(Math.abs(profit)), roi, isPos, pc, sc);
}

// ─── Canvas: multi-sale banner ────────────────────────────────────────────────

function _drawMultiBanner(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  stats: MultiSaleStats, logo: HTMLImageElement | null,
) {
  const { totalRevenue, totalCost, totalProfit, roi, salesCount, totalTickets, eventNames } = stats;
  const sc    = W / 520;
  const isPos = totalProfit >= 0;
  const pc    = isPos ? "#4ade80" : "#f87171";

  _bannerBg(ctx, W, H, isPos, sc);

  const spad = 20 * sc, topY = 14 * sc, logoH = 24 * sc, logoCY = topY + logoH / 2;
  if (logo) { const lw = logo.naturalWidth * (logoH / logo.naturalHeight); ctx.drawImage(logo, spad, topY, lw, logoH); }
  _badge(ctx, W - spad, logoCY, `${salesCount} Sales Completed`, sc);

  let eventBottom = topY + logoH + 8 * sc;
  if (eventNames.length === 1) {
    ctx.save();
    ctx.font = `700 ${13 * sc}px ${_F}`; ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(_clip(ctx, eventNames[0], W - spad * 2), spad, eventBottom);
    ctx.restore();
    eventBottom += 13 * sc * 1.15;
  } else {
    const nfs = 12 * sc, lh = nfs * 1.2;
    for (const name of eventNames.slice(0, 2)) {
      ctx.save();
      ctx.font = `700 ${nfs}px ${_F}`; ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(_clip(ctx, name, W - spad * 2), spad, eventBottom);
      ctx.restore(); eventBottom += lh;
    }
    if (eventNames.length > 2) {
      ctx.save();
      ctx.font = `400 ${10 * sc}px ${_F}`; ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(`+${eventNames.length - 2} more`, spad, eventBottom);
      ctx.restore(); eventBottom += 10 * sc * 1.3;
    }
  }

  const subY = eventBottom + 3 * sc;
  ctx.save();
  ctx.font = `400 ${10.5 * sc}px ${_F}`; ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText(`${totalTickets} ticket${totalTickets!==1?"s":""} · ${salesCount} sale${salesCount!==1?"s":""}`, spad, subY);
  ctx.restore();

  const divY = subY + 10.5 * sc * 1.15 + 9 * sc;
  ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fillRect(spad, divY, W - spad * 2, sc);

  const footerH = 36 * sc, footerTop = H - footerH;
  const boxH = 58 * sc, boxGap = 8 * sc, boxPadB = 10 * sc;
  const boxTop = footerTop - boxPadB - boxH;
  const bOL = 16 * sc, bW = (W - 2 * bOL - boxGap) / 2;

  _statBoxC(ctx, bOL, boxTop, bW, boxH, "TOTAL COST",
    totalCost > 0 ? formatCurrency(totalCost) : "—",
    `${totalTickets} ticket${totalTickets!==1?"s":""}`, sc, false);
  _statBoxC(ctx, bOL + bW + boxGap, boxTop, bW, boxH, "TOTAL REVENUE",
    totalRevenue > 0 ? formatCurrency(totalRevenue) : "—",
    `${salesCount} sale${salesCount!==1?"s":""}`, sc, true);

  _bannerFooter(ctx, W, footerTop, spad, sc, `${salesCount} combined sales`, logo);
  _heroSection(ctx, W, divY + sc, boxTop, (isPos?"":"−") + formatCurrency(Math.abs(totalProfit)), roi, isPos, pc, sc);
}

// ─── renderBannerToBlob ───────────────────────────────────────────────────────

const EXPORT_W = 1080;
const EXPORT_H = Math.round(1080 * 300 / 520); // 623

async function renderBannerToBlob(
  drawFn: (ctx: CanvasRenderingContext2D, W: number, H: number, logo: HTMLImageElement | null) => void,
): Promise<Blob> {
  const W = EXPORT_W, H = EXPORT_H;
  const logo = await _loadImage("/logo.png");

  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const oc = new OffscreenCanvas(W, H);
      const ctx = oc.getContext("2d") as CanvasRenderingContext2D | null;
      if (ctx) { drawFn(ctx, W, H, logo); return await oc.convertToBlob({ type:"image/jpeg", quality:0.93 }); }
    } catch { /* fall through */ }
  }

  const dc = document.createElement("canvas"); dc.width = W; dc.height = H;
  const dctx = dc.getContext("2d");
  if (!dctx) throw new Error("Canvas 2D unavailable");
  drawFn(dctx, W, H, logo);
  return new Promise<Blob>((res, rej) =>
    dc.toBlob(b => b ? res(b) : rej(new Error("toBlob null")), "image/jpeg", 0.93));
}

function _downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ─── Modal styles ─────────────────────────────────────────────────────────────

const btnBase: React.CSSProperties = {
  height:44, border:"none", borderRadius:10,
  fontSize:13, fontWeight:600, cursor:"pointer",
  transition:"all 160ms ease", letterSpacing:"-0.01em",
  display:"flex", alignItems:"center", justifyContent:"center",
  fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

// ─── ShareMultiBannerModal ────────────────────────────────────────────────────

type MultiShareProps = { stats: MultiSaleStats; onClose: () => void };

export function ShareMultiBannerModal({ stats, onClose }: MultiShareProps) {
  const [visible, setVisible]           = useState(false);
  const [copying, setCopying]           = useState(false);
  const [copied, setCopied]             = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [bannerBlob, setBannerBlob]     = useState<Blob | null>(null);
  const [genError, setGenError]         = useState("");

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 16);
    const t2 = setTimeout(() => setShowConfetti(true), 200);
    const t3 = setTimeout(() => setShowConfetti(false), 1400);
    renderBannerToBlob((ctx, W, H, logo) => _drawMultiBanner(ctx, W, H, stats, logo))
      .then(b => setBannerBlob(b))
      .catch(e => setGenError(e instanceof Error ? e.message : String(e)));
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  function handleCopy() {
    if (!bannerBlob) return;
    const blob = bannerBlob;
    setCopying(true);
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      void navigator.clipboard.write([new ClipboardItem({ "image/jpeg": blob })])
        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); })
        .catch(() => { _downloadBlob(blob, "sales-summary-tixtracker.jpg"); setCopied(true); setTimeout(() => setCopied(false), 2500); })
        .finally(() => setCopying(false));
    } else {
      _downloadBlob(blob, "sales-summary-tixtracker.jpg");
      setCopied(true); setTimeout(() => setCopied(false), 2500); setCopying(false);
    }
  }

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.88)", backdropFilter:"blur(16px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", opacity: visible?1:0, transition:"opacity 250ms ease", overflowY:"auto" }}
    >
      <div style={{ display:"flex", flexDirection:"column", gap:10, width:"100%", maxWidth:520, transform: visible?"scale(1) translateY(0)":"scale(0.95) translateY(8px)", transition:"transform 280ms cubic-bezier(0.16,1,0.3,1), opacity 280ms ease", opacity: visible?1:0, position:"relative", margin:"auto" }}>
        {showConfetti && <Confetti />}

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, letterSpacing:"-0.02em", color:"rgba(255,255,255,0.95)" }}>Share your wins</div>
            <div style={{ fontSize:11.5, color:"rgba(255,255,255,0.28)", marginTop:2 }}>Copy and paste anywhere</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...btnBase, height:32, width:32, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:8, color:"rgba(255,255,255,0.45)", fontSize:17, flexShrink:0 }}>×</button>
        </div>

        {/* Preview */}
        <div style={{ borderRadius:14, overflow:"hidden", boxShadow:"0 0 0 1px rgba(255,255,255,0.08), 0 16px 48px rgba(0,0,0,0.65), 0 0 32px rgba(155,92,255,0.08)" }}>
          <ScaledPreview w={520} h={300}><MultiSaleBanner stats={stats} animated={visible} /></ScaledPreview>
        </div>

        {genError && <div style={{ padding:"9px 12px", background:"rgba(248,113,113,0.10)", border:"1px solid rgba(248,113,113,0.22)", borderRadius:8, fontSize:12, color:"#fca5a5" }}>{genError}</div>}

        {/* Buttons */}
        <div style={{ display:"flex", gap:8 }}>
          <button type="button" onClick={handleCopy} disabled={!bannerBlob||copying}
            style={{ ...btnBase, flex:1,
              background: copied ? "rgba(74,222,128,0.13)" : !bannerBlob ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg, rgba(124,58,237,0.80), rgba(190,24,93,0.80))",
              border: copied ? "1px solid rgba(74,222,128,0.30)" : "1px solid rgba(155,92,255,0.30)",
              color: copied ? "#4ade80" : "rgba(255,255,255,0.95)",
              cursor: (!bannerBlob||copying) ? "wait" : "pointer",
            }}>
            {!bannerBlob && !genError ? "Generating…" : copied ? "✓ Copied!" : copying ? "Copying…" : "Copy to Clipboard"}
          </button>
          <button type="button" onClick={() => bannerBlob && _downloadBlob(bannerBlob, "sales-summary-tixtracker.jpg")} disabled={!bannerBlob}
            style={{ ...btnBase, padding:"0 18px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", color:"rgba(255,255,255,0.50)", cursor: !bannerBlob ? "wait" : "pointer", whiteSpace:"nowrap" }}>
            Download
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── ShareBannerModal ─────────────────────────────────────────────────────────

type Props = { sale: Sale; order: MatchedOrder | null; onClose: () => void };

export default function ShareBannerModal({ sale, order, onClose }: Props) {
  const [visible, setVisible]           = useState(false);
  const [copying, setCopying]           = useState(false);
  const [copied, setCopied]             = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [bannerBlob, setBannerBlob]     = useState<Blob | null>(null);
  const [genError, setGenError]         = useState("");
  const [hideDetails, setHideDetails]   = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 16);
    const t2 = setTimeout(() => setShowConfetti(true), 200);
    const t3 = setTimeout(() => setShowConfetti(false), 1400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  useEffect(() => {
    const s = hideDetails
      ? { ...sale, event_name:"••••••••••••", venue:"••••••••", event_date:null, section:null, row:null }
      : sale;
    setBannerBlob(null); setGenError("");
    renderBannerToBlob((ctx, W, H, logo) => _drawSaleBanner(ctx, W, H, s, order, logo))
      .then(b => setBannerBlob(b))
      .catch(e => setGenError(e instanceof Error ? e.message : String(e)));
  }, [hideDetails, sale, order]);

  function handleCopy() {
    if (!bannerBlob) return;
    const blob = bannerBlob;
    const fname = `${sale.event_name ?? "sale"}-tixtracker.jpg`;
    setCopying(true);
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      void navigator.clipboard.write([new ClipboardItem({ "image/jpeg": blob })])
        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); })
        .catch(() => { _downloadBlob(blob, fname); setCopied(true); setTimeout(() => setCopied(false), 2500); })
        .finally(() => setCopying(false));
    } else {
      _downloadBlob(blob, fname);
      setCopied(true); setTimeout(() => setCopied(false), 2500); setCopying(false);
    }
  }

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.88)", backdropFilter:"blur(16px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", opacity: visible?1:0, transition:"opacity 250ms ease", overflowY:"auto" }}
    >
      <div style={{ display:"flex", flexDirection:"column", gap:10, width:"100%", maxWidth:520, transform: visible?"scale(1) translateY(0)":"scale(0.95) translateY(8px)", transition:"transform 280ms cubic-bezier(0.16,1,0.3,1), opacity 280ms ease", opacity: visible?1:0, position:"relative", margin:"auto" }}>
        {showConfetti && <Confetti />}

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, letterSpacing:"-0.02em", color:"rgba(255,255,255,0.95)" }}>Share your win</div>
            <div style={{ fontSize:11.5, color:"rgba(255,255,255,0.28)", marginTop:2 }}>Copy and paste anywhere</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:7, flexShrink:0 }}>
            <button type="button" onClick={() => setHideDetails(v => !v)}
              style={{ ...btnBase, height:32, padding:"0 12px",
                background: hideDetails ? "rgba(155,92,255,0.16)" : "rgba(255,255,255,0.05)",
                border: hideDetails ? "1px solid rgba(155,92,255,0.36)" : "1px solid rgba(255,255,255,0.09)",
                borderRadius:8, color: hideDetails ? "#b87bff" : "rgba(255,255,255,0.45)", fontSize:12,
              }}>
              {hideDetails ? "Show Details" : "Hide Details"}
            </button>
            <button type="button" onClick={onClose}
              style={{ ...btnBase, height:32, width:32, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:8, color:"rgba(255,255,255,0.45)", fontSize:17, flexShrink:0 }}>×</button>
          </div>
        </div>

        {/* Preview */}
        <div style={{ borderRadius:14, overflow:"hidden", boxShadow:"0 0 0 1px rgba(255,255,255,0.08), 0 16px 48px rgba(0,0,0,0.65), 0 0 32px rgba(155,92,255,0.08)" }}>
          <ScaledPreview w={520} h={300}>
            <SaleBanner sale={sale} order={order} animated={visible} hideDetails={hideDetails} />
          </ScaledPreview>
        </div>

        {genError && <div style={{ padding:"9px 12px", background:"rgba(248,113,113,0.10)", border:"1px solid rgba(248,113,113,0.22)", borderRadius:8, fontSize:12, color:"#fca5a5" }}>{genError}</div>}

        {/* Buttons */}
        <div style={{ display:"flex", gap:8 }}>
          <button type="button" onClick={handleCopy} disabled={!bannerBlob||copying}
            style={{ ...btnBase, flex:1,
              background: copied ? "rgba(74,222,128,0.13)" : !bannerBlob ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg, rgba(124,58,237,0.80), rgba(190,24,93,0.80))",
              border: copied ? "1px solid rgba(74,222,128,0.30)" : "1px solid rgba(155,92,255,0.30)",
              color: copied ? "#4ade80" : "rgba(255,255,255,0.95)",
              cursor: (!bannerBlob||copying) ? "wait" : "pointer",
            }}>
            {!bannerBlob && !genError ? "Generating…" : copied ? "✓ Copied!" : copying ? "Copying…" : "Copy to Clipboard"}
          </button>
          <button type="button"
            onClick={() => bannerBlob && _downloadBlob(bannerBlob, `${sale.event_name ?? "sale"}-tixtracker.jpg`)}
            disabled={!bannerBlob}
            style={{ ...btnBase, padding:"0 18px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", color:"rgba(255,255,255,0.50)", cursor: !bannerBlob ? "wait" : "pointer", whiteSpace:"nowrap" }}>
            Download
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
