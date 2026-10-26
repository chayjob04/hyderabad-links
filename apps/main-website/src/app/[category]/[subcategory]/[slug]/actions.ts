"use server";

import { revalidatePath } from "next/cache";
import { reportListing, sendEnquiry } from "@/lib/api";
import { forgetFavourite, saveFavourite, submitReview } from "@/lib/owner-api";
import type { EnquiryFormState } from "./enquiry-state";
import type { FavouriteState, ReportFormState } from "./report-state";
import type { ReviewFormState } from "./review-state";

/**
 * Sends a customer enquiry to a business.
 *
 * No redirect: the confirmation replaces the form in place, so the person keeps their place on the
 * business's page. The API validates everything again and is the only thing that decides whether
 * the enquiry was recorded.
 */
export async function sendEnquiryAction(
  _previous: EnquiryFormState,
  formData: FormData,
): Promise<EnquiryFormState> {
  const read = (field: string) => String(formData.get(field) ?? "").trim();
  const values = {
    name: read("name"),
    phone: read("phone"),
    email: read("email"),
    message: read("message"),
  };

  const result = await sendEnquiry(
    { city: read("city"), locality: read("locality"), slug: read("slug") },
    values,
  );

  if (!result.ok) {
    return { values, message: result.message, fieldErrors: result.fieldErrors };
  }

  return { values, fieldErrors: {}, sent: true };
}

/**
 * Submits a customer review. The API checks that the reviewer has a verified phone, that they do
 * not manage the business, and that they have not reviewed it already — so this only reports back.
 *
 * On success the review is *pending*, not published, which the confirmation says plainly.
 */
export async function submitReviewAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const read = (field: string) => String(formData.get(field) ?? "").trim();
  const values = { rating: read("rating"), body: read("body") };

  const rating = Number(values.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { values, message: "Please fix the fields marked below.", fieldErrors: { rating: "Choose a rating from 1 to 5 stars." } };
  }

  const result = await submitReview(
    { city: read("city"), locality: read("locality"), slug: read("slug") },
    { rating, body: values.body },
  );

  if (!result.ok) {
    return { values, message: result.message, fieldErrors: result.fieldErrors };
  }

  return { values, fieldErrors: {}, submitted: true };
}

/**
 * Reports a listing. No account is needed, by design: the people most likely to spot a fake listing
 * are the customers it tried to catch. The API counts the per-address limits and decides.
 */
export async function reportListingAction(
  _previous: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  const read = (field: string) => String(formData.get(field) ?? "").trim();
  const values = { reason: read("reason"), details: read("details") };

  if (values.reason === "") {
    return { values, message: "Please fix the fields marked below.", fieldErrors: { reason: "Choose a reason." } };
  }

  const result = await reportListing(
    { city: read("city"), locality: read("locality"), slug: read("slug") },
    values,
  );

  if (!result.ok) {
    return { values, message: result.message, fieldErrors: result.fieldErrors };
  }

  return { values, fieldErrors: {}, sent: true };
}

/**
 * Saves or unsaves a listing for the signed-in person. The pressed state comes from the server on
 * the next render, so this only reports a failure.
 */
export async function toggleFavouriteAction(
  target: { city: string; locality: string; slug: string },
  currentlySaved: boolean,
): Promise<FavouriteState> {
  const result = currentlySaved ? await forgetFavourite(target) : await saveFavourite(target);
  if (!result.ok) {
    return { saved: currentlySaved, message: "We could not save that just now. Please try again." };
  }

  // The listing page shows the pressed state, so it has to be re-rendered.
  revalidatePath(`/areas/${target.locality}`, "layout");
  revalidatePath("/account/favourites");
  return { saved: !currentlySaved };
}
