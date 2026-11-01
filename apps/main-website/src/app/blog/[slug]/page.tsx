import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { PageHero } from "@/components/PageHero";
import { BRAND_NAME } from "@/lib/brand";
import { getBlogPost } from "@/lib/api";
import { absoluteUrl } from "@/lib/format";

export const revalidate = 3600;

type Props = { params: Promise<{ slug: string }> };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Per-post metadata, so a shared post arrives with its own title, summary and picture rather than
 * the site's defaults. The excerpt doubles as the description: it is already the one-sentence
 * version of the post, written by hand.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) {
    return { title: "Not found" };
  }

  const url = absoluteUrl(`/blog/${post.slug}`);
  const description = post.excerpt ?? undefined;

  return {
    title: post.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: post.title,
      description,
      url,
      siteName: BRAND_NAME,
      publishedTime: post.publishedAt ?? undefined,
      images: post.coverImageUrl ? [{ url: post.coverImageUrl, alt: post.title }] : undefined,
    },
    twitter: {
      card: post.coverImageUrl ? "summary_large_image" : "summary",
      title: post.title,
      description,
    },
  };
}

/**
 * One post.
 *
 * The body is Markdown rendered to React elements, never to an HTML string — see Markdown.tsx. It
 * is the one place on this site where text written in an admin panel is published verbatim to the
 * public internet, so raw HTML in a post shows as text rather than running.
 */
export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) {
    // A draft answers 404 here too: whether something is being written is not public information.
    notFound();
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt ?? undefined,
    image: post.coverImageUrl ?? undefined,
    datePublished: post.publishedAt ?? undefined,
    author: { "@type": "Person", name: post.authorName },
    publisher: { "@type": "Organization", name: BRAND_NAME },
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
  };

  return (
    <>
      <PageHero
        crumbs={[{ label: "Home", href: "/" }, { label: "Blog", href: "/blog" }, { label: post.title }]}
        title={post.title}
        subtitle={`${post.authorName}${post.publishedAt ? ` · ${formatDate(post.publishedAt)}` : ""}`}
      />

      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      {post.coverImageUrl ? (
        <div className="relative aspect-video overflow-hidden rounded-xl bg-brand-50">
          <Image
            src={post.coverImageUrl}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
            priority
          />
        </div>
      ) : null}

      <article className={post.coverImageUrl ? "mt-8" : undefined}>
        <Markdown source={post.bodyMarkdown} />
      </article>

      <p className="mt-10 border-t border-line pt-6">
        <Link href="/blog" className="font-black text-brand-700 hover:underline">
          <span aria-hidden="true">&larr;</span> More from the blog
        </Link>
      </p>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      </main>
    </>
  );
}
