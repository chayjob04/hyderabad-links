import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { getPageMeta, withPageMeta } from "@/lib/api";

export async function generateMetadata(): Promise<Metadata> {
  const applied = withPageMeta({ title: "Terms of use" }, await getPageMeta("static", "terms"));

  return {
    ...applied,
    /* Not indexed while the text is a placeholder: a search result leading to "coming soon" is
       worse than no search result, and these pages are linked from the footer anyway. The page's
       own directive survives an override, which can only ever add noindex, never remove it. */
    robots: applied.robots ?? { index: false, follow: true },
  };
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      These are the rules for using this site — what we promise, what we expect of businesses that
      list here, and what happens if a listing breaks them.
    </LegalPage>
  );
}
