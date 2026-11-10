import type { Metadata } from "next";
import { BRAND_NAME } from "@/lib/brand";
import { safeNextPath } from "@/lib/session";
import { LoginForm } from "./LoginForm";
import { StaffLoginTabs } from "./StaffLoginTabs";
import { readStaffTab } from "./state";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ next?: string; tab?: string }> };

const COPY = {
  admin: {
    heading: `${BRAND_NAME} staff sign-in`,
    blurb:
      "Admin accounts are created for you. There is no sign-up: ask a super admin for an account.",
  },
  super: {
    heading: `${BRAND_NAME} platform administration`,
    blurb:
      "Only accounts with platform administration access can sign in here. Everyone else uses the Admin login tab.",
  },
};

/**
 * The one staff sign-in page, for both surfaces.
 *
 * The tab chooses the words, the cookie the session is written to, and where you land. It does not
 * choose what you may do: an account without `admins.manage` picking the super-admin tab is refused
 * after MFA, because the API never issues it a super-admin token. See login/actions.ts.
 */
export default async function LoginPage({ searchParams }: Props) {
  const { next, tab } = await searchParams;
  const active = readStaffTab(tab);
  const copy = COPY[active];

  return (
    <main className="mx-auto max-w-md px-4 pt-10">
      <h1 className="text-2xl font-bold">{copy.heading}</h1>
      <p className="mt-2 text-neutral-600">{copy.blurb}</p>

      <div className="mt-6">
        <StaffLoginTabs active={active} />
      </div>

      <div className="mt-5">
        <LoginForm next={safeNextPath(active, next)} tab={active} />
      </div>
    </main>
  );
}
