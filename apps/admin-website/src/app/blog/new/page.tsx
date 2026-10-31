import type { Metadata } from "next";
import Link from "next/link";
import { PostForm } from "../PostForm";

export const metadata: Metadata = { title: "Write a post", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function NewPostPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
      <Link href="/blog" className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline">
        &larr; Blog
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Write a post</h1>
      <p className="mt-1 text-sm text-neutral-600">
        The web address is made from the title and then fixed, so a published post never moves.
      </p>
      <div className="mt-6">
        <PostForm postId={null} />
      </div>
    </main>
  );
}
