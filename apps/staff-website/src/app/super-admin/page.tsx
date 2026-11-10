import { redirect } from "next/navigation";

// There is nothing to show signed out, and the proxy sends anyone without a session to sign in.
export default function HomePage() {
  redirect("/super-admin/overview");
}
