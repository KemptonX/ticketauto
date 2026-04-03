import { supabase } from "@/src/lib/supabase";

export default async function TestSupabasePage() {
  const { data: orders, error } = await supabase
    .from("orders")
    .select("*")
    .limit(10);

  if (error) {
    return (
      <main style={{ padding: "40px", fontFamily: "Arial, sans-serif" }}>
        <h1>Orders Test</h1>
        <pre>{JSON.stringify(error, null, 2)}</pre>
      </main>
    );
  }

  return (
    <main style={{ padding: "40px", fontFamily: "Arial, sans-serif" }}>
      <h1>Orders Test</h1>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginTop: "20px",
        }}
      >
        <thead>
          <tr>
            <th style={cellStyle}>Booking Ref</th>
            <th style={cellStyle}>Event</th>
            <th style={cellStyle}>Venue</th>
            <th style={cellStyle}>Date</th>
            <th style={cellStyle}>Account</th>
            <th style={cellStyle}>Section</th>
            <th style={cellStyle}>Qty</th>
            <th style={cellStyle}>Total</th>
            <th style={cellStyle}>Source</th>
          </tr>
        </thead>
        <tbody>
          {orders?.map((order) => (
            <tr key={order.id}>
              <td style={cellStyle}>{order.booking_ref}</td>
              <td style={cellStyle}>{order.event_name}</td>
              <td style={cellStyle}>{order.venue}</td>
              <td style={cellStyle}>{order.event_date}</td>
              <td style={cellStyle}>{order.account_email}</td>
              <td style={cellStyle}>{order.section}</td>
              <td style={cellStyle}>{order.qty_bought}</td>
              <td style={cellStyle}>£{order.total_cost}</td>
              <td style={cellStyle}>{order.source_type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

const cellStyle = {
  border: "1px solid #ddd",
  padding: "12px",
  textAlign: "left" as const,
};
