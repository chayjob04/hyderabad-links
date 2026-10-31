"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createBlogPost, setBlogPostPublished, updateBlogPost } from "@/lib/admin-api";
import { revalidatePublicPages } from "@/lib/revalidate";

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

  // The public blog is cached for an hour, so a new post would otherwise not appear until it
  // expired. Refreshing both pages makes publishing feel like publishing.
  await revalidatePublicPages(["/blog"]);
  revalidatePath("/blog");

  if (postId === null) {
    redirect(`/blog?done=${encodeURIComponent(publish ? "Published." : "Saved as a draft.")}`);
  }
  redirect(`/blog/${postId}?done=${encodeURIComponent("Saved.")}`);
}

/** Publishes or unpublishes an existing post from the list. */
export async function setPublishedAction(postId: number, formData: FormData): Promise<void> {
  const publishing = formData.get("intent") === "publish";
  const result = await setBlogPostPublished(postId, publishing);

  if (!result.ok) {
    redirect(`/blog?error=${encodeURIComponent(result.message)}`);
  }

  await revalidatePublicPages(["/blog"]);
  revalidatePath("/blog");
  redirect(`/blog?done=${encodeURIComponent(publishing ? "Published." : "Moved back to drafts.")}`);
}
