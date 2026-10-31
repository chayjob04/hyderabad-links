import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBlogPost } from "@/lib/admin-api";
import { PostForm } from "../PostForm";

export const metadata: Metadata = { title: "Edit post", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
};

export default async function EditPostPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { done } = await searchParams;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isSafeInteger(id) || id < 1) notFound();

  const result = await getBlogPost(id);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto max-w-3xl px-4 pt-8">
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      </main>
    );
  }

  const post = result.data;

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
      <Link href="/blog" className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline">
        &larr; Blog
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{post.title}</h1>
      <p className="mt-1 text-sm text-neutral-600">
        /{post.slug} &middot; {post.status === "published" ? "Published" : "Draft"}
      </p>

      {done ? (
        <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-green-800">
          {done}
        </p>
      ) : null}

      <div className="mt-6">
        <PostForm
          postId={post.id}
          isPublished={post.status === "published"}
          initial={{
            title: post.title,
            excerpt: post.excerpt ?? "",
            bodyMarkdown: post.bodyMarkdown,
            coverImageUrl: post.coverImageUrl ?? "",
          }}
        />
      </div>
    </main>
  );
}
