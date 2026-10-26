import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy policy",
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      What we collect when you use this site, why we collect it, how long we keep it, and how to ask
      us to delete it.
    </LegalPage>
  );
}
