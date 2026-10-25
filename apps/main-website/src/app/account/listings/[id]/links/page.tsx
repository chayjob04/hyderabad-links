import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddLinkForm } from "@/components/account/AddLinkForm";
import { RemoveLinkButton } from "@/components/account/RemoveLinkButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { getListingLinks, getMyListing } from "@/lib/owner-api";
import { LINK_TYPES } from "./form-state";

export const metadata: Metadata = { title: "Website and social links" };

type Props = { params: Promise<{ id: string }> };

const typeLabel = (value: string) =>
  LINK_TYPES.find((type) => type.value === value)?.label ?? value;

/** The date an owner reads, not an ISO string. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * The owner's website and social links for one listing.
 *
 * The allowance comes from the API, which derives it from the subscription period against the
 * clock. That is why this page never decides anything about expiry itself: it renders `limit`,
 * `used` and `paidUntil` as given, so a lapsed listing correctly shows 0 of 0 with an explanation
 * rather than this screen having to work out whether a plan is still good.
 */
export default async function ListingLinksPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listingResult, linksResult] = await Promise.all([getMyListing(id), getListingLinks(id)]);
  if (!listingResult.ok || !linksResult.ok) {
    const failed = !listingResult.ok ? listingResult : linksResult;
    if (failed.ok === false && failed.status === 404) notFound();   // also what another owner's listing looks like
    return (
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <EmptyState tone="error" mark="&#9888;" title="We could not load your links">
          <p>{failed.ok === false ? failed.message : ""}</p>
        </EmptyState>
      </main>
    );
  }

  const listing = listingResult.data;
  const { allowance, items } = linksResult.data;
  const full = allowance.used >= allowance.limit;

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <p className="text-[11px] font-black tracking-[0.22em] text-muted uppercase">Listing</p>
      <h1 className="mt-1 text-2xl font-black tracking-tight text-brand-800 sm:text-3xl">
        Website and social links
      </h1>
      <p className="mt-1 font-bold text-muted">{listing.name}</p>

      <nav className="mt-4 flex flex-wrap gap-3 text-sm font-bold">
        <Link href={`/account/listings/${id}/edit`} className="text-brand-700 hover:underline">
          Edit details
        </Link>
        <Link href={`/account/listings/${id}/photos`} className="text-brand-700 hover:underline">
          Photos and video
        </Link>
        <Link href="/account/listings" className="text-muted hover:underline">
          All listings
        </Link>
      </nav>

      <section className="mt-8 rounded-xl bg-brand-50 px-5 py-4">
        <p className="text-sm font-black text-brand-800">
          {allowance.planName} plan &middot; {allowance.used} of {allowance.limit} links used
        </p>
        {allowance.limit === 0 ? (
          <p className="mt-1 text-sm text-muted">
            Website and social links are part of the Verified plan.{" "}
            {allowance.planSlug === "free" && allowance.paidUntil
              ? `This listing's Verified plan ended on ${formatDate(allowance.paidUntil)}. Renewing restores the links already saved.`
              : "Upgrading adds up to five links to this listing."}
          </p>
        ) : allowance.paidUntil ? (
          <p className="mt-1 text-sm text-muted">
            Verified until {formatDate(allowance.paidUntil)}. Links stop showing publicly after that
            date, and are kept so renewing brings them back.
          </p>
        ) : null}
      </section>

      {items.length > 0 ? (
        <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-white">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-black tracking-[0.12em] text-muted uppercase">
                  {typeLabel(item.linkType)}
                </p>
                <p className="font-bold text-ink">{item.label}</p>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-sm break-all text-brand-700 hover:underline"
                >
                  {item.url}
                </a>
              </div>
              <RemoveLinkButton listingId={id} linkId={item.id} label={item.label} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-sm text-muted">No links yet.</p>
      )}

      <section className="mt-9">
        <h2 className="text-lg font-black text-brand-800">Add a link</h2>
        {allowance.limit === 0 ? (
          <p className="mt-2 text-sm text-muted">
            This listing&rsquo;s plan does not include links, so there is nothing to add yet.
          </p>
        ) : full ? (
          <p className="mt-2 text-sm text-muted">
            All {allowance.limit} links are used. Remove one to add another.
          </p>
        ) : (
          <AddLinkForm listingId={id} />
        )}
      </section>
    </main>
  );
}
