using BusinessDirectory.Api.Auth;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// The rule that makes a temporary password temporary (S0028): while `must_change_password` is set
/// the account may do nothing but change it.
///
/// It is enforced in <see cref="AdminAccess.Authorize"/> and <see cref="AdminAccess.AuthorizeSuper"/>
/// — the two gates every permission-checked endpoint passes through — so these tests are checking
/// the single place the whole rule lives. If somebody later moves the check into the handlers, one
/// forgotten handler is a hole, and these tests would not notice; the comment on the guard says so.
/// </summary>
public class AdminPasswordRotationTests
{
    private static AdminIdentity Admin(bool mustChange, params string[] permissions) =>
        new(1, "admin@example.com", "An Admin", ["admin"], permissions, mustChange);

    [Fact]
    public void An_account_on_a_temporary_password_is_refused_everywhere_on_the_admin_surface()
    {
        var admin = Admin(true, AdminPermissions.ListingsReview);

        var result = AdminAccess.Authorize(admin, AdminPermissions.ListingsReview);

        Assert.NotNull(result);
    }

    [Fact]
    public void And_on_the_super_admin_surface()
    {
        var admin = Admin(true, AdminPermissions.AdminsManage);

        var result = AdminAccess.AuthorizeSuper(admin, AdminPermissions.AdminsManage);

        Assert.NotNull(result);
    }

    [Fact]
    public void Holding_every_permission_does_not_get_past_it()
    {
        // The refusal is not about permissions, so having them all changes nothing.
        var admin = Admin(true, [.. AdminPermissions.AdminSurface]);

        Assert.NotNull(AdminAccess.Authorize(admin, AdminPermissions.ListingsView));
    }

    [Fact]
    public void Once_the_flag_is_cleared_the_same_account_is_allowed_through()
    {
        var admin = Admin(false, AdminPermissions.ListingsReview);

        Assert.Null(AdminAccess.Authorize(admin, AdminPermissions.ListingsReview));
    }

    [Fact]
    public void Clearing_the_flag_does_not_grant_a_permission_the_account_lacks()
    {
        // The guard is additional to the permission check, never a replacement for it.
        var admin = Admin(false, AdminPermissions.ListingsView);

        Assert.NotNull(AdminAccess.Authorize(admin, AdminPermissions.ListingsReview));
    }

    [Fact]
    public void A_super_admin_permission_is_still_refused_on_the_admin_surface()
    {
        // The surface split (D39) is unaffected by any of this.
        var admin = Admin(false, AdminPermissions.AdminsManage);

        Assert.NotNull(AdminAccess.Authorize(admin, AdminPermissions.AdminsManage));
    }

    [Fact]
    public void An_identity_built_without_the_flag_is_not_blocked()
    {
        // The parameter defaults to false, so an older call site means "ordinary account", not
        // "locked out of everything".
        var admin = new AdminIdentity(1, "a@example.com", "A", ["admin"], [AdminPermissions.ListingsView]);

        Assert.False(admin.MustChangePassword);
        Assert.Null(AdminAccess.Authorize(admin, AdminPermissions.ListingsView));
    }

    [Fact]
    public void A_password_that_meets_the_minimum_is_accepted_and_one_that_does_not_is_not()
    {
        Assert.Equal(12, AdminPasswords.MinimumLength);
        Assert.False(AdminPasswords.IsStrongEnough("short"));
        Assert.False(AdminPasswords.IsStrongEnough(new string(' ', 20)));
        Assert.True(AdminPasswords.IsStrongEnough("a-reasonable-passphrase"));
    }

    [Fact]
    public void A_hash_never_contains_the_password_and_verifies_only_against_itself()
    {
        const string password = "a-reasonable-passphrase";
        var hash = AdminPasswords.Hash(password);

        Assert.DoesNotContain(password, hash, StringComparison.Ordinal);
        Assert.True(AdminPasswords.Verify(password, hash));
        Assert.False(AdminPasswords.Verify("a-reasonable-passphras", hash));
        // Two hashes of the same password differ: the salt is per-hash.
        Assert.NotEqual(hash, AdminPasswords.Hash(password));
    }
}
