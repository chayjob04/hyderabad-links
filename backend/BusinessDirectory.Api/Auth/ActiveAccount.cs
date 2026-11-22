using BusinessDirectory.Api.Data;
using Microsoft.IdentityModel.JsonWebTokens;

namespace BusinessDirectory.Api.Auth;

/// <summary>
/// Refuses a request from a suspended business owner or customer, on every route of their realm.
///
/// <para>
/// <b>Why it is here and not in the queries.</b> An owner's routes scope every statement through
/// <c>business_members</c>, which answers "is this your listing?" and says nothing about whether
/// the account is still allowed to act. Suspension therefore used to take effect only when the
/// access token expired — up to fifteen minutes of full write access after a super admin had
/// stopped the account. Adding <c>AND status = 'active'</c> to a dozen queries would have fixed it
/// in the dozen places somebody remembered; a filter on the two route groups cannot be forgotten by
/// the next endpoint, which is the same argument that put the <c>must_change_password</c> check
/// inside the two admin gates rather than in each handler.
/// </para>
/// <para>
/// <b>What it costs.</b> One indexed lookup by primary key per request. The admin surface already
/// pays exactly this, in <see cref="AdminAccess.Load"/>, and for the same reason: permissions and
/// account state are read from the database on every request so that taking them away takes effect
/// at once rather than when a token runs out.
/// </para>
/// <para>
/// <b>What it answers.</b> 401, not 403. The session is no longer usable at all, so the websites
/// should treat it as ended rather than as this one action being refused — and their proxies then
/// try a refresh, which <see cref="SessionStore.Rotate"/> refuses for a non-active identity, so the
/// browser is signed out instead of looping.
/// </para>
/// <para>
/// Authentication runs before this, so an anonymous or wrongly-signed request never reaches it: the
/// authorization boundary is unchanged and still answers 401 on its own.
/// </para>
/// </summary>
public static class ActiveAccount
{
    /// <summary>
    /// Which table holds the identity, and the statement that asks whether it is still active.
    /// Named rather than inlined so a test can assert both without a database.
    /// </summary>
    public sealed record Realm(string Name, string Table)
    {
        /// <summary>
        /// The id is a parameter, as decision D6 requires. The table name is interpolated and comes
        /// only from the two instances below — nothing from a request reaches it.
        /// </summary>
        public string Sql => $"SELECT TOP (1) 1 FROM {Table} WHERE id = @id AND status = 'active'";
    }

    /* Schema-qualified, for the reason given on SessionStore's two instances: the production
       login's default schema is not `dbo` (decision D58), so an unqualified name resolves there
       first. This statement is the suspension control for every owner and customer route, so a
       same-named table appearing in that schema would answer "still active" for everybody. */
    public static readonly Realm Owner = new("owner", "dbo.users");
    public static readonly Realm Customer = new("customer", "dbo.customers");

    /// <summary>
    /// Adds the check to every route in the group. Applied to <c>/api/v1/me</c> and
    /// <c>/api/v1/customer</c>, which are the whole of both realms' authenticated surface.
    /// </summary>
    public static RouteGroupBuilder RequireActiveAccount(this RouteGroupBuilder group, Realm realm)
    {
        group.AddEndpointFilter(async (context, next) =>
        {
            var subject = context.HttpContext.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
            if (!long.TryParse(
                    subject,
                    System.Globalization.NumberStyles.None,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var id))
            {
                return Results.Unauthorized();
            }

            var db = context.HttpContext.RequestServices.GetRequiredService<SqlDatabase>();
            var ct = context.HttpContext.RequestAborted;

            await using var command = db.CreateCommand(realm.Sql);
            command.Parameters.AddWithValue("id", id);
            if (await command.ExecuteScalarAsync(ct) is null)
            {
                // Suspended, deleted, or a subject id that no longer exists. One answer for all
                // three, so the response says nothing about which.
                return Results.Unauthorized();
            }

            return await next(context);
        });

        return group;
    }
}
