"use server";

import { redirect } from "next/navigation";
import { OTHER_VALUE } from "@/lib/searchable-other";
import { onboard, suggestTaxonomy } from "@/lib/owner-api";
import type { OnboardingState } from "./state";

/**
 * Records a request for an area or a category, and words the answer the owner reads.
 *
 * Three answers are possible and they are genuinely different things, which is why this is not one
 * sentence with a name slotted into it:
 *
 *   - it is already there under another name, so there is nothing to wait for and the owner should
 *     search the list again for what we actually call it;
 *   - it is now in the queue, so somebody will add it and the listing can be moved;
 *   - the API refused it (too short, angle brackets, something it cannot build a web address from),
 *     in which case its own message is the useful one.
 *
 * Either way the owner still has to choose an existing option to finish signing up, and either way
 * the message says so -- a form that records a request and then blocks without explaining why is
 * the worst of both.
 */
async function recordRequest(
  kind: "locality" | "category",
  name: string,
  word: string,
): Promise<string> {
  const result = await suggestTaxonomy({ kind, name });

  if (!result.ok) {
    return (
      result.fieldErrors.name ??
      `We could not record "${name}": ${result.message} Choose the nearest ${word} for now.`
    );
  }

  if (result.data.status === "already_exists" && result.data.existingName) {
    return `We already have that ${word}, under the name "${result.data.existingName}". Search for it in the list above.`;
  }

  return `Thank you \u2014 we have your request for "${name}" and it is with our team. Choose the nearest ${word} for now so you can finish signing up; we will move your listing once it is added.`;
}

/**
 * Registers the signed-in owner. The API does the real validation and decides whether anything was
 * created, so this action only collects the fields and passes failures back to the form.
 */
export async function onboardAction(_previous: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const read = (field: string) => String(formData.get(field) ?? "").trim();
  const values = {
    name: read("name"),
    businessName: read("businessName"),
    email: read("email"),
    localitySlug: read("localitySlug"),
    categorySlug: read("categorySlug"),
    // Kept so a rejected form shows the name back rather than losing it.
    localityOther: read("localityOther"),
    categoryOther: read("categoryOther"),
  };

  // The two selectors have no blank-but-valid state, so catch an unanswered one here rather than
  // sending it to the API only to be told "Unknown area".
  const fieldErrors: Record<string, string> = {};
  if (!values.localitySlug) fieldErrors.localitySlug = "Choose the area your business is in.";
  if (!values.categorySlug) fieldErrors.categorySlug = "Choose what your business does.";

  /* "Not in the list" is a request, not a value.
     Nothing public is created from it: an area or a category invented by whoever signed up last is
     one the whole directory then has to live with, and an area decides a listing's web address. So
     the request is recorded for staff (S0032) and the owner is asked to pick the nearest existing
     option so their account can be finished; their listing can be moved afterwards.

     Recording it is what used to be missing. The name was shown back with a prefilled email to
     support, and if that email was never sent nobody had been asked. */
  if (values.localitySlug === OTHER_VALUE) {
    fieldErrors.localitySlug = values.localityOther
      ? await recordRequest("locality", values.localityOther, "area")
      : "Tell us the name of your area.";
  }
  if (values.categorySlug === OTHER_VALUE) {
    fieldErrors.categorySlug = values.categoryOther
      ? await recordRequest("category", values.categoryOther, "category")
      : "Tell us what your business does.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { values, message: "Please fix the fields marked below.", fieldErrors };
  }

  const result = await onboard(values);
  if (!result.ok) {
    return { values, message: result.message, fieldErrors: result.fieldErrors };
  }

  // redirect() throws, so it must sit outside any try/catch.
  redirect("/account/listings?welcome=1");
}
