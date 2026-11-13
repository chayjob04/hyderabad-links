"use client";

import { useActionState } from "react";
import type { PageMeta } from "@/lib/admin-api";
import { saveMetaAction, type MetaState } from "./actions";

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
 * The lengths named in the labels are the point. Google truncates titles around 60 characters and
 * descriptions around 160, so writing past those is writing something nobody reads.
 *
 * On the theme's form classes, as a bordered block rather than its own card — there are six of
 * these on the page and six stacked cards would read as six unrelated screens.
 */
export function MetaForm({ entityType, entityKey, label, existing }: Props) {
  const [state, formAction, pending] = useActionState<MetaState, FormData>(
    saveMetaAction.bind(null, entityType, entityKey),
    {},
  );

  return (
    <form action={formAction} className="border rounded p-3 mb-3">
      <h5 className="font-size-15 mb-1">{label}</h5>
      <p className="text-muted font-size-12 mb-3">
        Leave a field empty to keep what the page works out for itself.
      </p>

      <div className="mb-3">
        <label htmlFor={`title-${entityKey}`} className="form-label">
          Page title <span className="text-muted fw-normal">(about 60 characters)</span>
        </label>
        <input
          id={`title-${entityKey}`}
          name="metaTitle"
          defaultValue={existing?.metaTitle ?? ""}
          maxLength={200}
          className="form-control"
        />
      </div>

      <div className="mb-3">
        <label htmlFor={`desc-${entityKey}`} className="form-label">
          Description <span className="text-muted fw-normal">(about 160 characters)</span>
        </label>
        <textarea
          id={`desc-${entityKey}`}
          name="metaDescription"
          rows={3}
          defaultValue={existing?.metaDescription ?? ""}
          maxLength={400}
          className="form-control"
        />
      </div>

      <div className="mb-3">
        <label htmlFor={`og-${entityKey}`} className="form-label">
          Link preview image URL
        </label>
        <input
          id={`og-${entityKey}`}
          name="ogImageUrl"
          defaultValue={existing?.ogImageUrl ?? ""}
          placeholder="https://…"
          className="form-control"
        />
      </div>

      <div className="mb-3">
        <label htmlFor={`kw-${entityKey}`} className="form-label">
          Keywords
        </label>
        <input
          id={`kw-${entityKey}`}
          name="metaKeywords"
          defaultValue={existing?.metaKeywords ?? ""}
          className="form-control"
        />
        <div className="form-text">
          Google ignores these. Kept because the old site had them and some people still want them
          filled in.
        </div>
      </div>

      <div className="form-check mb-3">
        <input
          className="form-check-input"
          type="checkbox"
          name="noindex"
          id={`noindex-${entityKey}`}
          defaultChecked={existing?.noindex ?? false}
        />
        <label className="form-check-label" htmlFor={`noindex-${entityKey}`}>
          Keep this page out of search engines
          <span className="d-block text-muted font-size-12">
            Also removes it from the sitemap, so the two cannot disagree. Use it for a thin page you
            do not want indexed yet, rather than deleting it.
          </span>
        </label>
      </div>

      <div className="d-flex align-items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Saving…" : "Save"}
        </button>
        {state.saved ? (
          <span role="status" className="text-success fw-semibold font-size-13">
            Saved.
          </span>
        ) : null}
      </div>

      {state.error ? (
        <div role="alert" className="alert alert-danger py-2 px-3 mt-3 mb-0 font-size-13">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}
