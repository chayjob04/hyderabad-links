import type { Metadata } from "next";
import { MiniaStyles } from "@/components/minia/MiniaStyles";
import "./minia-login.css";
import { BRAND_NAME } from "@/lib/brand";
import { safeNextPath } from "@/lib/session";
import { LoginForm } from "./LoginForm";
import { StaffLoginTabs } from "./StaffLoginTabs";
import { readStaffTab } from "./state";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ next?: string; tab?: string }> };

const COPY = {
  admin: {
    heading: "Welcome Back !",
    blurb: `Sign in to the ${BRAND_NAME} Admin panel.`,
    note: "Admin accounts are created for you. There is no sign-up: ask a super admin for an account.",
  },
  super: {
    heading: "Welcome Back !",
    blurb: `Sign in to the ${BRAND_NAME} Super Admin panel.`,
    note: "Only accounts with platform administration access can sign in here. Everyone else uses the Admin tab.",
  },
};

/**
 * The one staff sign-in page, for both surfaces, on the original's split-screen layout.
 *
 * The original had two of these: `Views/Account/Default.cshtml` for admins and
 * `Views/Super/SuperDashboard/Login.cshtml` for super admins. They were the same page twice — same
 * markup, same bubbles, same wordmark — differing in their heading and in one attribute: the
 * super-admin one set `data-bs-theme="dark"` on `<body>`.
 *
 * Both are reproduced here as one page. The tab chooses the words and the colour treatment; the
 * dark theme is scoped to this page's own wrapper rather than the document, which is what makes it
 * possible to have both on one route. Everything else — the form column at `col-xxl-3`, the
 * `auth-bg` panel with its primary overlay and ten floating bubbles, the logo above the form, the
 * copyright under it — is the original's markup, styled by the original's stylesheet.
 *
 * What is **not** carried over, deliberately: the mobile-number field, the Remember me checkbox and
 * the "Forgot password?" link. The first two do not exist in this application's authentication, and
 * the third pointed at a view the original never had.
 *
 * The tab chooses the words, the cookie the session is written to, and where you land. It does not
 * choose what you may do: an account without `admins.manage` picking the super-admin tab is refused
 * after MFA, because the API never issues it a super-admin token. See login/actions.ts.
 */
export default async function LoginPage({ searchParams }: Props) {
  const { next, tab } = await searchParams;
  const active = readStaffTab(tab);
  const copy = COPY[active];

  return (
    <>
      <MiniaStyles />

      {/* The super-admin tab in the theme's dark palette, as the original's super-admin login was.
          Scoped here rather than on <body>, so one route can be both. */}
      <div className="auth-page" data-bs-theme={active === "super" ? "dark" : "light"}>
        <div className="container-fluid p-0">
          <div className="row g-0">
            <div className="col-xxl-3 col-lg-4 col-md-5">
              <div className="auth-full-page-content d-flex p-sm-5 p-4">
                <div className="w-100">
                  <div className="d-flex flex-column h-100">
                    <div className="mb-4 mb-md-5 text-center">
                      <span className="d-block auth-logo">
                        <img src="/assets/admin/images/logo.png" alt="" />
                        <span className="logo-txt ms-2">{BRAND_NAME}</span>
                      </span>
                    </div>

                    <div className="auth-content my-auto">
                      <div className="text-center">
                        <h5 className="mb-0">{copy.heading}</h5>
                        <p className="text-muted mt-2">{copy.blurb}</p>
                      </div>

                      <div className="mt-4 pt-2">
                        <StaffLoginTabs active={active} />
                        <LoginForm next={safeNextPath(active, next)} tab={active} />
                        <p className="text-muted font-size-12 mt-4 mb-0">{copy.note}</p>
                      </div>
                    </div>

                    <div className="mt-4 mt-md-5 text-center">
                      <p className="mb-0 text-muted font-size-13">
                        {/* Rendered on the server. The original wrote this with document.write,
                            which would differ between the server's HTML and the client's. */}
                        © {new Date().getFullYear()} {BRAND_NAME}.com
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-xxl-9 col-lg-8 col-md-7">
              <div className="auth-bg pt-md-5 p-4 d-flex">
                <div className="bg-overlay bg-primary" />
                {/* Ten bubbles, as the original. The theme animates them: `.bg-bubbles li` and the
                    `square` keyframes are both in app.min.css, so the original's inline copy of
                    that CSS was never doing anything. */}
                <ul className="bg-bubbles">
                  {Array.from({ length: 10 }, (_, index) => (
                    <li key={index} />
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
