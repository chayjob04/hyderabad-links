import type { ListingContentSection, ListingFaq } from "@/lib/types";

/**
 * The business's own FAQs, as an accordion.
 *
 * Plain `<details>` elements: they open and close with no JavaScript, they are keyboard accessible
 * for free, and the first one is open so the section does not read as an empty list of headings.
 *
 * The JSON-LD matters as much as the markup. `FAQPage` is one of the few structured data types
 * Google still renders in results, so a listing with real FAQs can occupy noticeably more of a
 * search page — which is most of the reason this is worth selling to an owner.
 */
export function ListingFaqs({ faqs, businessName }: { faqs: ListingFaq[]; businessName: string }) {
  if (faqs.length === 0) {
    return null;
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    name: `Questions about ${businessName}`,
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  return (
    <section className="rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]">
      <h2 className="border-b border-line pb-3 text-lg font-black text-brand-800">
        Frequently asked questions
      </h2>

      <div className="mt-2 divide-y divide-line">
        {faqs.map((faq, index) => (
          <details key={faq.question} open={index === 0} className="group py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-bold text-ink marker:hidden hover:text-brand-700">
              {faq.question}
              <span
                aria-hidden="true"
                className="shrink-0 text-brand-700 transition-transform duration-200 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            {/* whitespace-pre-line: owners write these by hand and their line breaks are usually
                a list of points. */}
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-muted">{faq.answer}</p>
          </details>
        ))}
      </div>

      <script
        type="application/ld+json"
        // The content is plain text from the database and is serialised by JSON.stringify, so
        // there is no markup here to escape.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </section>
  );
}

/**
 * The business's own description sections.
 *
 * The body is plain text, not HTML — that is enforced in the database and the API, because this is
 * written by the least-trusted authors on the platform and published straight to a public page.
 * Rendering it with `whitespace-pre-line` keeps their paragraphs without ever interpreting markup.
 */
export function ListingContent({ sections }: { sections: ListingContentSection[] }) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-5">
      {sections.map((section) => (
        <section
          key={section.heading}
          className="rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]"
        >
          <h2 className="border-b border-line pb-3 text-lg font-black text-brand-800">{section.heading}</h2>
          <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line text-ink">{section.body}</p>
        </section>
      ))}
    </div>
  );
}
