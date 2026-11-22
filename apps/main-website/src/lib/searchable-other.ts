/**
 * The value a searchable selector posts when the owner says their area or category is not listed.
 *
 * It lives in its own module, and not beside the component that renders it, because both sides need
 * it: the client component sets it and the server action that reads the form has to recognise it.
 * Importing it from `SearchableSelect.tsx` -- a `"use client"` module -- gave the server action a
 * client reference rather than the string, so the comparison was never true and `__other__` was
 * sent to the API as though it were an area slug. The API answered "Unknown area", which is both
 * the wrong message and the wrong place for it. A plain module is shared by both sides as written.
 *
 * It can never collide with a real slug: the API's slug pattern is lowercase letters, digits and
 * single hyphens, so nothing it accepts contains an underscore.
 */
export const OTHER_VALUE = "__other__";
