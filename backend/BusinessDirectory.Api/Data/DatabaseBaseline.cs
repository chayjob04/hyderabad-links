using Microsoft.Data.SqlClient;
using System.Text.RegularExpressions;

namespace BusinessDirectory.Api.Data;

/// <summary>
/// Adopts a database whose schema was created outside DbUp.
///
///   dotnet run --project backend/BusinessDirectory.Api -- db-baseline          (reports, changes nothing)
///   dotnet run --project backend/BusinessDirectory.Api -- db-baseline --apply  (writes the journal)
///
/// Why this exists: the production database at the time of writing had the tables from S0001-S0007
/// but no dbo.SchemaVersions, because the scripts were applied by hand rather than by the migration
/// runner. DbUp decides what to run purely from that journal, so with it missing it would start at
/// S0001 and fail on "There is already an object named 'cities'" -- harmlessly, because of the
/// transaction per script, but also pointlessly: nothing would ever be applied again.
///
/// The fix is to record what is already there. Doing that by hand means trusting a human to decide
/// which scripts are "already applied", and marking one that is not applied silently skips it for
/// ever. So this verifies instead of trusting: a script is marked applied only when every table it
/// creates is present. If any is missing it refuses and says which, because a partially applied
/// script needs a person, not a guess.
///
/// It writes nothing without --apply, and refuses outright if a journal already exists: adopting a
/// database that DbUp already manages would be how you lose a migration.
/// </summary>
public static class DatabaseBaseline
{
    /// <summary>DbUp's default journal for .SqlDatabase(connectionString) with no schema argument.</summary>
    private const string JournalTable = "SchemaVersions";
    private const string JournalSchema = "dbo";

    public static int Run(IConfiguration configuration, string contentRoot, string[] args)
    {
        var apply = args.Contains("--apply", StringComparer.OrdinalIgnoreCase);

        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            Console.Error.WriteLine("No ConnectionStrings:Default is configured.");
            return 2;
        }

        var migrationsPath = configuration["Database:MigrationsPath"]
            ?? MigrationRunner.FindDirectory(contentRoot, "database", "sqlserver", "migrations");
        if (migrationsPath is null || !Directory.Exists(migrationsPath))
        {
            Console.Error.WriteLine("Migrations folder not found. Set Database:MigrationsPath.");
            return 2;
        }

        using var connection = new SqlConnection(connectionString);
        try
        {
            connection.Open();
        }
        catch (SqlException ex)
        {
            Console.Error.WriteLine($"Could not connect: {ex.Message}");
            return 1;
        }

        Console.WriteLine($"Target: {Describe(connectionString)}");
        Console.WriteLine(apply ? "Mode:   APPLY (will write the journal)" : "Mode:   report only (no changes)");
        Console.WriteLine();

        ReportState(connection);

        if (JournalExists(connection))
        {
            Console.Error.WriteLine(
                $"[{JournalSchema}].[{JournalTable}] already exists. This database is already managed by DbUp; "
                + "run `npm run db:migrate` instead. Refusing to touch an existing journal.");
            return 1;
        }

        // Only the transactional scripts are candidates. A .notx script (S0008) creates the full-text
        // catalogue and the trigram machinery; if those are missing it genuinely has not run, and
        // marking it applied would leave search permanently broken.
        var candidates = Directory.GetFiles(migrationsPath, "*.sql")
            .Where(f => !Path.GetFileName(f).Contains(".notx.", StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToArray();

        var applied = new List<string>();
        var incomplete = new List<string>();
        var notApplied = new List<string>();

        foreach (var file in candidates)
        {
            var name = Path.GetFileName(file);
            var tables = TablesCreatedBy(File.ReadAllText(file));

            if (tables.Count == 0)
            {
                // Nothing to verify against, so there is no safe way to call it applied.
                notApplied.Add($"{name} (creates no table; cannot verify)");
                continue;
            }

            var present = tables.Where(t => ObjectExists(connection, t)).ToList();

            if (present.Count == tables.Count) applied.Add(name);
            else if (present.Count == 0) notApplied.Add($"{name} (none of its {tables.Count} tables exist)");
            else incomplete.Add($"{name}: has {string.Join(", ", present)}; MISSING {string.Join(", ", tables.Except(present))}");
        }

        foreach (var line in applied) Console.WriteLine($"  already applied   {line}");
        foreach (var line in notApplied) Console.WriteLine($"  not applied       {line}");
        foreach (var line in incomplete) Console.WriteLine($"  PARTIAL           {line}");
        Console.WriteLine();

        if (incomplete.Count > 0)
        {
            Console.Error.WriteLine(
                "Refusing to baseline: the scripts above are partially applied. Some of their tables exist and "
                + "some do not, so neither marking them applied nor letting them re-run is safe. Resolve those "
                + "tables by hand first.");
            return 1;
        }

        if (applied.Count == 0)
        {
            Console.Error.WriteLine("Nothing to baseline: none of the migration scripts' tables are present. "
                                    + "This looks like an empty database -- run `npm run db:migrate` instead.");
            return 1;
        }

        if (!apply)
        {
            Console.WriteLine($"Would create [{JournalSchema}].[{JournalTable}] and record {applied.Count} script(s).");
            Console.WriteLine("Nothing was changed. Re-run with --apply to write it.");
            return 0;
        }

        WriteJournal(connection, applied);

        Console.WriteLine($"Recorded {applied.Count} script(s) in [{JournalSchema}].[{JournalTable}].");
        Console.WriteLine("Next: `npm run db:migrate` will now apply only what is genuinely pending, then the reference seeds.");
        return 0;
    }

    /// <summary>
    /// Everything a person needs before deciding to touch this database: what it is, what is already
    /// there, and how much data is at stake. Printed before any decision is taken, so the report mode
    /// doubles as the pre-flight check and as the inventory of what a backup has to preserve.
    ///
    /// Row counts are the point. "Preserve existing data" is an easy promise to make and a hard one to
    /// check afterwards, so the numbers go on the screen before anything is written.
    /// </summary>
    private static void ReportState(SqlConnection connection)
    {
        Console.WriteLine("Server state");
        foreach (var (label, sql) in new[]
        {
            ("edition", "CAST(SERVERPROPERTY('Edition') AS nvarchar(100))"),
            ("version", "CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50))"),
            // 'CompatibilityLevel', not 'Compatibility' -- the latter is not a property name, and
            // DATABASEPROPERTYEX returns NULL for one it does not recognise rather than erroring,
            // so this line printed blank for a while instead of saying anything was wrong.
            ("compatibility", "CAST(DATABASEPROPERTYEX(DB_NAME(), 'CompatibilityLevel') AS nvarchar(10))"),
            ("full-text installed", "CAST(SERVERPROPERTY('IsFullTextInstalled') AS nvarchar(10))"),
        })
        {
            Console.WriteLine($"  {label,-22} {Scalar(connection, $"SELECT {sql}") ?? "(unknown)"}");
        }

        Console.WriteLine();
        Console.WriteLine("Schema objects");
        foreach (var (label, name, kind) in new[]
        {
            ("migration journal", $"{JournalSchema}.{JournalTable}", "U"),
            ("search_trigrams", "dbo.search_trigrams", "U"),
            ("hl_similarity", "dbo.hl_similarity", null),
            ("hl_trigrams", "dbo.hl_trigrams", null),
        })
        {
            var sql = kind is null
                ? $"SELECT CASE WHEN OBJECT_ID('{name}') IS NULL THEN 'missing' ELSE 'present' END"
                : $"SELECT CASE WHEN OBJECT_ID('{name}', '{kind}') IS NULL THEN 'missing' ELSE 'present' END";
            Console.WriteLine($"  {label,-22} {Scalar(connection, sql)}");
        }

        Console.WriteLine($"  {"full-text catalogues",-22} {Scalar(connection, "SELECT COUNT(*) FROM sys.fulltext_catalogs")}");
        Console.WriteLine($"  {"full-text indexes",-22} {Scalar(connection, "SELECT COUNT(*) FROM sys.fulltext_indexes")}");
        Console.WriteLine($"  {"user tables",-22} {Scalar(connection, "SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped = 0")}");

        Console.WriteLine();
        Console.WriteLine("Rows (what a backup must preserve)");
        foreach (var table in new[]
        {
            "cities", "localities", "categories", "listings", "businesses", "users",
            "plans", "roles", "permissions", "admin_users", "enquiries", "reviews",
        })
        {
            // OBJECT_ID first: a missing table must read as "no table", not blow up the report.
            var count = Scalar(connection,
                $"SELECT CASE WHEN OBJECT_ID('{JournalSchema}.{table}', 'U') IS NULL THEN '(no table)' "
                + $"ELSE CAST((SELECT COUNT_BIG(*) FROM [{JournalSchema}].[{table}]) AS nvarchar(20)) END");
            Console.WriteLine($"  {table,-22} {count}");
        }

        Console.WriteLine();
    }

    /// <summary>One scalar, as text, or null when the statement cannot run. Never throws at the caller.</summary>
    private static string? Scalar(SqlConnection connection, string sql)
    {
        try
        {
            using var command = new SqlCommand(sql, connection) { CommandTimeout = 30 };
            return command.ExecuteScalar()?.ToString();
        }
        catch (SqlException)
        {
            return null;
        }
    }

    /// <summary>
    /// The tables a script creates. Deliberately only matches CREATE TABLE at the start of a line, which
    /// is how every migration here is written, so a mention inside a comment is not picked up.
    /// </summary>
    private static List<string> TablesCreatedBy(string sql) =>
        Regex.Matches(sql, @"^\s*CREATE\s+TABLE\s+(?:\[?dbo\]?\.)?\[?([A-Za-z_][A-Za-z0-9_]*)\]?",
                      RegexOptions.Multiline | RegexOptions.IgnoreCase)
            .Select(m => m.Groups[1].Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static bool ObjectExists(SqlConnection connection, string table)
    {
        using var command = new SqlCommand("SELECT OBJECT_ID(@name, 'U')", connection);
        command.Parameters.AddWithValue("name", $"{JournalSchema}.{table}");
        return command.ExecuteScalar() is not null and not DBNull;
    }

    private static bool JournalExists(SqlConnection connection)
    {
        using var command = new SqlCommand("SELECT OBJECT_ID(@name, 'U')", connection);
        command.Parameters.AddWithValue("name", $"{JournalSchema}.{JournalTable}");
        return command.ExecuteScalar() is not null and not DBNull;
    }

    /// <summary>
    /// Creates the journal in the exact shape DbUp expects and records the scripts. The column types
    /// come from dbup-sqlserver's own CREATE TABLE: ScriptName nvarchar(255), Applied datetime. Getting
    /// these wrong would make DbUp fail on its next run rather than silently misbehave, but there is no
    /// reason to be approximate about it.
    ///
    /// One transaction: a journal holding half the scripts would be worse than none at all.
    /// </summary>
    private static void WriteJournal(SqlConnection connection, List<string> scripts)
    {
        using var transaction = connection.BeginTransaction();

        using (var create = new SqlCommand(
            $@"CREATE TABLE [{JournalSchema}].[{JournalTable}] (
                   [Id]         int IDENTITY(1,1) NOT NULL CONSTRAINT [PK_{JournalTable}_Id] PRIMARY KEY,
                   [ScriptName] nvarchar(255) NOT NULL,
                   [Applied]    datetime NOT NULL
               );", connection, transaction))
        {
            create.ExecuteNonQuery();
        }

        foreach (var script in scripts)
        {
            using var insert = new SqlCommand(
                $"INSERT INTO [{JournalSchema}].[{JournalTable}] ([ScriptName], [Applied]) VALUES (@name, GETDATE());",
                connection, transaction);
            insert.Parameters.AddWithValue("name", script);
            insert.ExecuteNonQuery();
        }

        transaction.Commit();
    }

    /// <summary>Server and database only. This line gets printed, and printed output ends up in screenshots.</summary>
    private static string Describe(string connectionString)
    {
        try
        {
            var builder = new SqlConnectionStringBuilder(connectionString);
            return $"{builder.DataSource}/{builder.InitialCatalog}";
        }
        catch (ArgumentException)
        {
            return "the configured database";
        }
    }
}
