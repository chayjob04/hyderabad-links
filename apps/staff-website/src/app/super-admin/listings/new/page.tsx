import type { Metadata } from "next";
import { ListingForm } from "@/components/ListingForm";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_LISTINGS_CREATE,
  getCategories,
  getLocalities,
  getProfile,
} from "@/lib/super-admin-api";
import { saveListingAction } from "../actions";

export const metadata: Metadata = { title: "Add a listing" };
export const dynamic = "force-dynamic";

export default async function AddListingPage() {
  const [me, categories, localities] = await Promise.all([getProfile(), getCategories(), getLocalities()]);

  const title = (
    <PageTitle
      title="Add a listing"
      breadcrumb={[{ label: "Listings", href: "/super-admin/listings" }, { label: "Add" }]}
    />
  );

  // The API refuses this anyway; the page only avoids showing a form that would be rejected.
  if (me.ok && !me.data.permissions.includes(PERMISSION_LISTINGS_CREATE)) {
    return (
      <>
        {title}
        <div className="alert alert-light border">
          Your account cannot add listings. It needs the &quot;Add listings manually&quot;
          permission.
        </div>
      </>
    );
  }

  return (
    <>
      {title}

      <div className="row g-3">
        <div className="col-xl-8">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">For a business that phoned in or walked in</h4>
              <p className="card-title-desc mb-3">
                It goes live as soon as you save it: a super admin who may add a listing may also
                publish one, so there is nothing to wait for. A business is listed under a{" "}
                <strong>subcategory</strong> — if the one you need is missing, add it on the admin
                site first.
              </p>

              <ListingForm
                action={saveListingAction.bind(null, null)}
                categories={categories}
                localities={localities}
                initialValues={{}}
                submitLabel="Add and publish"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
