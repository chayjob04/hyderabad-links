using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace BusinessDirectory.Api.Data;

/// <summary>
/// Readiness check: can the API reach SQL Server, and is that database actually usable?
///
/// It used to run `SELECT 1` and nothing else. That reported Healthy against a database with no
/// migration journal, no search objects and no reference data at all, while every search returned
/// 500 and the public site showed an error banner. A readiness probe that passes while the product
/// is unusable is worse than no probe, because it answers the first question anyone asks.
///
/// So it now also reports *why* a reachable database is not yet usable:
///
///   Unhealthy  the database cannot be reached, or its schema is missing entirely
///   Degraded   reachable and queryable, but not fully set up (no journal, no search objects,
///              or no reference data) -- the API still serves, so this stays a 200 and the
///              instance is not pulled out of rotation for it
///   Healthy    reachable and set up
///
/// Never leaks error details to callers: the description names which condition failed, never the
/// server, the database or the exception.
/// </summary>
public sealed class DatabaseHealthCheck(IServiceProvider services) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        var database = services.GetService<SqlDatabase>();

        if (database is null)
        {
            return HealthCheckResult.Unhealthy("Database is not configured.");
        }

        bool hasJournal, hasSearchObjects, hasCitiesTable;

        try
        {
            /* OBJECT_ID never fails on a missing object, it returns NULL, so this one statement is
               safe to run against a completely empty database. */
            await using var command = database.CreateCommand(
                @"SELECT CAST(CASE WHEN OBJECT_ID('dbo.SchemaVersions', 'U') IS NULL THEN 0 ELSE 1 END AS bit),
                         CAST(CASE WHEN OBJECT_ID('dbo.hl_similarity')     IS NULL THEN 0 ELSE 1 END AS bit),
                         CAST(CASE WHEN OBJECT_ID('dbo.cities', 'U')       IS NULL THEN 0 ELSE 1 END AS bit)");

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return HealthCheckResult.Unhealthy("Database is unreachable.");
            }

            hasJournal = reader.GetBoolean(0);
            hasSearchObjects = reader.GetBoolean(1);
            hasCitiesTable = reader.GetBoolean(2);
        }
        catch (Exception)
        {
            return HealthCheckResult.Unhealthy("Database is unreachable.");
        }

        if (!hasCitiesTable)
        {
            // No core table: the schema was never applied. Nothing the API does can work.
            return HealthCheckResult.Unhealthy("Database schema is not installed.");
        }

        var problems = new List<string>();
        if (!hasJournal) problems.Add("no migration journal");
        if (!hasSearchObjects) problems.Add("search objects missing");

        /* Counted separately because it needs the table to exist, which is only known above. Reference
           data is what turns a correct schema into a working directory: with no cities, localities or
           categories every public page is empty and every locality URL is a 404. */
        try
        {
            await using var command = database.CreateCommand(
                "SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM cities) THEN 1 ELSE 0 END AS bit)");
            if (await command.ExecuteScalarAsync(cancellationToken) is not true)
            {
                problems.Add("no reference data");
            }
        }
        catch (Exception)
        {
            return HealthCheckResult.Unhealthy("Database is unreachable.");
        }

        return problems.Count == 0
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Degraded($"Database is reachable but not ready: {string.Join(", ", problems)}.");
    }
}
