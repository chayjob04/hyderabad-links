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

    // ---- super-admin only (listed so the separation is visible in one place; not checked here)
    /* Writing listings lives here rather than on the admin surface. An admin reviews what owners
       submit and nothing more -- approve, reject, suspend, reinstate. Adding a business by hand,
       correcting its details and removing it are platform work, so they are reachable only with a
       super-admin token: Authorize() refuses these codes on /api/v1/admin even to an account that
       holds them. */
    public const string ListingsCreate = "listings.create";
    public const string ListingsEdit = "listings.edit";
    public const string ListingsDelete = "listings.delete";
    public const string AnalyticsView = "analytics.view";
    public const string DataExport = "data.export";
    public const string PlansManage = "plans.manage";
    public const string AdminsManage = "admins.manage";
    public const string AuditView = "audit.view";

    /// <summary>Permissions an /api/v1/admin endpoint is allowed to require.</summary>
    public static readonly string[] AdminSurface =
    [
        ListingsView, ListingsReview, ListingsVerify, ReportsHandle, UsersView, TaxonomyManage,
    ];

    /// <summary>Permissions reserved for the super-admin surface.</summary>
    public static readonly string[] SuperAdminOnly =
    [
        ListingsCreate, ListingsEdit, ListingsDelete,
        AnalyticsView, DataExport, PlansManage, AdminsManage, AuditView,
    ];

    /// <summary>Guards the rule above at the point of use, so a mistake shows up as a failing test, not a hole.</summary>
    public static bool IsAdminSurface(string permission) => AdminSurface.Contains(permission);
}
