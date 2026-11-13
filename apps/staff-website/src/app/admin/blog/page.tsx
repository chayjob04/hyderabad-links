import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import { PERMISSION_BLOG, formatWhen, getAdminProfile, getBlogPosts } from "@/lib/admin-api";
import { setPublishedAction } from "./actions";

export const metadata: Metadata = { title: "Blog" };

type Props = { searchParams: Promise<{ page?: string; done?: string; error?: string }> };

/**
 * Every post, drafts included. The public list filters on status; this one deliberately does not.
 *
 * On the original's Minia layout: a table of posts in one card, with Write a post beside the page
 * title where the original puts its primary action.
 */
export default async function BlogListPage({ searchParams }: Props) {
  const { page: rawPage, done, error } = await searchParams;
  const parsed = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;

  const [result, me] = await Promise.all([getBlogPosts(page), getAdminProfile()]);
  const mayWrite = me.ok && me.data.permissions.includes(PERMISSION_BLOG);

  return (
    <>
      <PageTitle
        title="Blog"
        breadcrumb={[{ label: "Mixed" }, { label: "Blogs" }]}
        action={
          mayWrite ? (
            <Link href="/admin/blog/new" className="btn btn-primary">
              <i className="bx bx-plus align-middle me-1" /> Write a post
            </Link>
          ) : null
        }
      />

      {done ? (
        <div role="status" className="alert alert-success">
          {done}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
      ) : null}

      <div className="row mb-3">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-1">Posts</h4>
              <p className="card-title-desc mb-3">
                Drafts included. The public list only shows what is published.
              </p>

              {!result.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {result.message}
                </div>
              ) : result.data.items.length === 0 ? (
                <EmptyState icon="bx bx-edit" title="Nothing written yet">
                  A post about a neighbourhood or a kind of business is the sort of page people
                  search for and a listing cannot be.
                </EmptyState>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col">Title</th>
                        <th scope="col">Author</th>
                        <th scope="col">Published</th>
                        <th scope="col">Status</th>
                        {mayWrite ? (
                          <th scope="col" className="text-end">
                            Action
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.items.map((post) => (
                        <tr key={post.id}>
                          <td>
                            <Link href={`/admin/blog/${post.id}`} className="fw-semibold text-body">
                              {post.title}
                            </Link>
                            <span className="d-block text-muted font-size-12">/{post.slug}</span>
                          </td>
                          <td className="text-muted">{post.authorName}</td>
                          <td className="text-muted font-size-13">
                            {post.publishedAt ? formatWhen(post.publishedAt) : "—"}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                post.status === "published"
                                  ? "bg-success-subtle text-success"
                                  : "bg-secondary-subtle text-secondary"
                              }`}
                            >
                              {post.status === "published" ? "Published" : "Draft"}
                            </span>
                          </td>
                          {mayWrite ? (
                            <td className="text-end">
                              <form action={setPublishedAction.bind(null, post.id)}>
                                <button
                                  type="submit"
                                  name="intent"
                                  value={post.status === "published" ? "unpublish" : "publish"}
                                  className="btn btn-sm btn-outline-secondary"
                                >
                                  {post.status === "published" ? "Unpublish" : "Publish"}
                                </button>
                              </form>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!mayWrite ? (
                <div className="alert alert-light border mt-3 mb-0 font-size-13">
                  Your account can read the blog but not write to it. It needs the &quot;Write and
                  publish blog posts&quot; permission.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
