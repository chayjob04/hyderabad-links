import { ListingNav } from "@/components/account/ListingNav";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { getListingAttributes, getListingContent, getListingFaqs, getMyListing } from "@/lib/owner-api";
import { AddContentForm, AddFaqForm } from "./AddForms";
import { AttributeForm } from "./AttributeForm";
import { removeAttributeAction, removeContentAction, removeFaqAction } from "./actions";

export const metadata: Metadata = { title: "About this business" };

type Props = { params: Promise<{ id: string }> };

/** The order the lists appear in, and what to show in each empty field. */
const ATTRIBUTE_SECTIONS = [
  { kind: "offering", placeholder: "Oil change, bridal makeup, CT scan2026" },
  { kind: "amenity", placeholder: "Parking, card payment2026" },
  { kind: "language", placeholder: "Telugu, Hindi2026" },
];

/**
 * The owner's FAQs and description sections for one listing.
 *
 * Both are part of the Verified plan, so a Free listing sees the forms replaced by what the paid
 * plan adds rather than a bare refusal.
 *
 * Anything written while on a paid plan is kept when that plan lapses — it stops being shown and
 * comes back on renewal (decision D10). The page says so, because an owner who sees their FAQs
 * vanish and is not told would reasonably assume they had been deleted.
 */
export default async function ListingAboutPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listingResult, faqsResult, contentResult, attributesResult] = await Promise.all([
    getMyListing(id),
    getListingFaqs(id),
    getListingContent(id),
    getListingAttributes(id),
  ]);
  if (!listingResult.ok) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div className="border-b border-line pb-5">
        <Link href="/account/listings" className="text-sm font-bold text-brand-700 hover:underline">
          <span aria-hidden="true">&larr;</span> My listings
        </Link>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-brand-800">About this business</h1>
        <p className="mt-2 text-sm text-muted">{listingResult.data.name}</p>
        <ListingNav listingId={id} current="about" />
      </div>

      {/* ---- the three short lists ---- */}
      <section className="mt-8">
        <h2 className="text-lg font-black text-brand-800">How you would describe yourself</h2>
        <p className="mt-1 text-sm text-muted">
          Short labels shown on your public page. Free on every plan &mdash; these are what helps
          somebody decide to call you.
        </p>

        {attributesResult.ok ? (
          <div className="mt-4 grid gap-4">
            {ATTRIBUTE_SECTIONS.map((section) => {
              const mine = attributesResult.data.items.filter((a) => a.kind === section.kind);
              return (
                <div key={section.kind}>
                  {mine.length > 0 ? (
                    <ul className="mb-2 flex flex-wrap gap-2">
                      {mine.map((item) => (
                        <li key={item.id}>
                          <form action={removeAttributeAction.bind(null, id, item.id)}>
                            <button
                              type="submit"
                              className="group flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-[13px] font-bold text-brand-800 hover:border-red-400 hover:bg-red-50 hover:text-red-800"
                              title={`Remove ${item.label}`}
                            >
                              {item.label}
                              <span aria-hidden="true" className="text-muted group-hover:text-red-700">
                                &times;
                              </span>
                              <span className="sr-only">Remove</span>
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <AttributeForm
                    listingId={id}
                    kind={section.kind}
                    heading={attributesResult.data.kinds[section.kind] ?? section.kind}
                    placeholder={section.placeholder}
                    suggestions={attributesResult.data.suggestions[section.kind] ?? []}
                    existing={mine.map((a) => a.label)}
                    used={mine.length}
                    max={attributesResult.data.maxPerKind}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState tone="error" mark="&#9888;" title="We could not load these">
              <p>{attributesResult.message}</p>
            </EmptyState>
          </div>
        )}
      </section>

      {/* ---- content sections ---- */}
      <section className="mt-8">
        <h2 className="text-lg font-black text-brand-800">Describe your business</h2>
        <p className="mt-1 text-sm text-muted">
          Sections that appear on your public page, above the enquiry form.
        </p>

        {!contentResult.ok ? (
          <div className="mt-4">
            <EmptyState tone="error" mark="&#9888;" title="We could not load this">
              <p>{contentResult.message}</p>
            </EmptyState>
          </div>
        ) : (
          <>
            {contentResult.data.items.length > 0 ? (
              <ul className="mt-4 grid gap-3">
                {contentResult.data.items.map((section, index) => (
                  <li key={section.id} className="rounded-lg border border-line p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="font-black text-ink">{section.heading}</h3>
                      <form action={removeContentAction.bind(null, id, section.id)}>
                        <button type="submit" className="text-xs font-bold text-red-700 hover:underline">
                          Remove
                        </button>
                      </form>
                    </div>
                    <p className="mt-2 text-sm whitespace-pre-line text-muted">{section.body}</p>
                    {index >= contentResult.data.limit ? (
                      <p className="mt-2 text-xs font-bold text-amber-700">
                        Over your plan&apos;s allowance, so this one is not shown publicly. It is kept.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4">
              <AddContentForm
                listingId={id}
                limit={contentResult.data.limit}
                used={contentResult.data.used}
                planName={contentResult.data.planName}
              />
            </div>
          </>
        )}
      </section>

      {/* ---- FAQs ---- */}
      <section className="mt-10">
        <h2 className="text-lg font-black text-brand-800">Questions people ask</h2>
        <p className="mt-1 text-sm text-muted">
          These appear on your page and can show directly in Google results.
        </p>

        {!faqsResult.ok ? (
          <div className="mt-4">
            <EmptyState tone="error" mark="&#9888;" title="We could not load this">
              <p>{faqsResult.message}</p>
            </EmptyState>
          </div>
        ) : (
          <>
            {faqsResult.data.items.length > 0 ? (
              <ul className="mt-4 grid gap-3">
                {faqsResult.data.items.map((faq, index) => (
                  <li key={faq.id} className="rounded-lg border border-line p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="font-black text-ink">{faq.question}</h3>
                      <form action={removeFaqAction.bind(null, id, faq.id)}>
                        <button type="submit" className="text-xs font-bold text-red-700 hover:underline">
                          Remove
                        </button>
                      </form>
                    </div>
                    <p className="mt-2 text-sm whitespace-pre-line text-muted">{faq.answer}</p>
                    {index >= faqsResult.data.limit ? (
                      <p className="mt-2 text-xs font-bold text-amber-700">
                        Over your plan&apos;s allowance, so this one is not shown publicly. It is kept.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4">
              <AddFaqForm
                listingId={id}
                limit={faqsResult.data.limit}
                used={faqsResult.data.used}
                planName={faqsResult.data.planName}
              />
            </div>
          </>
        )}
      </section>

      <p className="mt-8 border-t border-line pt-5 text-sm text-muted">
        If your Verified plan ends, everything here is kept and simply stops being shown. It comes
        back the moment you renew.
      </p>
    </main>
  );
}
