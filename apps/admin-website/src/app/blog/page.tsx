import type { Metadata } from "next";
import Link from "next/link";
import { PERMISSION_BLOG, formatWhen, getAdminProfile, getBlogPosts } from "@/lib/admin-api";
import { setPublishedAction } from "./actions";

export const metadata: Metadata = { title: "Blog" };

type Props = { searchParams: Promise<{ page?: string; done?: string; error?: string }> };

/** Every post, drafts included. The public list filters on status; this one deliberately does not. */
export default async function BlogListPage({ searchParams }: Props) {
  const { page: rawPage, done, error } = await searchParams;
  const parsed = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;

  const [result, me] = await Promise.all([getBlogPosts(page), getAdminProfile()]);
  const mayWrite = me.ok && me.data.permissions.includes(PERMISSION_BLOG);

  return (
    <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Blog</h1>
        {mayWrite ? (
          <Link
            href="/blog/new"
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            Write a post
          </Link>
        ) : null}
      </div>

      {done ? (
        <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-green-800">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {error}
        </p>
      ) : null}

      {!result.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      ) : result.data.items.length === 0 ? (
        <p className="mt-6 rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
          Nothing written yet. A post about a neighbourhood or a kind of business is the sort of
          page people search for and a listing cannot be.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {result.data.items.map((post) => (
            <li
              key={post.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <div className="min-w-0">
                <Link href={`/blog/${post.id}`} className="font-semibold text-neutral-900 underline-offset-2 hover:underline">
                  {post.title}
                </Link>
                <p className="mt-1 text-xs text-neutral-500">
                  {post.authorName}
                  {post.publishedAt ? ` · ${formatWhen(post.publishedAt)}` : ""} · /{post.slug}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    post.status === "published"
                      ? "bg-green-50 text-green-800"
                      : "bg-neutral-100 text-neutral-700"
                  }`}
                >
                  {post.status === "published" ? "Published" : "Draft"}
                </span>
                {mayWrite ? (
                  <form action={setPublishedAction.bind(null, post.id)}>
                    <button
                      type="submit"
                      name="intent"
                      value={post.status === "published" ? "unpublish" : "publish"}
                      className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                    >
                      {post.status === "published" ? "Unpublish" : "Publish"}
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!mayWrite ? (
        <p className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
          Your account can read the blog but not write to it. It needs the &quot;Write and publish
          blog posts&quot; permission.
        </p>
      ) : null}
    </main>
  );
}
