"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addListingContent,
  addListingFaq,
  addListingLink,
  deleteListingContent,
  deleteListingFaq,
  deleteListingLink,
  getListing,
} from "@/lib/super-admin-api";
import { pagesAffectedBy, revalidatePublicPages } from "@/lib/revalidate";

/**
 * Server actions behind the three staff content editors.
 *
 * None of them checks a permission. The API checks `listings.edit` against a super-admin token on
 * every one of these calls, and a server action is just another caller — a check here would be a
 * second opinion, not a control.
 *
 * All six revalidate the listing's own public page. These are the parts of a listing a visitor
 * reads, so a staff edit that did not appear for a minute would have staff editing it twice.
 */

/** The public pages this listing appears on, so an edit shows up immediately. */
async function refreshPublicPages(listingId: number): Promise<void> {
  const listing = await getListing(listingId);
  if (listing.ok) {
    await revalidatePublicPages(pagesAffectedBy(listing.data));
  }
}

async function done(listingId: number, screen: string, message: string): Promise<never> {
  await refreshPublicPages(listingId);
  const path = `/super-admin/listings/${listingId}/${screen}`;
  revalidatePath(path);
  redirect(`${path}?done=${encodeURIComponent(message)}`);
}

function fail(listingId: number, screen: string, message: string): never {
  redirect(`/super-admin/listings/${listingId}/${screen}?error=${encodeURIComponent(message)}`);
}

// ---- FAQs ---------------------------------------------------------------------------------------

export async function addFaqAction(listingId: number, formData: FormData): Promise<void> {
  const question = String(formData.get("question") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();

  const result = await addListingFaq(listingId, question, answer);
  if (!result.ok) {
    fail(listingId, "faqs", Object.values(result.fieldErrors)[0] ?? result.message);
  }

  await done(listingId, "faqs", "Question added.");
}

export async function deleteFaqAction(listingId: number, faqId: number): Promise<void> {
  const result = await deleteListingFaq(listingId, faqId);
  if (!result.ok) fail(listingId, "faqs", result.message);

  await done(listingId, "faqs", "Removed.");
}

// ---- description sections -----------------------------------------------------------------------

export async function addContentAction(listingId: number, formData: FormData): Promise<void> {
  const heading = String(formData.get("heading") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  const result = await addListingContent(listingId, heading, body);
  if (!result.ok) {
    fail(listingId, "content", Object.values(result.fieldErrors)[0] ?? result.message);
  }

  await done(listingId, "content", "Section added.");
}

export async function deleteContentAction(listingId: number, sectionId: number): Promise<void> {
  const result = await deleteListingContent(listingId, sectionId);
  if (!result.ok) fail(listingId, "content", result.message);

  await done(listingId, "content", "Removed.");
}

// ---- website and social links -------------------------------------------------------------------

export async function addLinkAction(listingId: number, formData: FormData): Promise<void> {
  const linkType = String(formData.get("linkType") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();

  const result = await addListingLink(listingId, linkType, label, url);
  if (!result.ok) {
    fail(listingId, "links", Object.values(result.fieldErrors)[0] ?? result.message);
  }

  await done(listingId, "links", "Link added.");
}

export async function deleteLinkAction(listingId: number, linkId: number): Promise<void> {
  const result = await deleteListingLink(listingId, linkId);
  if (!result.ok) fail(listingId, "links", result.message);

  await done(listingId, "links", "Removed.");
}
