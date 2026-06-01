import { NextResponse } from "next/server";

// Demo token endpoint — issues a static token accepted by all demo API routes.
// In production replace with a real identity provider (Clerk, Auth0).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const tenantId = String(body.tenantId ?? "default");

    // Static demo token — the demo routes accept any non-empty value
    const token = Buffer.from(
      JSON.stringify({ sub: `demo-${tenantId}`, tenantId, role: "analyst", demo: true })
    ).toString("base64");

    return NextResponse.json({ token, tenantId, role: "analyst" });
  } catch {
    return NextResponse.json({ error: "Failed to issue token" }, { status: 500 });
  }
}
