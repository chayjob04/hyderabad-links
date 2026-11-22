"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createBlogPost, setBlogPostPublished, updateBlogPost } from "@/lib/admin-api";
import { blogPages, revalidatePublicPages } from "@/lib/revalidate";

export type PostState = {
  error?: string;
  values?: { title: string; excerpt: string; bodyMarkdown: string; coverImageUrl: string };
};

function read(formData: FormData) {
  return {
    title: String(formData.get("title") ?? "").trim(),
    excerpt: String(formData.get("excerpt") ?? "").trim(),
    bodyMarkdown: String(formData.get("bodyMarkdown") ?? ""),
    coverImageUrl: String(formData.get("coverImageUrl") ?? "").trim(),
  };
}

/**
 * Creates a post, or saves an existing one. The pressed button says whether to publish.
 *
 * Like every action here it checks no permission itself: the API checks blog.manage against a live
 * read of the database, and a server action is just another caller.
 */
export async function savePostAction(
  postId: number | null,
  slug: string | null,
  _previous: PostState,
  formData: FormData,
): Promise<PostState> {
  const values = read(formData);
  const publish = formData.get("intent") === "publish";

  const result =
    postId === null
      ? await createBlogPost({ ...values, publish })
      : await updateBlogPost(postId, values);

  if (!result.ok) {
    // The values travel back so a long post is not lost to a one-word validation failure.
    return { error: Object.values(result.fieldErrors)[0] ?? result.message, values };
  }

  /* The public blog is cached for an hour, so a change would otherwise sit unseen for most of a
     working morning. Only the index was refreshed before, which made publishing feel immediate and
     editing feel broken: the post's own page kept the old body for the rest of the hour.

     On a create the slug comes back from the API; on an edit it is bound from the page, because the
     update endpoint returns nothing and the slug never changes anyway -- a published post whose URL
     moved would be a broken link. */
  const postSlug = postId === null && result.ok ? (result.data as { slug: string }).slug : slug;
  await revalidatePublicPages(blogPages(postSlug));
  revalidatePath("/admin/blog");

  if (postId === null) {
    redirect(`/admin/blog?done=${encodeURIComponent(publish ? "Published." : "Saved as a draft.")}`);
  }
  redirect(`/admin/blog/${postId}?done=${encodeURIComponent("Saved.")}`);
}

/** Publishes or unpublishes an existing post from the list. */
export async function setPublishedAction(postId: number, slug: string, formData: FormData): Promise<void> {
  const publishing = formData.get("intent") === "publish";
  const result = await setBlogPostPublished(postId, publishing);

  if (!result.ok) {
    redirect(`/admin/blog?error=${encodeURIComponent(result.message)}`);
  }

  await revalidatePublicPages(blogPages(slug));
  revalidatePath("/admin/blog");
  redirect(`/admin/blog?done=${encodeURIComponent(publishing ? "Published." : "Moved back to drafts.")}`);
}
