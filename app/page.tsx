import Link from "next/link";

export default async function HomePage() {
  return (
    <main style={{ padding: "40px", fontFamily: "Arial, sans-serif" }}>
      <h1>TicketAuto</h1>
      <p>Your ticket dashboard is ready.</p>

      <div style={{ marginTop: "20px" }}>
        <Link
          href="/orders"
          style={{
            display: "inline-block",
            padding: "12px 18px",
            background: "#111",
            color: "#fff",
            textDecoration: "none",
            borderRadius: "8px",
          }}
        >
          View Orders
        </Link>
      </div>
    </main>
  );
}
