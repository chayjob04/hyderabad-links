import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { describeStatus, getMe, listMyListings } from "@/lib/owner-api";
import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = { title: "Business profile" };

/**
 * The owner's own details, and a summary of the businesses they are responsible for.
 *
 * Only the name and email are editable here, because they are the only account-level fields the
 * database holds. Everything else a visitor sees — address, description, hours, contact numbers —
 * belongs to a *listing*, so this page links to the listing editor rather than duplicating it.
 *
 * This is the business account. A customer's own details are at /my/profile, on a different
 * account entirely.
 */
type Props = { searchParams: Promise<{ saved?: string }> };

export default async function BusinessProfilePage({ searchParams }: Props) {
  const [{ saved }, me, listings] = await Promise.all([searchParams, getMe(), listMyListings()]);

  return (
    <>
      <h1 className="text-2xl font-black text-ink">Business profile</h1>
      <p className="mt-1 text-muted">Your contact details, and the businesses on your account.</p>

      {saved ? (
        <p role="status" className="mt-4 rounded-lg bg-brand-50 px-4 py-3 text-sm font-bold text-brand-800">
          Your details were saved.
        </p>
      ) : null}

      <section aria-labelledby="your-details" className="mt-7">
        <h2 id="your-details" className="text-lg font-black text-ink">
          Your details
        </h2>
        <div className="mt-4 rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]">
          {me.ok ? (
            <ProfileForm name={me.data.name ?? ""} email={me.data.email ?? ""} />
          ) : (
            <EmptyState mark="!" title="We could not load your details" tone="error">
              <p>{me.message}</p>
            </EmptyState>
          )}
        </div>
      </section>

      <section aria-labelledby="your-businesses" className="mt-9">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="your-businesses" className="text-lg font-black text-ink">
            Your businesses
          </h2>
          <ButtonLink href="/account/listings/new" tone="ghost">
            Add a listing
          </ButtonLink>
        </div>

        {!listings.ok ? (
          <div className="mt-4">
            <EmptyState mark="!" title="We could not load your businesses" tone="error">
              <p>{listings.message}</p>
            </EmptyState>
          </div>
        ) : listings.data.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              mark="+"
              title="Nothing here yet"
              action={<ButtonLink href="/account/listings/new">Create your first listing</ButtonLink>}
            >
              <p>Add a business and it will appear here.</p>
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3">
            {listings.data.map((listing) => (
              <li
                key={listing.id}
                className="rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black tracking-[0.1em] text-muted uppercase">
                      {listing.categoryName}
                    </p>
                    <h3 className="mt-1 text-lg font-black text-ink">{listing.name}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {listing.addressLine ? `${listing.addressLine}, ` : ""}
                      {listing.localityName}
                    </p>
                  </div>
                  <StatusBadge status={listing.status} />
                </div>

                <p className="mt-3 text-sm text-muted">{describeStatus(listing.status).help}</p>

                <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-4">
                  <Link
                    href={`/account/listings/${listing.id}/edit`}
                    className="text-sm font-black text-brand-700 hover:underline"
                  >
                    Edit details <span aria-hidden="true">&rarr;</span>
                  </Link>
                  {listing.status === "active" ? (
                    <Link href={listing.url} className="text-sm font-black text-brand-700 hover:underline">
                      View public page <span aria-hidden="true">&rarr;</span>
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
