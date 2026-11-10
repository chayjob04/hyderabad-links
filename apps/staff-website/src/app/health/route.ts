// Used by Azure App Service health checks. Must stay cheap and unauthenticated.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", app: "staff-website" });
}
