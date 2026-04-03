import { redirect } from "next/navigation";
import LoginForm from "./login-form";
import { getSession } from "@/src/lib/whop-auth";

export default async function LoginPage() {
  const session = await getSession();

  if (session) {
    redirect("/orders");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#f3f4f6",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <LoginForm />
    </main>
  );
}
