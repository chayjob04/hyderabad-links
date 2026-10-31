"use client";

import { useActionState } from "react";
import { savePostAction, type PostState } from "./actions";

const INPUT =
  "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

type Props = {
  /** Null when writing a new post. */
  postId: number | null;
  initial?: { title: string; excerpt: string; bodyMarkdown: string; coverImageUrl: string };
  /** Published posts lose the "Save and publish" button; they are already published. */
  isPublished?: boolean;
};

/**
 * Writing a post.
 *
 * A plain textarea taking Markdown, not a WYSIWYG. Two reasons, and neither is laziness: a
 * rich-text editor is a sizeable dependency to add on somebody else's behalf, and every one of
 * them produces HTML — which is the thing this feature deliberately does not store, because a post
 * body is the only text on this platform that is published verbatim to the public internet.
 *
 * The slug is not editable. It is set from the title when the post is created and then fixed: a
 * published post whose URL moves is a broken link everywhere it was shared.
 */
export function PostForm({ postId, initial, isPublished = false }: Props) {
  const [state, formAction, pending] = useActionState<PostState, FormData>(
    savePostAction.bind(null, postId),
    {},
  );

  const values = state.values ?? initial;

  return (
    <form action={formAction} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <label htmlFor="title" className="block text-sm font-medium">
        Title
      </label>
      <input id="title" name="title" defaultValue={values?.title ?? ""} className={INPUT} />

      <label htmlFor="excerpt" className="mt-4 block text-sm font-medium">
        Summary
      </label>
      <p className="text-xs text-neutral-500">
        One sentence. It is the card on the blog page and the description search engines show.
      </p>
      <textarea id="excerpt" name="excerpt" rows={2} defaultValue={values?.excerpt ?? ""} className={INPUT} />

      <label htmlFor="coverImageUrl" className="mt-4 block text-sm font-medium">
        Cover image URL
      </label>
      <input
        id="coverImageUrl"
        name="coverImageUrl"
        defaultValue={values?.coverImageUrl ?? ""}
        placeholder="https://…"
        className={INPUT}
      />

      <label htmlFor="bodyMarkdown" className="mt-4 block text-sm font-medium">
        Post
      </label>
      <p className="text-xs text-neutral-500">
        Markdown: <code>## Heading</code>, <code>**bold**</code>, <code>*italic*</code>,{" "}
        <code>- bullet</code>, <code>1. numbered</code>, <code>&gt; quote</code>,{" "}
        <code>[text](https://…)</code>. HTML is shown as text, not rendered.
      </p>
      <textarea
        id="bodyMarkdown"
        name="bodyMarkdown"
        rows={20}
        defaultValue={values?.bodyMarkdown ?? ""}
        className={`${INPUT} font-mono text-sm`}
      />

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="submit"
          name="intent"
          value="draft"
          disabled={pending}
          formNoValidate
          className="rounded-lg border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
        >
          {pending ? "Saving…" : isPublished || postId !== null ? "Save" : "Save as draft"}
        </button>
        {postId === null ? (
          <button
            type="submit"
            name="intent"
            value="publish"
            disabled={pending}
            formNoValidate
            className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60"
          >
            Save and publish
          </button>
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
