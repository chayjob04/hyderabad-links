import type { Metadata } from "next";
import Link from "next/link";
import { ListingForm } from "@/components/ListingForm";
import { ListingSection } from "@/components/account/ListingSection";
import { getCategories, getLocalities } from "@/lib/api";
import { DEFAULT_CITY } from "@/lib/brand";
import { completionOf } from "@/lib/listing-completion";
import { saveListingAction } from "../../actions";

export const metadata: Metadata = { title: "Add your business" };

/**
 * A new listing, in the same sections the editor uses.
 *
 * Only one of them can be filled in here, and that is a fact about the data rather than a shortcut:
 * a photo, a question and answer, an opening time and a link all belong to a listing, and there is
 * no listing to attach them to until this form has been saved once. Inventing somewhere to keep
 * them in the meantime would mean a second place where a half-made listing lives.
 *
 * So the other four sections are listed, closed, saying when they open. Pressing either button
 * creates the listing and lands on the editor, where all five are editable -- Save leaves it a
 * draft, Submit sends it for review. The same two buttons, the same server action, the same
 * endpoint as every later edit.
 */
export default async function NewListingPage() {
  const [categories, localities] = await Promise.all([getCategories(), getLocalities(DEFAULT_CITY)]);

  /* Nothing is filled in yet, so this is 0% of the fields a reviewer needs -- counted from the same
     list the editor counts, not written here as a number. */
  const detailsCompletion = completionOf([
    { label: "business name", done: false },
    { label: "category", done: false },
    { label: "area", done: false },
    { label: "address", done: false },
    { label: "phone number", done: false },
    { label: "a description of at least 20 characters", done: false },
  ]);

  const later = [
    { title: "Photos and video", why: "Uploads attach to a saved listing." },
    { title: "Opening hours", why: "Set the days and times once the listing exists." },
    { title: "About, questions and amenities", why: "Questions and answers attach to a saved listing." },
    { title: "Website and social links", why: "Links attach to a saved listing." },
  ];

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <Link href="/account/listings" className="text-sm font-bold text-brand-700 hover:underline">
        <span aria-hidden="true">&larr;</span> Back to my listings
      </Link>

      <div className="mt-4 border-b border-line pb-5">
        <p className="text-[11px] font-black tracking-[0.22em] text-muted">BUSINESS OWNER</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-brand-800">Add your business</h1>
        <p className="mt-2 text-muted">
          Save keeps it private as a draft, so you can come back and finish it. Submit asks us to
          review it.
        </p>
      </div>

      <div className="mt-6 space-y-4">
        <ListingSection
          title="Business details"
          blurb="Where you are, how to reach you, and what you do. An address and a description of at least 20 characters are what we need before we can review it."
          completion={detailsCompletion}
          defaultOpen
        >
          <ListingForm
            action={saveListingAction.bind(null, null)}
            categories={categories}
            localities={localities ?? []}
            initialValues={{}}
            submitLabel="Save changes"
            submitAction="Submit for review"
          />
        </ListingSection>

        {later.map((section) => (
          <ListingSection
            key={section.title}
            title={section.title}
            completion={completionOf([])}
            badge="After saving"
          >
            <p className="text-sm text-muted">{section.why} Save this form and it opens here.</p>
          </ListingSection>
        ))}
      </div>
    </main>
  );
}
