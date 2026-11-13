"use client";

import { useActionState } from "react";
import { savePostAction, type PostState } from "./actions";

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
 *
 * On the theme's form classes. The body keeps a monospace face, because Markdown is easier to
 * line up in one.
 */
export function PostForm({ postId, initial, isPublished = false }: Props) {
  const [state, formAction, pending] = useActionState<PostState, FormData>(
    savePostAction.bind(null, postId),
    {},
  );

  const values = state.values ?? initial;

  return (
    <div className="card">
      <div className="card-body">
        <form action={formAction}>
          <div className="mb-3">
            <label htmlFor="title" className="form-label">
              Title
            </label>
            <input id="title" name="title" defaultValue={values?.title ?? ""} className="form-control" />
          </div>

          <div className="mb-3">
            <label htmlFor="excerpt" className="form-label">
              Summary
            </label>
            <textarea
              id="excerpt"
              name="excerpt"
              rows={2}
              defaultValue={values?.excerpt ?? ""}
              className="form-control"
            />
            <div className="form-text">
              One sentence. It is the card on the blog page and the description search engines show.
            </div>
          </div>

          <div className="mb-3">
            <label htmlFor="coverImageUrl" className="form-label">
              Cover image URL
            </label>
            <input
              id="coverImageUrl"
              name="coverImageUrl"
              defaultValue={values?.coverImageUrl ?? ""}
              placeholder="https://…"
              className="form-control"
            />
          </div>

          <div className="mb-3">
            <label htmlFor="bodyMarkdown" className="form-label">
              Post
            </label>
            <textarea
              id="bodyMarkdown"
              name="bodyMarkdown"
              rows={20}
              defaultValue={values?.bodyMarkdown ?? ""}
              className="form-control font-size-13"
              style={{ fontFamily: "var(--bs-font-monospace)" }}
            />
            <div className="form-text">
              Markdown: <code>## Heading</code>, <code>**bold**</code>, <code>*italic*</code>,{" "}
              <code>- bullet</code>, <code>1. numbered</code>, <code>&gt; quote</code>,{" "}
              <code>[text](https://…)</code>. HTML is shown as text, not rendered.
            </div>
          </div>

          <div className="d-flex flex-wrap gap-2">
            <button
              type="submit"
              name="intent"
              value="draft"
              disabled={pending}
              formNoValidate
              className="btn btn-outline-secondary"
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
                className="btn btn-primary"
              >
                Save and publish
              </button>
            ) : null}
          </div>

          {state.error ? (
            <div role="alert" className="alert alert-danger py-2 px-3 mt-3 mb-0 font-size-13">
              {state.error}
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
