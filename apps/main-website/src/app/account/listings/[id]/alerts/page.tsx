import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { getMyListing, listListingAlerts } from "@/lib/owner-api";
import { acknowledgeAlertAction } from "./actions";

export const metadata: Metadata = { title: "Messages about your listing" };

type Props = { params: Promise<{ id: string }> };

/** The date an owner reads, not an ISO string. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * What staff have asked the owner to change on one listing.
 *
 * This page is the message, not a copy of it. The email is sent on a best-effort basis — an address
 * can bounce, a spam filter can swallow it, a provider can be down — so the alert is stored and
 * shown here, and an owner who never received the email still finds out what to fix.
 *
 * Acknowledging means "I have read this", not "I have fixed it". Nothing here edits the listing, and
 * staff keep seeing what they asked for, so an owner cannot make a request disappear by clicking.
 */
export default async function ListingAlertsPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listingResult, alertsResult] = await Promise.all([getMyListing(id), listListingAlerts(id)]);
  if (!listingResult.ok) notFound();

  const listing = listingResult.data;
  const alerts = alertsResult.ok ? alertsResult.data : [];
  const open = alerts.filter((alert) => alert.acknowledgedAt === null);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div className="border-b border-line pb-5">
        <Link href="/account/listings" className="text-sm font-bold text-brand-700 hover:underline">
          <span aria-hidden="true">&larr;</span> My listings
        </Link>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-brand-800">Messages about {listing.name}</h1>
        <p className="mt-2 text-sm text-muted">
          When we spot something that needs correcting, we write to you here as well as by email.
          Your listing stays live while you fix it.
        </p>
      </div>

      {!alertsResult.ok ? (
        <div className="mt-8">
          <EmptyState tone="error" mark="&#9888;" title="We could not load your messages">
            <p>{alertsResult.message}</p>
          </EmptyState>
        </div>
      ) : alerts.length === 0 ? (
        <div className="mt-8">
          <EmptyState mark="&#10003;" title="Nothing to fix">
            <p>We have not asked you to change anything on this listing.</p>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-8 grid gap-5">
          {alerts.map((alert) => {
            const isOpen = alert.acknowledgedAt === null;
            return (
              <li
                key={alert.id}
                className={`rounded-xl border bg-white p-5 shadow-[0_8px_22px_#002a340b] ${
                  isOpen ? "border-amber-300" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-black tracking-widest text-muted uppercase">{alert.reasonLabel}</p>
                  {isOpen ? (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">
                      Needs your attention
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-muted">Read</span>
                  )}
                </div>

                {/* whitespace-pre-wrap: staff write these by hand, and their line breaks are
                    usually a list of the things to change. */}
                <p className="mt-3 text-[15px] whitespace-pre-wrap text-ink">{alert.message}</p>

                <p className="mt-3 text-xs text-muted">
                  {alert.sentByName} &middot; {formatDate(alert.createdAt)}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <Link
                    href={`/account/listings/${id}/edit`}
                    className="rounded-full border border-brand-200 px-5 py-2 text-sm font-bold text-brand-700 hover:border-brand-700 hover:bg-brand-50"
                  >
                    Edit this listing
                  </Link>
                  {isOpen ? (
                    <form action={acknowledgeAlertAction.bind(null, id, alert.id)}>
                      <button
                        type="submit"
                        className="rounded-full px-4 py-2 text-sm font-black text-brand-700 hover:underline"
                      >
                        Mark as read
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open.length > 0 ? (
        <p className="mt-6 text-sm text-muted">
          Marking a message as read only clears the flag on your listing. It does not tell us the
          change has been made &mdash; edit the listing for that.
        </p>
      ) : null}
    </main>
  );
}
