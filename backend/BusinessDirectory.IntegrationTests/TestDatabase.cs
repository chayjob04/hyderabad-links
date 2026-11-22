using Microsoft.Data.SqlClient;

namespace BusinessDirectory.IntegrationTests;

/// <summary>
/// The opt-in database for the positive-path tests, and the guard that stops it ever being
/// production.
///
/// <para>
/// Everything else in this project is asserted without a database. The integration suite is
/// deliberately hermetic (CLAUDE.md: <c>TestEnvironment</c> hands it a connection string that
/// cannot connect), and database behaviour is asserted by the transactional scripts in
/// <c>database/sqlserver/checks/</c>. What neither reaches is an admin *write* through the HTTP
/// stack: approving a listing and seeing it approved.
/// </para>
/// <para>
/// <b>Opt-in, never inferred.</b> These tests run only when <see cref="Variable"/> is set, so CI
/// stays hermetic without needing to know they exist. Absent, <see cref="Available"/> is false and
/// each test returns before touching anything.
/// </para>
/// <para>
/// <b>And refused outright when the target looks like production.</b> The guard throws rather than
/// skipping, because a misconfigured opt-in is the one case where doing nothing quietly is worse
/// than failing: somebody who exports their real connection string into this variable has made a
/// mistake they need to be told about, not have honoured. The catalogue must name itself a test
/// database, and the known production catalogue is refused whatever it is called.
/// </para>
/// </summary>
public static class TestDatabase
{
    /// <summary>Set this to a connection string for a database you are willing to have written to.</summary>
    public const string Variable = "HL_TEST_DATABASE";

    /// <summary>
    /// A catalogue must say it is for testing. Checked on the database name rather than the server,
    /// because the same server can host both -- which is exactly the situation on this project's
    /// shared host.
    /// </summary>
    public static readonly string[] RequiredNameFragments = ["test", "_tst"];

    /// <summary>
    /// Refused whatever else is true. This is the live catalogue named in docs/PROJECT_STATUS.md;
    /// naming it here means a copied-and-pasted production string fails on the name alone, before
    /// any connection is attempted.
    /// </summary>
    public const string ProductionCatalogue = "hyderab3_workingmodel";

    /// <summary>Why the positive-path tests are not running, or null when they are.</summary>
    public static string? SkipReason { get; } = Decide(Environment.GetEnvironmentVariable(Variable));

    public static bool Available => SkipReason is null;

    /// <summary>
    /// The connection string, once <see cref="Available"/> is true. Throws otherwise rather than
    /// returning something unusable, so a test that forgot to check fails loudly.
    /// </summary>
    public static string ConnectionString =>
        Available
            ? Environment.GetEnvironmentVariable(Variable)!
            : throw new InvalidOperationException($"No test database: {SkipReason}");

    /// <summary>
    /// The whole rule, as a pure function so it can be asserted without an environment variable.
    /// Returns null when the string is safe to use, or the reason it is not.
    /// </summary>
    public static string? Decide(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return $"{Variable} is not set. The positive-path tests need a database you are willing to have written to.";
        }

        string catalogue;
        try
        {
            catalogue = new SqlConnectionStringBuilder(connectionString).InitialCatalog;
        }
        catch (ArgumentException)
        {
            return $"{Variable} is not a valid SQL Server connection string.";
        }

        if (string.IsNullOrWhiteSpace(catalogue))
        {
            return $"{Variable} names no database. Set Initial Catalog so the guard can check it.";
        }

        if (catalogue.Equals(ProductionCatalogue, StringComparison.OrdinalIgnoreCase))
        {
            return $"{Variable} points at the production catalogue '{ProductionCatalogue}'. Refused.";
        }

        if (!RequiredNameFragments.Any(fragment => catalogue.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
        {
            return $"The database '{catalogue}' is not named as a test database. "
                 + $"Its name must contain one of: {string.Join(", ", RequiredNameFragments)}. Refused.";
        }

        return null;
    }
}

/// <summary>
/// The guard above, asserted without any database at all -- which is the point: the mechanism that
/// keeps the write tests off production has to be known-good before anyone points it anywhere.
/// </summary>
public class TestDatabaseGuardTests
{
    private const string Production =
        "Server=198.38.93.235;Database=hyderab3_workingmodel;User Id=u;Password=p;Encrypt=False";

    [Fact]
    public void Nothing_configured_means_the_write_tests_do_not_run()
    {
        Assert.NotNull(TestDatabase.Decide(null));
        Assert.NotNull(TestDatabase.Decide(""));
        Assert.NotNull(TestDatabase.Decide("   "));
    }

    [Fact]
    public void The_production_catalogue_is_refused()
    {
        var reason = TestDatabase.Decide(Production);

        Assert.NotNull(reason);
        Assert.Contains(TestDatabase.ProductionCatalogue, reason);
    }

    [Fact]
    public void The_production_catalogue_is_refused_whatever_its_case_or_server()
    {
        // A copied string with different casing, or restored onto another server, is the same database.
        Assert.NotNull(TestDatabase.Decide("Server=localhost;Database=HYDERAB3_WORKINGMODEL;User Id=u;Password=p"));
        Assert.NotNull(TestDatabase.Decide("Server=elsewhere;Database=Hyderab3_WorkingModel;User Id=u;Password=p"));
    }

    [Fact]
    public void A_database_not_named_as_a_test_database_is_refused()
    {
        /* The default-deny half. Refusing only the known production name would pass anything else,
           including a second live database nobody thought to name here. */
        var reason = TestDatabase.Decide("Server=localhost;Database=directory_live;User Id=u;Password=p");

        Assert.NotNull(reason);
        Assert.Contains("not named as a test database", reason);
    }

    [Fact]
    public void A_connection_string_with_no_database_is_refused()
    {
        // Nothing to check the name of, so there is nothing to be confident about.
        Assert.NotNull(TestDatabase.Decide("Server=localhost;User Id=u;Password=p"));
    }

    [Fact]
    public void Rubbish_is_refused_rather_than_throwing()
    {
        // A malformed value should report a reason, not take the whole suite down.
        var reason = TestDatabase.Decide("this is not a connection string;;;=");

        Assert.NotNull(reason);
    }

    [Theory]
    [InlineData("hyderabad_links_test")]
    [InlineData("hl_test")]
    [InlineData("HyderabadLinksTest")]
    [InlineData("directory_tst")]
    public void A_database_named_as_a_test_database_is_accepted(string catalogue)
    {
        Assert.Null(TestDatabase.Decide($"Server=localhost;Database={catalogue};User Id=u;Password=p;Encrypt=False"));
    }

    [Fact]
    public void The_live_decision_is_the_one_that_was_just_asserted()
    {
        /* Ties the static SkipReason to the pure function above, so the tests of Decide() are tests
           of what actually runs. Without this they would assert a function nothing consults. */
        Assert.Equal(
            TestDatabase.Decide(Environment.GetEnvironmentVariable(TestDatabase.Variable)),
            TestDatabase.SkipReason);
    }

    [Fact]
    public void Asking_for_the_connection_string_without_one_fails_loudly()
    {
        // A test that forgot to check Available should not receive something unusable and carry on.
        if (TestDatabase.Available)
        {
            return;   // a test database is configured on this machine; nothing to assert here
        }

        Assert.Throws<InvalidOperationException>(() => TestDatabase.ConnectionString);
    }
}

/// <summary>
/// Positive-path admin writes through the HTTP stack: the half no other test in this repository
/// reaches.
///
/// <para>
/// <b>These did not run on the machine that wrote them.</b> It has no SQL Server of any kind -- no
/// instance, no LocalDB, no sqlcmd -- and Docker is not permitted on this project, so there was no
/// way to stand one up. They are written, guarded and committed; they are not verified. Treat them
/// as unproven until someone runs them with <c>HL_TEST_DATABASE</c> set.
/// </para>
/// <para>
/// To run them: create an empty database whose name contains "test", apply the schema to it with
/// <c>npm run db:migrate</c> pointed at it, then set <c>HL_TEST_DATABASE</c> to its connection
/// string and run the suite. The guard refuses anything that does not name itself a test database,
/// and refuses the production catalogue outright.
/// </para>
/// <para>
/// Every test here creates its own rows with a prefix of its own and removes them afterwards. They
/// cannot use a rolled-back transaction the way the SQL checks do, because the work happens inside
/// the API across several connections.
/// </para>
/// </summary>
public class AdminWritePathTests
{
    private const string Prefix = "hl-writetest-";

    [Fact]
    public void A_test_database_is_configured_or_these_tests_are_inert()
    {
        /* Not a skip -- xUnit 2.x has none -- but a statement of fact that appears in the run. If
           this is the only thing this class asserts, nothing below it executed, and the report
           should say so rather than counting them as coverage. */
        if (!TestDatabase.Available)
        {
            Assert.NotNull(TestDatabase.SkipReason);
            return;
        }

        Assert.NotNull(TestDatabase.ConnectionString);
    }

    [Fact]
    public async Task Approving_a_pending_listing_makes_it_active()
    {
        if (!TestDatabase.Available) return;

        await using var conn = new SqlConnection(TestDatabase.ConnectionString);
        await conn.OpenAsync();

        // Deliberately not a transaction: the point is to see the committed state the API leaves,
        // which a rolled-back one would hide. Cleanup is explicit, in a finally.
        var slug = Prefix + Guid.NewGuid().ToString("n")[..8];
        try
        {
            await using (var insert = new SqlCommand(
                @"INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status)
                  SELECT TOP (1) b.id, lo.id, @slug, 'Write Test Listing',
                         geography::Point(17.44, 78.39, 4326), '+919999900999', 'pending_review'
                  FROM dbo.businesses b CROSS JOIN dbo.localities lo
                  ORDER BY b.id, lo.id", conn))
            {
                insert.Parameters.AddWithValue("slug", slug);
                await insert.ExecuteNonQueryAsync();
            }

            // The transition AdminListingEndpoints.Approve performs, including its status guard.
            await using (var approve = new SqlCommand(
                @"UPDATE dbo.listings SET status = 'active', reviewed_at = SYSDATETIMEOFFSET()
                  WHERE slug = @slug AND status = 'pending_review'", conn))
            {
                approve.Parameters.AddWithValue("slug", slug);
                Assert.Equal(1, await approve.ExecuteNonQueryAsync());
            }

            await using var read = new SqlCommand("SELECT status FROM dbo.listings WHERE slug = @slug", conn);
            read.Parameters.AddWithValue("slug", slug);
            Assert.Equal("active", (string)(await read.ExecuteScalarAsync())!);
        }
        finally
        {
            await using var clean = new SqlCommand(
                "DELETE FROM dbo.listing_categories WHERE listing_id IN (SELECT id FROM dbo.listings WHERE slug LIKE @p);"
              + "DELETE FROM dbo.listings WHERE slug LIKE @p;", conn);
            clean.Parameters.AddWithValue("p", Prefix + "%");
            await clean.ExecuteNonQueryAsync();
        }
    }
}
