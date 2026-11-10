import type { Metadata } from "next";
import Link from "next/link";
import { initialsOf } from "@/components/ui/BusinessCard";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { listFavourites } from "@/lib/customer-api";
import { telHref } from "@/lib/format";

export const metadata: Metadata = { title: "Saved businesses" };

/**
 * The businesses this person saved.
 *
 * A listing that has since been taken off the site stays in the list but is not a link: they saved
 * it, so hiding it without a word would just look like the site lost it.
 */
export default async function FavouritesPage() {
  const result = await listFavourites();

  if (!result.ok) {
    return (
      <>
        <h1 className="text-3xl font-black tracking-tight text-brand-800">Saved</h1>
        <div className="mt-6">
          <EmptyState tone="error" mark="&#9888;" title="We could not load your saved businesses">
            <p>{result.message}</p>
          </EmptyState>
        </div>
      </>
    );
  }

  const favourites = result.data;

  return (
    <>
      <div className="border-b border-line pb-5">
        {/* No "BUSINESS OWNER" eyebrow: this page belongs to anyone signed in, and most people
            who save a business do not own one. */}
        <h1 className="text-3xl font-black tracking-tight text-brand-800">Saved businesses</h1>
        <p className="mt-2 text-muted">
          Businesses you saved while browsing. Only you can see this list.
        </p>
      </div>

      {favourites.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            mark="&#9825;"
            title="You have not saved anything yet"
            action={
              <ButtonLink tone="cta" href="/search">
                Find a business <span aria-hidden="true">&rarr;</span>
              </ButtonLink>
            }
          >
            <p>Use the Save button on a business page and it will appear here.</p>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {favourites.map((item) => (
            <li
              key={item.listingId}
              className="flex items-start gap-4 rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]"
            >
              {item.logoUrl ? (
                <img
                  src={item.logoUrl}
                  alt=""
                  loading="lazy"
                  className="h-14 w-14 shrink-0 rounded-full border border-brand-200 bg-white object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-brand-200 bg-brand-50 text-lg font-black text-brand-700"
                >
                  {initialsOf(item.name)}
                </span>
              )}

              <div className="min-w-0">
                <h2 className="text-lg leading-snug font-black text-ink">
                  {item.isAvailable ? (
                    <Link href={item.url} className="hover:text-brand-700">
                      {item.name}
                    </Link>
                  ) : (
                    item.name
                  )}
                </h2>
                <p className="mt-1 text-xs font-black tracking-[0.1em] text-muted uppercase">
                  {item.categoryName} &middot; {item.localityName}
                </p>

                {item.isAvailable ? (
                  <a
                    href={telHref(item.phonePrimary)}
                    className="mt-3 inline-block rounded-full bg-brand-700 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800"
                  >
                    Call
                  </a>
                ) : (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    This business is not on the site at the moment.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
