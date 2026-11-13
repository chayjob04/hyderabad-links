import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/minia/PageTitle";
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
      <>
        <PageTitle title="Edit post" breadcrumb={[{ label: "Blog", href: "/admin/blog" }]} />
        <div role="alert" className="alert alert-danger">
          {result.message}
        </div>
      </>
    );
  }

  const post = result.data;

  return (
    <>
      <PageTitle
        title={post.title}
        breadcrumb={[{ label: "Blog", href: "/admin/blog" }, { label: `/${post.slug}` }]}
      />

      {done ? (
        <div role="status" className="alert alert-success">
          {done}
        </div>
      ) : null}

      <div className="row mb-3">
        <div className="col-xl-9">
          <p className="text-muted">
            /{post.slug} &middot;{" "}
            <span
              className={`badge ${
                post.status === "published"
                  ? "bg-success-subtle text-success"
                  : "bg-secondary-subtle text-secondary"
              }`}
            >
              {post.status === "published" ? "Published" : "Draft"}
            </span>
          </p>
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
      </div>
    </>
  );
}
