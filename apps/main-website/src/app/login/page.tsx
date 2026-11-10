import type { Metadata } from "next";
import { AuthLayout } from "@/components/ui/AuthLayout";
import { LoginTabs, readLoginTab } from "@/components/ui/LoginTabs";
import { safeNextPath } from "@/lib/session";
import { LoginForm } from "./LoginForm";
import { defaultDestination } from "./state";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ next?: string; tab?: string }> };

/** The words change with the tab; the form underneath does not, because the sign-in is the same. */
const COPY = {
  user: {
    title: "Sign in",
    subtitle: "Save the places you like and review the ones you have used. First time? The same steps create your account.",
    aside: {
      heading: "Welcome to Hyderabad Links",
      lead: "Hyderabad's local business directory.",
      points: [
        "Save any business to your favourites",
        "Review the places you have actually used",
        "No password to remember — just your mobile number",
      ],
    },
  },
  business: {
    title: "Welcome back",
    subtitle: "Sign in to manage your business. New here? The same steps create your account.",
    aside: {
      heading: "Welcome to Hyderabad Links",
      lead: "Hyderabad's local business directory.",
      points: [
        "Be found by customers searching your area",
        "Keep your details and digital profiles in one place",
        "Free to list, and reviewed before it goes live",
      ],
    },
  },
};

export default async function LoginPage({ searchParams }: Props) {
  const { next, tab } = await searchParams;
  const active = readLoginTab(tab, next);
  const copy = COPY[active];
  // Resolved here so the tab links can carry it, and so an unsafe value never reaches the markup.
  const destination = safeNextPath(next, defaultDestination(active));

  return (
    <AuthLayout title={copy.title} subtitle={copy.subtitle} aside={copy.aside}>
      <LoginTabs active={active} next={next} />
      <div className="mt-5">
        <LoginForm
          next={destination}
          tab={active}
          devHint={(process.env.APP_ENV ?? "LOCAL") === "LOCAL"}
        />
      </div>
    </AuthLayout>
  );
}
