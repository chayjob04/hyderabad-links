import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { getPageMeta, withPageMeta } from "@/lib/api";

export async function generateMetadata(): Promise<Metadata> {
  const applied = withPageMeta({ title: "Privacy policy" }, await getPageMeta("static", "privacy"));

  // As on the terms page: an override may add noindex but never take this page's own away.
  return { ...applied, robots: applied.robots ?? { index: false, follow: true } };
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      What we collect when you use this site, why we collect it, how long we keep it, and how to ask
      us to delete it.
    </LegalPage>
  );
}
