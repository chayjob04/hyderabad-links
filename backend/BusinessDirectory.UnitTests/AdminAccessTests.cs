using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Endpoints;

namespace BusinessDirectory.UnitTests;

public class AdminPermissionsTests
{
    [Fact]
    public void The_two_surfaces_never_share_a_permission()
    {
        // The whole point of the split: nothing an admin may check is also a super-admin capability.
        Assert.Empty(AdminPermissions.AdminSurface.Intersect(AdminPermissions.SuperAdminOnly));
    }

    [Fact]
    public void Every_seeded_permission_belongs_to_exactly_one_surface()
    {
        // Mirrors database/sqlserver/seeds/reference/R003_roles_permissions.sql. A new permission added to the seed
        // without being placed on a surface should fail here rather than be silently unreachable.
        string[] seeded =
        [
            "listings.view", "listings.create", "listings.edit", "listings.delete", "listings.review",
            "listings.verify", "listings.alert", "listings.feature",
            "reports.handle", "users.view", "taxonomy.manage",
            "seo.manage", "blog.manage", "analytics.view",
            "data.export", "plans.manage", "admins.manage", "audit.view",
        ];

        Assert.Equal(
            seeded.OrderBy(p => p, StringComparer.Ordinal),
            AdminPermissions.AdminSurface.Concat(AdminPermissions.SuperAdminOnly).OrderBy(p => p, StringComparer.Ordinal));
    }

    [Fact]
    public void An_admin_may_write_to_an_owner_but_may_not_choose_the_homepage()
    {
        /* The S0017 split, asserted on both sides. Asking an owner to fix a wrong phone number is
           the natural end of moderating a listing, so it is admin work. Choosing which businesses
           the homepage recommends is not moderation -- it decides what the platform puts its own
           name behind, and it is the one shelf a business would ask to be on -- so it is reserved
           for the super-admin surface, and Authorize() refuses it there even to an account that
           somehow holds the code. */
        Assert.True(AdminPermissions.IsAdminSurface(AdminPermissions.ListingsAlert));
        Assert.False(AdminPermissions.IsAdminSurface(AdminPermissions.ListingsFeature));
        Assert.Contains(AdminPermissions.ListingsFeature, AdminPermissions.SuperAdminOnly);
        Assert.DoesNotContain(AdminPermissions.ListingsAlert, AdminPermissions.SuperAdminOnly);
    }

    [Fact]
    public void Super_admin_permissions_are_not_part_of_the_admin_surface()
    {
        Assert.False(AdminPermissions.IsAdminSurface(AdminPermissions.AdminsManage));
        Assert.False(AdminPermissions.IsAdminSurface(AdminPermissions.AuditView));
        Assert.True(AdminPermissions.IsAdminSurface(AdminPermissions.ListingsReview));
    }

    [Fact]
    public void Writing_a_listing_is_not_reachable_from_the_admin_surface()
    {
        /* The point of moving these: an admin reviews what owners submit, and nothing more. Even an
           account that somehow holds listings.edit cannot use it on /api/v1/admin, because
           Authorize() refuses any code that is not on the admin surface. */
        Assert.False(AdminPermissions.IsAdminSurface(AdminPermissions.ListingsCreate));
        Assert.False(AdminPermissions.IsAdminSurface(AdminPermissions.ListingsEdit));
        Assert.False(AdminPermissions.IsAdminSurface(AdminPermissions.ListingsDelete));

        // Keeping the taxonomy tidy is day-to-day admin work, so it stays on the admin surface.
        Assert.True(AdminPermissions.IsAdminSurface(AdminPermissions.TaxonomyManage));
        Assert.DoesNotContain(AdminPermissions.TaxonomyManage, AdminPermissions.SuperAdminOnly);
    }
}

public class AdminAuthorizeTests
{
    private static AdminIdentity Admin(params string[] permissions) =>
        new(7, "admin@example.com", "Admin Person", ["admin"], permissions);

    [Fact]
    public void An_admin_who_holds_the_permission_may_go_ahead()
    {
        Assert.Null(AdminAccess.Authorize(Admin(AdminPermissions.ListingsReview), AdminPermissions.ListingsReview));
    }

    [Fact]
    public void An_admin_without_the_permission_is_refused()
    {
        Assert.NotNull(AdminAccess.Authorize(Admin(AdminPermissions.ListingsView), AdminPermissions.ListingsReview));
    }

    [Fact]
    public void An_admin_with_no_roles_at_all_is_refused()
    {
        Assert.NotNull(AdminAccess.Authorize(Admin(), AdminPermissions.ListingsView));
    }

    [Fact]
    public void A_super_admin_permission_is_refused_on_the_admin_surface_even_when_held()
    {
        // A super-admin signing into the admin site holds every permission, but a super-admin capability
        // must be reached with a super-admin token on /api/v1/super-admin, never with an admin token.
        var superAdmin = Admin(AdminPermissions.ListingsReview, AdminPermissions.AdminsManage, AdminPermissions.AuditView);

        Assert.NotNull(AdminAccess.Authorize(superAdmin, AdminPermissions.AdminsManage));
        Assert.Null(AdminAccess.Authorize(superAdmin, AdminPermissions.ListingsReview));
    }

    [Fact]
    public void Can_reads_the_permissions_loaded_from_the_database()
    {
        var admin = Admin(AdminPermissions.ListingsView);

        Assert.True(admin.Can(AdminPermissions.ListingsView));
        Assert.False(admin.Can(AdminPermissions.ListingsReview));
    }
}

public class AdminEmailTests
{
    [Theory]
    [InlineData("Admin@Example.COM", "admin@example.com")]
    [InlineData("  admin@example.com  ", "admin@example.com")]
    public void Addresses_are_compared_in_lowercase_and_trimmed(string input, string expected)
    {
        Assert.Equal(expected, AdminAuthEndpoints.NormalizeEmail(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("no-at-sign")]
    [InlineData("@example.com")]
    [InlineData("admin@")]
    [InlineData("two@at@example.com")]
    [InlineData("admin example@example.com")]
    public void An_address_that_cannot_be_an_email_is_rejected(string? input)
    {
        Assert.Null(AdminAuthEndpoints.NormalizeEmail(input));
    }

    [Fact]
    public void An_absurdly_long_address_is_rejected()
    {
        Assert.Null(AdminAuthEndpoints.NormalizeEmail(new string('a', 320) + "@example.com"));
    }
}
