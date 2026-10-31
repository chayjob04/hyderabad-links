import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { getBlogPage } from "@/lib/api";
import { absoluteUrl } from "@/lib/format";

export const metadata: Metadata = {
  title: "Blog",
  description: "Guides to eating, shopping and getting things done in Hyderabad.",
  alternates: { canonical: absoluteUrl("/blog") },
};

/** Revalidated hourly: posts appear when somebody publishes, not continuously. */
export const revalidate = 3600;

type Props = { searchParams: Promise<{ page?: string }> };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * The blog index.
 *
 * It exists for search: a listing page can rank for one business, while "where to eat in Madhapur"
 * is a question only an article answers. That is why the posts carry real dates and excerpts
 * rather than being a decorative strip on the homepage.
 */
export default async function BlogIndexPage({ searchParams }: Props) {
  const { page: rawPage } = await searchParams;
  const parsed = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;

  const result = await getBlogPage(page);

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <div className="border-b border-line pb-5">
        <p className="text-[11px] font-black tracking-[0.22em] text-muted">HYDERABAD LINKS</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-brand-800 sm:text-4xl">Blog</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">
          Guides to eating, shopping and getting things done around the city.
        </p>
      </div>

      {!result || result.items.length === 0 ? (
        <div className="mt-8">
          <EmptyState mark="&#9998;" title="Nothing here yet">
            <p>The first post is on its way.</p>
          </EmptyState>
        </div>
      ) : (
        <>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((post) => (
              <li
                key={post.slug}
                className="overflow-hidden rounded-xl border border-line bg-white shadow-[0_8px_22px_#002a340b]"
              >
                <Link href={`/blog/${post.slug}`} className="group block">
                  {post.coverImageUrl ? (
                    <span className="relative block aspect-[16/10] overflow-hidden bg-brand-50">
                      <Image
                        src={post.coverImageUrl}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover transition duration-300 group-hover:scale-105"
                      />
                    </span>
                  ) : null}
                  <span className="block p-5">
                    <span className="block text-[17px] leading-snug font-black text-ink group-hover:text-brand-700">
                      {post.title}
                    </span>
                    {post.excerpt ? (
                      <span className="mt-2 block text-sm leading-relaxed text-muted">{post.excerpt}</span>
                    ) : null}
                    <span className="mt-3 block text-xs text-muted">
                      {post.authorName}
                      {post.publishedAt ? ` · ${formatDate(post.publishedAt)}` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {result.totalPages > 1 ? (
            <nav className="mt-10 flex items-center justify-between gap-4" aria-label="Blog pages">
              {page > 1 ? (
                <Link href={`/blog?page=${page - 1}`} className="font-bold text-brand-700 hover:underline">
                  &larr; Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-muted">
                Page {result.page} of {result.totalPages}
              </span>
              {page < result.totalPages ? (
                <Link href={`/blog?page=${page + 1}`} className="font-bold text-brand-700 hover:underline">
                  Older &rarr;
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}
