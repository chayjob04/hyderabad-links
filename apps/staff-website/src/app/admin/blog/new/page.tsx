import type { Metadata } from "next";
import { PageTitle } from "@/components/minia/PageTitle";
import { PostForm } from "../PostForm";

export const metadata: Metadata = { title: "Write a post", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function NewPostPage() {
  return (
    <>
      <PageTitle
        title="Write a post"
        breadcrumb={[{ label: "Blog", href: "/admin/blog" }, { label: "New" }]}
      />

      <div className="row mb-3">
        <div className="col-xl-9">
          <p className="text-muted">
            The web address is made from the title and then fixed, so a published post never moves.
          </p>
          <PostForm postId={null} />
        </div>
      </div>
    </>
  );
}
