using BusinessDirectory.Api.Data;
using System.Security.Claims;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Auth;

/// <summary>The signed-in admin, as the database sees them right now.</summary>
public sealed record AdminIdentity(
    long Id,
    string Email,
    string DisplayName,
    IReadOnlyList<string> Roles,
    IReadOnlyList<string> Permissions,
    /// <summary>
    /// True while the account is on a password somebody else chose for it -- set when the account
    /// is created and when a super admin resets its password (S0028). While it is true the two
    /// Authorize methods below refuse everything, so the only thing such a session can reach is the
    /// endpoint that changes the password.
    /// </summary>
    /// <remarks>
    /// Defaults to false so that the many places constructing a fake identity in tests read as
    /// "an ordinary account". The one real caller, <see cref="AdminAccess.Load"/>, always passes
    /// the value it read from the database.
    /// </remarks>
    bool MustChangePassword = false)
{
    public bool Can(string permission) => Permissions.Contains(permission);
}

/// <summary>
/// Turns a validated admin token into the permissions that admin holds *now*. Nothing about
/// permissions travels in the token, so disabling an account or removing a role takes effect on the
/// next request instead of when the token expires.
/// </summary>
public static class AdminAccess
{
    /// <summary>Second JWT scheme: same signing key, but it only accepts the admin audience.</summary>
    public const string Scheme = "AdminBearer";

    /// <summary>Authorization policy name. It pins the scheme, so an owner token cannot satisfy it.</summary>
    public const string Policy = "Admin";

    /// <summary>
    /// The halfway states of an admin sign-in. Each has its own scheme and policy so that a token
    /// issued after the password but before the authenticator code reaches only the endpoint it is
    /// meant for — and fails audience validation on every real admin route.
    /// </summary>
    public const string MfaScheme = "AdminMfaBearer";
    public const string MfaPolicy = "AdminMfa";
    public const string EnrollScheme = "AdminEnrollBearer";
    public const string EnrollPolicy = "AdminEnroll";

    /// <summary>
    /// Platform administration. Its own scheme and policy, accepting only the super-admin audience,
    /// so an ordinary administrator's token never reaches these routes whatever permissions the
    /// account happens to hold.
    /// </summary>
    public const string SuperScheme = "SuperAdminBearer";
    public const string SuperPolicy = "SuperAdmin";

    /* PostgreSQL returned the roles and permissions as two text arrays. SQL Server has no array
       type, so each comes back as one comma-separated string that Load() splits. The subqueries
       replace array_agg(DISTINCT ...) FILTER (WHERE ... IS NOT NULL): STRING_AGG has no DISTINCT and
       no FILTER, and a SELECT DISTINCT inside it says the same thing more plainly anyway.
       An account with no roles yields NULL, which Load() reads as an empty list. */
    private const string LoadSql =
        @"SELECT au.email,
                 au.display_name,
                 au.must_change_password,
                 (SELECT STRING_AGG(x.slug, ',')
                  FROM (SELECT DISTINCT r.slug
                        FROM admin_user_roles aur
                        JOIN roles r ON r.id = aur.role_id
                        WHERE aur.admin_user_id = au.id) x),
                 (SELECT STRING_AGG(x.code, ',')
                  FROM (SELECT DISTINCT p.code
                        FROM admin_user_roles aur
                        JOIN role_permissions rp ON rp.role_id = aur.role_id
                        JOIN permissions p ON p.id = rp.permission_id
                        WHERE aur.admin_user_id = au.id) x)
          FROM admin_users au
          WHERE au.id = @id AND au.status = 'active'";

    /// <summary>
    /// Reads one of the comma-separated lists above. Null means the account holds none, which is an
    /// empty list rather than a missing one: a signed-in admin with no role is a real state.
    /// </summary>
    private static string[] SplitList(SqlDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? [] : reader.GetString(ordinal).Split(',', StringSplitOptions.RemoveEmptyEntries);

    public static bool TryGetAdminId(ClaimsPrincipal principal, out long adminUserId)
    {
        var sub = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        return long.TryParse(sub, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out adminUserId);
    }

    /// <summary>
    /// Whether this account holds <c>admins.manage</c>, asked inside the caller's own transaction.
    /// Used when a session is opened, to decide whether to mint a super-admin token alongside the
    /// admin one. Read from the database rather than from the token, like every other permission.
    /// </summary>
    public static async Task<bool> HoldsSuperAdmin(
        SqlConnection conn, SqlTransaction? tx, long adminUserId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT TOP (1) 1
              FROM admin_user_roles aur
              JOIN role_permissions rp ON rp.role_id = aur.role_id
              JOIN permissions p ON p.id = rp.permission_id
              WHERE aur.admin_user_id = @id AND p.code = @permission", conn, tx);
        command.Parameters.AddWithValue("id", adminUserId);
        command.Parameters.AddWithValue("permission", AdminPermissions.AdminsManage);
        return await command.ExecuteScalarAsync(ct) is not null;
    }

    /// <summary>Returns null when the token's subject is not an active admin any more.</summary>
    public static async Task<AdminIdentity?> Load(SqlDatabase db, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (!TryGetAdminId(principal, out var adminUserId))
        {
            return null;
        }

        await using var command = db.CreateCommand(LoadSql);
        command.Parameters.AddWithValue("id", adminUserId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new AdminIdentity(
            adminUserId,
            reader.GetString(0),
            reader.GetString(1),
            SplitList(reader, 3),
            SplitList(reader, 4),
            MustChangePassword: reader.GetBoolean(2));
    }

    /// <summary>
    /// Returns null when the admin may go ahead, or the response to send back when they may not.
    /// A permission reserved for the super-admin surface is refused here even to someone who holds it:
    /// that capability must be reached with a super-admin token, not an admin one.
    /// </summary>
    /// <summary>
    /// The refusal every permission check starts with: an account still carrying a password
    /// somebody else chose for it may do nothing until it chooses its own (S0028).
    ///
    /// It sits here, in the two gates, rather than in each handler, because here it cannot be
    /// forgotten. The password-change endpoint deliberately does not call these methods -- it needs
    /// no permission, since you can only ever change your own password -- so it stays reachable
    /// while everything else is closed. MFA is untouched: this is checked after a session exists,
    /// and a session only exists once the authenticator code was accepted.
    /// </summary>
    private static IResult? PasswordChangeRequired(AdminIdentity admin) =>
        admin.MustChangePassword
            ? Results.Problem(
                "Change your password before continuing.",
                statusCode: StatusCodes.Status403Forbidden,
                title: "Password change required")
            : null;

    public static IResult? Authorize(AdminIdentity admin, string permission)
    {
        if (PasswordChangeRequired(admin) is { } mustChange)
        {
            return mustChange;
        }

        if (!AdminPermissions.IsAdminSurface(permission) || !admin.Can(permission))
        {
            return Results.Problem("You do not have permission to do that.", statusCode: StatusCodes.Status403Forbidden);
        }
        return null;
    }

    /// <summary>
    /// The same check for the super-admin surface, and the mirror image of the rule above: only a
    /// permission reserved for that surface may be required here. The audience has already been
    /// validated by the scheme; this is the second gate, read live from the database.
    /// </summary>
    public static IResult? AuthorizeSuper(AdminIdentity admin, string permission)
    {
        if (PasswordChangeRequired(admin) is { } mustChange)
        {
            return mustChange;
        }

        /* Note the failure mode this has, which cost an afternoon on 2026-11-07: a handler that
           names a permission from the *other* surface is refused here identically to an account
           that simply does not hold it. /api/v1/super-admin/accounts required `users.view`, which
           was on the admin list, so it answered "You do not have permission to do that" to a super
           admin holding every permission there is — for ever, and with every test green, because a
           permanent refusal is indistinguishable from a real one.

           Refusing is still the right behaviour: nothing is performed either way, which is the
           defence this guard exists for. What is missing is a test that ties each endpoint to the
           permission it names; the list-based tests in AdminPermissionSurfaceTests cannot see it. */
        if (!AdminPermissions.SuperAdminOnly.Contains(permission) || !admin.Can(permission))
        {
            return Results.Problem("You do not have permission to do that.", statusCode: StatusCodes.Status403Forbidden);
        }
        return null;
    }
}
