using DbUp;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Data;

/// <summary>
/// Applies versioned SQL migrations (database/sqlserver/migrations) with DbUp, then the idempotent
/// reference seeds (database/sqlserver/seeds/reference). Run with:
///   dotnet run --project backend/BusinessDirectory.Api -- migrate
/// It is a separate command so the API itself never changes the schema on startup.
///
/// The folder matters: database/migrations holds the original PostgreSQL migrations, kept as history
/// (decision D41). Running one of those against SQL Server would fail on the first statement, and the
/// paths below are what makes sure it is never attempted.
/// </summary>
public static class MigrationRunner
{
    /// <param name="whatIf">
    /// List the migrations that would be applied and change nothing. The deploy workflow runs this
    /// first, so whoever approves the gate can read what is about to happen to the database.
    /// </param>
    public static int Run(IConfiguration configuration, string contentRoot, bool whatIf = false)
    {
        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            Console.Error.WriteLine("No connection string. Set ConnectionStrings:Default (environment variable ConnectionStrings__Default).");
            return 2;
        }

        var migrationsPath = configuration["Database:MigrationsPath"]
            ?? FindDirectory(contentRoot, "database", "sqlserver", "migrations");
        if (migrationsPath is null || !Directory.Exists(migrationsPath))
        {
            Console.Error.WriteLine("Migrations folder not found. Set Database:MigrationsPath.");
            return 2;
        }

        /* Which database this is about to change, named before it changes it — the same thing
           db-check and db-export print, and for the same reason: it is as easy to point this at
           production as at anything else. Only the server and the catalogue come out of the
           builder, never the password. */
        var target = new SqlConnectionStringBuilder(connectionString);
        Console.WriteLine($"Target: {target.DataSource}/{target.InitialCatalog}");

        /* Two passes, because a few things SQL Server will not do inside a transaction.
           CREATE FULLTEXT CATALOG is one of them: attempting it inside one fails outright with
           "cannot be used inside a user transaction".

           Everything else keeps the transaction per script it has always had, so a migration that
           fails halfway leaves nothing behind. The exceptions are named ".notx.sql" and run after
           the rest, without one -- which means a .notx script must not need to run *between* two
           ordinary ones. None does today; if one ever must, it has to be split in two.

           Both passes write to the same journal table, so each script is still recorded once and
           applied once. */
        var transactional = DeployChanges.To
            .SqlDatabase(connectionString)
            /* DbUp's SQL Server provider splits each file on GO, which is what lets a migration
               create a trigger: it has to be the first statement in its batch. The PostgreSQL
               provider had no such notion. */
            .WithScriptsFromFileSystem(migrationsPath, file => !IsNonTransactional(file))
            .WithTransactionPerScript()
            .LogToConsole()
            .Build();

        var nonTransactional = DeployChanges.To
            .SqlDatabase(connectionString)
            .WithScriptsFromFileSystem(migrationsPath, IsNonTransactional)
            .WithoutTransaction()
            .LogToConsole()
            .Build();

        var seedsPath = configuration["Database:ReferenceSeedsPath"]
            ?? FindDirectory(contentRoot, "database", "sqlserver", "seeds", "reference");

        if (whatIf)
        {
            return ReportPending(transactional, nonTransactional, seedsPath);
        }

        var result = transactional.PerformUpgrade();
        if (!result.Successful)
        {
            Console.Error.WriteLine(result.Error);
            return 1;
        }

        result = nonTransactional.PerformUpgrade();
        if (!result.Successful)
        {
            Console.Error.WriteLine(result.Error);
            return 1;
        }

        ApplySeedFiles(connectionString, seedsPath);

        Console.WriteLine("Database is up to date.");
        return 0;
    }

    /// <summary>
    /// Says what `migrate` would do, and does none of it. Reading the journal is the only thing it
    /// touches the database for.
    /// </summary>
    private static int ReportPending(DbUp.Engine.UpgradeEngine transactional, DbUp.Engine.UpgradeEngine nonTransactional, string? seedsPath)
    {
        var pending = transactional.GetScriptsToExecute()
            .Concat(nonTransactional.GetScriptsToExecute())
            .Select(script => Path.GetFileName(script.Name))
            .ToList();

        if (pending.Count == 0)
        {
            Console.WriteLine("No migrations pending.");
        }
        else
        {
            Console.WriteLine($"{pending.Count} migration(s) would be applied:");
            foreach (var name in pending)
            {
                Console.WriteLine($"  {name}");
            }
        }

        /* The seeds are not journalled: every run applies all of them, which is why each one is
           written to be idempotent. Listing them here keeps that visible, because "no migrations
           pending" does not mean "nothing will run". */
        if (seedsPath is not null && Directory.Exists(seedsPath))
        {
            Console.WriteLine("Reference seeds, re-applied on every run:");
            foreach (var file in Directory.GetFiles(seedsPath, "*.sql").OrderBy(f => f, StringComparer.Ordinal))
            {
                Console.WriteLine($"  {Path.GetFileName(file)}");
            }
        }

        return 0;
    }

    /// <summary>Loads DEV-ONLY sample data (database/sqlserver/seeds/dev). Refuses to run unless the environment is Development.</summary>
    public static int SeedDev(IConfiguration configuration, string contentRoot, bool isDevelopment)
    {
        if (!isDevelopment)
        {
            Console.Error.WriteLine("seed-dev only runs in the Development environment.");
            return 3;
        }

        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            Console.Error.WriteLine("No connection string. Set ConnectionStrings:Default.");
            return 2;
        }

        var seedsPath = configuration["Database:DevSeedsPath"] ?? FindDirectory(contentRoot, "database", "sqlserver", "seeds", "dev");
        if (seedsPath is null || !Directory.Exists(seedsPath))
        {
            Console.Error.WriteLine("Dev seeds folder not found.");
            return 2;
        }

        ApplySeedFiles(connectionString, seedsPath);
        Console.WriteLine("Dev sample data loaded.");
        return 0;
    }

    private static void ApplySeedFiles(string connectionString, string? seedsPath)
    {
        if (seedsPath is null || !Directory.Exists(seedsPath))
        {
            return;
        }

        var database = new SqlDatabase(connectionString);
        foreach (var file in Directory.GetFiles(seedsPath, "*.sql").OrderBy(f => f, StringComparer.Ordinal))
        {
            /* Split on GO, as DbUp does for migrations: a seed may need more than one batch, and GO
               is a client instruction rather than something the server understands. */
            foreach (var batch in SplitBatches(File.ReadAllText(file)))
            {
                using var command = database.CreateCommand(batch);
                command.ExecuteNonQuery();
            }
            Console.WriteLine($"Seed applied: {Path.GetFileName(file)}");
        }
    }

    /// <summary>
    /// Whether this migration has to run outside a transaction. Marked by name (".notx.sql") so it
    /// is visible in the folder listing rather than hidden in a list here.
    /// </summary>
    private static bool IsNonTransactional(string path) =>
        Path.GetFileName(path).EndsWith(".notx.sql", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Splits a script on its GO lines. GO is understood by sqlcmd and by DbUp, not by SQL Server, so
    /// anything sending a whole file straight to the server has to do this itself.
    /// </summary>
    public static IEnumerable<string> SplitBatches(string script) =>
        System.Text.RegularExpressions.Regex
            .Split(script, @"^\s*GO\s*$", System.Text.RegularExpressions.RegexOptions.Multiline | System.Text.RegularExpressions.RegexOptions.IgnoreCase)
            .Select(batch => batch.Trim())
            .Where(batch => batch.Length > 0);

    /// <summary>Walks up from <paramref name="start"/> looking for a folder made of the given segments.</summary>
    public static string? FindDirectory(string start, params string[] segments)
    {
        var dir = new DirectoryInfo(start);
        while (dir is not null)
        {
            var candidate = Path.Combine(segments.Prepend(dir.FullName).ToArray());
            if (Directory.Exists(candidate))
            {
                return candidate;
            }
            dir = dir.Parent;
        }
        return null;
    }
}
