using BusinessDirectory.Api.Auth;

namespace BusinessDirectory.UnitTests;

// Suspending an owner has to do two things at once: stop the sessions they already hold, and stop
// the access token they already hold from working for its remaining minutes. The first is
// SessionStore.RevokeAllFor, the second is the ActiveAccount filter on the route group.
//
// Neither can be asserted end to end here: the integration suite deliberately has no database
// (CLAUDE.md), so the behaviour against real rows is asserted in
// database/sqlserver/checks/account_suspension_smoke.sql. What these tests guard is the part that
// is easiest to break by editing and hardest to notice -- the statements themselves, one of which
// interpolates a table name.
public class AccountSuspensionTests
{
    [Fact]
    public void The_owner_realm_asks_the_users_table_and_the_customer_realm_asks_customers()
    {
        Assert.Equal("dbo.users", ActiveAccount.Owner.Table);
        Assert.Equal("dbo.customers", ActiveAccount.Customer.Table);
    }

    /* Both interpolated table names must carry their schema. On this deployment the production
       login's default schema is not `dbo` (decision D58), so an unqualified name resolves against
       that schema first and only then falls back -- and these two statements are the suspension
       control for every owner and customer route. A table of the same name appearing in the
       login's schema would answer "still active" for every suspended account.

       Asserted as a property of both realms and both stores rather than as four string literals,
       so a new realm or store cannot be added without it. */
    [Theory]
    [MemberData(nameof(Realms))]
    public void Every_realm_names_its_table_with_a_schema(ActiveAccount.Realm realm)
    {
        Assert.StartsWith("dbo.", realm.Table);
        Assert.Contains("FROM dbo.", realm.Sql);
    }

    [Theory]
    [MemberData(nameof(Stores))]
    public void Every_store_names_its_table_with_a_schema(SessionStore store)
    {
        Assert.Contains("UPDATE dbo.", store.RevokeAllSql);
    }

    // The predicate is the control. Deleting it would make the filter a no-op that still looks
    // present on both route groups.
    [Theory]
    [MemberData(nameof(Realms))]
    public void Every_realm_requires_an_active_account(ActiveAccount.Realm realm)
    {
        Assert.Contains("status = 'active'", realm.Sql);
    }

    // Decision D6: values are parameters. The table name is interpolated and comes only from the
    // two static instances; the id must never be.
    [Theory]
    [MemberData(nameof(Realms))]
    public void Every_realm_passes_the_id_as_a_parameter(ActiveAccount.Realm realm)
    {
        Assert.Contains("id = @id", realm.Sql);
    }

    public static TheoryData<ActiveAccount.Realm> Realms => new() { ActiveAccount.Owner, ActiveAccount.Customer };

    [Fact]
    public void Revoking_an_owners_sessions_touches_the_owner_session_table()
    {
        var sql = SessionStore.Owner.RevokeAllSql;

        Assert.Contains("UPDATE dbo.user_sessions", sql);
        Assert.Contains("user_id = @subject", sql);
    }

    [Fact]
    public void Revoking_a_customers_sessions_touches_the_customer_session_table()
    {
        var sql = SessionStore.Customer.RevokeAllSql;

        Assert.Contains("UPDATE dbo.customer_sessions", sql);
        Assert.Contains("customer_id = @subject", sql);
    }

    [Theory]
    [MemberData(nameof(Stores))]
    public void Revoking_stamps_the_time_and_the_reason(SessionStore store)
    {
        Assert.Contains("revoked_at = SYSDATETIMEOFFSET()", store.RevokeAllSql);
        Assert.Contains("revoked_reason = @reason", store.RevokeAllSql);
    }

    // Only the live ones, so a session already revoked keeps the reason it was revoked for -- a
    // reuse_detected row is evidence, and overwriting it with 'suspended' would lose that.
    [Theory]
    [MemberData(nameof(Stores))]
    public void Revoking_leaves_an_already_revoked_session_alone(SessionStore store)
    {
        Assert.Contains("revoked_at IS NULL", store.RevokeAllSql);
    }

    [Theory]
    [MemberData(nameof(Stores))]
    public void Revoking_is_scoped_to_one_subject_and_not_the_whole_table(SessionStore store)
    {
        Assert.Contains("WHERE", store.RevokeAllSql);
        Assert.Contains("@subject", store.RevokeAllSql);
    }

    [Fact]
    public void The_reason_fits_the_column_and_is_the_one_the_endpoint_writes()
    {
        Assert.Equal("suspended", SessionStore.SuspendedReason);
        // revoked_reason is nvarchar(200) in S0003 and S0026.
        Assert.True(SessionStore.SuspendedReason.Length <= 200);
    }

    public static TheoryData<SessionStore> Stores => new() { SessionStore.Owner, SessionStore.Customer };
}
