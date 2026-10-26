import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of use",
  // Not indexed while the text is a placeholder: a search result leading to "coming soon" is worse
  // than no search result, and these pages are linked from the footer anyway.
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      These are the rules for using this site — what we promise, what we expect of businesses that
      list here, and what happens if a listing breaks them.
    </LegalPage>
  );
}
