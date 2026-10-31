"use client";

import { useActionState } from "react";
import type { PageMeta } from "@/lib/admin-api";
import { saveMetaAction, type MetaState } from "./actions";

const INPUT =
  "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

type Props = {
  entityType: string;
  entityKey: string;
  label: string;
  existing?: PageMeta;
};

/**
 * One page's title, description and indexing.
 *
 * Every field is optional. An empty field means "use what the page works out for itself", which is
 * why nothing here is pre-filled with the derived value: showing it would make an override look
 * like it already existed, and saving the form would then freeze a title that was supposed to
 * follow the page's own content.
 *
 * The character counters are the point of the lengths shown. Google truncates titles around 60
 * characters and descriptions around 160, so writing past those is writing something nobody reads.
 */
export function MetaForm({ entityType, entityKey, label, existing }: Props) {
  const [state, formAction, pending] = useActionState<MetaState, FormData>(
    saveMetaAction.bind(null, entityType, entityKey),
    {},
  );

  return (
    <form action={formAction} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold">{label}</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Leave a field empty to keep what the page works out for itself.
      </p>

      <label htmlFor={`title-${entityKey}`} className="mt-4 block text-sm font-medium">
        Page title <span className="font-normal text-neutral-500">(about 60 characters)</span>
      </label>
      <input
        id={`title-${entityKey}`}
        name="metaTitle"
        defaultValue={existing?.metaTitle ?? ""}
        maxLength={200}
        className={INPUT}
      />

      <label htmlFor={`desc-${entityKey}`} className="mt-4 block text-sm font-medium">
        Description <span className="font-normal text-neutral-500">(about 160 characters)</span>
      </label>
      <textarea
        id={`desc-${entityKey}`}
        name="metaDescription"
        rows={3}
        defaultValue={existing?.metaDescription ?? ""}
        maxLength={400}
        className={INPUT}
      />

      <label htmlFor={`og-${entityKey}`} className="mt-4 block text-sm font-medium">
        Link preview image URL
      </label>
      <input
        id={`og-${entityKey}`}
        name="ogImageUrl"
        defaultValue={existing?.ogImageUrl ?? ""}
        placeholder="https://…"
        className={INPUT}
      />

      <label htmlFor={`kw-${entityKey}`} className="mt-4 block text-sm font-medium">
        Keywords
      </label>
      <p className="text-xs text-neutral-500">
        Google ignores these. Kept because the old site had them and some people still want them
        filled in.
      </p>
      <input id={`kw-${entityKey}`} name="metaKeywords" defaultValue={existing?.metaKeywords ?? ""} className={INPUT} />

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" name="noindex" defaultChecked={existing?.noindex ?? false} className="mt-1" />
        <span>
          <span className="font-medium">Keep this page out of search engines</span>
          <span className="block text-xs text-neutral-500">
            Also removes it from the sitemap, so the two cannot disagree. Use it for a thin page you
            do not want indexed yet, rather than deleting it.
          </span>
        </span>
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state.saved ? (
          <p role="status" className="text-sm font-medium text-green-700">
            Saved.
          </p>
        ) : null}
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
