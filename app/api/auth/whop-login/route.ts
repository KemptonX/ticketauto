import { NextResponse } from "next/server";
import { setSession } from "@/src/lib/whop-auth";

export const runtime = "nodejs";

const WHOP_API_BASE_URL = process.env.WHOP_API_BASE_URL || "https://api.whop.com/api/v1";
const ALLOWED_STATUSES = new Set([
  "active", "trialing", "completed", "canceling", "past_due", "pastDue",
]);

export async function POST(request: Request) {
  try {
    const { licenseKey } = (await request.json()) as { licenseKey?: string };

    if (!licenseKey?.trim()) {
      return NextResponse.json({ error: "License key is required" }, { status: 400 });
    }

    const apiKey = process.env.WHOP_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "WHOP_API_KEY is not configured" }, { status: 500 });
    }

    const response = await fetch(
      `${WHOP_API_BASE_URL}/memberships/${encodeURIComponent(licenseKey.trim())}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      let whopError = "Invalid license key";

      try {
        const errorBody = (await response.json()) as {
          message?: string;
          error?: string;
        };
        whopError = errorBody.message || errorBody.error || whopError;
      } catch {
        whopError = `Whop request failed with status ${response.status}`;
      }

      return NextResponse.json({ error: whopError }, { status: 401 });
    }

    const membership = (await response.json()) as {
      id: string;
      status: string;
      product?: { id?: string | null };
      user?: { email?: string | null };
    };

    if (!ALLOWED_STATUSES.has(membership.status)) {
      return NextResponse.json({ error: "License is not active" }, { status: 403 });
    }

    const allowedIds = new Set(
      (process.env.WHOP_ALLOWED_PRODUCT_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    );
    const membershipProductId = membership.product?.id || null;
    const membershipPlanId = (membership as Record<string, unknown> & { plan?: { id?: string } }).plan?.id || null;

    if (
      allowedIds.size > 0 &&
      !allowedIds.has(membershipProductId ?? "") &&
      !allowedIds.has(membershipPlanId ?? "")
    ) {
      return NextResponse.json({ error: "License is for the wrong product" }, { status: 403 });
    }

    await setSession({
      membershipId: membership.id,
      productId: membershipProductId,
      userEmail: membership.user?.email || null,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
