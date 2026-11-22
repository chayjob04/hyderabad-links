"use server";

import { redirect } from "next/navigation";
import { OTHER_VALUE } from "@/components/account/SearchableSelect";
import { onboard } from "@/lib/owner-api";
import type { OnboardingState } from "./state";

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
     Nothing is created from it: an area or a category invented by whoever signed up last is one
     the whole directory then has to live with, and there is no table for a pending suggestion to
     wait in. So the typed name is kept, shown back, and offered to support as a prefilled message,
     and the owner is asked to pick the nearest existing option so the account can be finished.
     Their listing can be moved afterwards -- the area decides the web address, which is why the
     form says it cannot be changed later, and only staff can change it. */
  if (values.localitySlug === OTHER_VALUE) {
    fieldErrors.localitySlug = values.localityOther
      ? `We do not have "${values.localityOther}" yet. Choose the nearest area for now and send us the name below \u2014 we will move your listing once it is added.`
      : "Tell us the name of your area.";
  }
  if (values.categorySlug === OTHER_VALUE) {
    fieldErrors.categorySlug = values.categoryOther
      ? `We do not have "${values.categoryOther}" yet. Choose the closest category for now and send us the name below \u2014 we will change it once it is added.`
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
