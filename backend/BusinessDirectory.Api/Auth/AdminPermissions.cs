namespace BusinessDirectory.Api.Auth;

/// <summary>
/// The permission codes seeded by database/sqlserver/seeds/reference/R003_roles_permissions.sql, split by which
/// surface may check them. Endpoints name a constant from here instead of a loose string, so a typo is a
/// build error rather than a permission that silently never matches.
///
/// The split matters: the ordinary admin surface (/api/v1/admin) must never gate on a super-admin
/// permission, because that would make a super-admin-only capability reachable with an admin token.
/// Super-admin work belongs on /api/v1/super-admin with its own token audience.
/// </summary>
public static class AdminPermissions
{
    // ---- ordinary admin work
    public const string ListingsView = "listings.view";
    public const string ListingsReview = "listings.review";
    public const string ListingsVerify = "listings.verify";
    public const string ReportsHandle = "reports.handle";
    public const string UsersView = "users.view";

    /// <summary>
    /// Categories, subcategories and localities: the lists every listing and every public URL is
    /// built from. Day-to-day admin work, but its own permission so it can be withheld from a
    /// moderator who should only triage the queue.
    /// </summary>
    public const string TaxonomyManage = "taxonomy.manage";

    /// <summary>
    /// Writing to an owner to ask them to correct something. On the admin surface because it is the
    /// natural end of reviewing a listing: the admin who finds the wrong phone number is the one who
    /// should be able to say so, and the alternative — rejecting the listing — is a blunter tool.
    /// </summary>
    public const string ListingsAlert = "listings.alert";

    /// <summary>
    /// Page titles, descriptions and indexing (S0021). Admin work: writing a page title is the same
    /// kind of editorial judgement an admin already applies to categories and localities, and making
    /// every title change wait on a super admin would mean most of them never happen.
    /// </summary>
    public const string SeoManage = "seo.manage";

    /// <summary>Writing and publishing blog posts (S0023). Editorial work, so admin.</summary>
    public const string BlogManage = "blog.manage";

    // ---- super-admin only (listed so the separation is visible in one place; not checked here)
    /* Writing listings lives here rather than on the admin surface. An admin reviews what owners
       submit and nothing more -- approve, reject, suspend, reinstate. Adding a business by hand,
       correcting its details and removing it are platform work, so they are reachable only with a
       super-admin token: Authorize() refuses these codes on /api/v1/admin even to an account that
       holds them. */
    public const string ListingsCreate = "listings.create";
    public const string ListingsEdit = "listings.edit";
    public const string ListingsDelete = "listings.delete";

    /// <summary>
    /// Choosing which businesses the homepage recommends. Super-admin only, because it is not
    /// moderation: it decides what the platform puts its own name behind, and it is the one shelf a
    /// business would pay or ask to be on. Trending is beside it on the same page and cannot be
    /// chosen by anyone — it is counted from what visitors actually did.
    /// </summary>
    public const string ListingsFeature = "listings.feature";

    public const string AnalyticsView = "analytics.view";
    public const string DataExport = "data.export";
    public const string PlansManage = "plans.manage";
    public const string AdminsManage = "admins.manage";
    public const string AuditView = "audit.view";

    /// <summary>Permissions an /api/v1/admin endpoint is allowed to require.</summary>
    public static readonly string[] AdminSurface =
    [
        ListingsView, ListingsReview, ListingsVerify, ListingsAlert,
        ReportsHandle, UsersView, TaxonomyManage, SeoManage, BlogManage,
    ];

    /// <summary>Permissions reserved for the super-admin surface.</summary>
    public static readonly string[] SuperAdminOnly =
    [
        ListingsCreate, ListingsEdit, ListingsDelete, ListingsFeature,
        AnalyticsView, DataExport, PlansManage, AdminsManage, AuditView,
    ];

    /// <summary>Guards the rule above at the point of use, so a mistake shows up as a failing test, not a hole.</summary>
    public static bool IsAdminSurface(string permission) => AdminSurface.Contains(permission);
}
