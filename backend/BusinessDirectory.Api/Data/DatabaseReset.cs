using Microsoft.Data.SqlClient;
using System.Text.RegularExpressions;

namespace BusinessDirectory.Api.Data;

/// <summary>
/// Removes *this project's* tables from a database it shares with another application, so that
/// `migrate` can build them properly.
///
///   dotnet run --project backend/BusinessDirectory.Api -- db-reset          (reports, changes nothing)
///   dotnet run --project backend/BusinessDirectory.Api -- db-reset --apply  (drops them)
///
/// Why this exists. The production database, hyderab3_workingmodel, holds two unrelated schemas:
/// another application's 58 PascalCase tables and 10 stored procedures, and this project's
/// snake_case tables. Ours were created by something other than database/sqlserver/migrations, and
/// the result only approximates them -- missing category_search_terms, the whole of S0008's search
/// machinery, every trigger, both trigram functions and the full-text index, with different column
/// widths, different timestamp precision and system-generated constraint names. There is no
/// dbo.SchemaVersions, so DbUp has never run.
///
/// db-baseline cannot adopt that: S0001 is only partly applied, and marking it done would freeze
/// every one of those divergences for good. Patching them forward means guessing at a list of
/// differences and being wrong somewhere. Dropping and rebuilding gives a schema that provably
/// matches the migrations, and `db-check` can then prove it -- which is only reasonable because
/// every one of our tables is empty apart from reference rows the seeds recreate.
///
/// The safety that matters here is that it can never reach the other application's data:
///
///   1. **The scope is derived from the migration scripts**, by reading their CREATE TABLE lines.
///      It is never "every table in the database" and never a pattern. A table this project does
///      not create cannot enter the list, so the other 58 are unreachable by construction.
///   2. **It refuses on unexpected rows.** Only `plans` (reference data R004 rewrites) and
///      `otp_challenges` (one-time codes that expire in minutes) may be non-empty. Any other row
///      anywhere in scope stops the whole run, because that would be real data nobody agreed to lose.
///   3. **It refuses if anything outside the scope depends on the scope**, so a foreign key from
///      the other application into our tables stops it rather than being cascaded away.
///   4. **It writes nothing without --apply**, and prints the full plan first either way.
/// </summary>
public static class DatabaseReset
{
    /// <summary>
    /// Tables allowed to hold rows at reset time. `plans` is reference data that R004_plans.sql
    /// writes again; `otp_challenges` holds unverified sign-in codes with a few minutes' life, and
    /// anyone mid-sign-in simply requests another. Everything else must be empty.
    /// </summary>
    private static readonly string[] MayHoldRows = ["plans", "otp_challenges"];

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

        // Rule 1: the scope is whatever the migration scripts create, and nothing else.
        var ours = Directory.GetFiles(migrationsPath, "*.sql")
            .SelectMany(f => TablesCreatedBy(File.ReadAllText(f)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(t => t, StringComparer.Ordinal)
            .ToList();

        if (ours.Count == 0)
        {
            Console.Error.WriteLine("No CREATE TABLE found in the migration scripts. Refusing to guess a scope.");
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

        var builder = new SqlConnectionStringBuilder(connectionString);
        Console.WriteLine($"Target: {builder.DataSource}/{builder.InitialCatalog}");
        Console.WriteLine(apply ? "Mode:   APPLY (will drop the tables listed below)" : "Mode:   report only (no changes)");
        Console.WriteLine();

        Console.WriteLine($"This project's migrations create {ours.Count} table(s). Of those:");

        var present = new List<string>();
        var absent = new List<string>();
        foreach (var table in ours)
        {
            if (ObjectExists(connection, table)) present.Add(table); else absent.Add(table);
        }

        // Rule 2: anything holding rows we did not expect stops the run.
        var unexpected = new List<string>();
        foreach (var table in present)
        {
            var rows = Rows(connection, table);
            var allowed = MayHoldRows.Contains(table, StringComparer.OrdinalIgnoreCase);
            var note = rows switch
            {
                < 0 => "(unreadable)",
                0 => "empty",
                _ when allowed => $"{rows} row(s) -- reference/ephemeral, will be recreated",
                _ => $"{rows} row(s) -- UNEXPECTED",
            };
            Console.WriteLine($"  present  {table,-26} {note}");
            if (rows > 0 && !allowed) unexpected.Add($"{table} ({rows} row(s))");
            if (rows < 0) unexpected.Add($"{table} (row count unreadable)");
        }
        foreach (var table in absent) Console.WriteLine($"  missing  {table,-26} (will be created by migrate)");
        Console.WriteLine();

        if (unexpected.Count > 0)
        {
            Console.Error.WriteLine("Refusing to reset: these hold rows that are not reference or one-time data:");
            foreach (var line in unexpected) Console.Error.WriteLine($"  {line}");
            Console.Error.WriteLine("Export them and decide what should happen to them before resetting.");
            return 1;
        }

        // Rule 3: nothing outside the scope may depend on the scope.
        var intruders = DependenciesFromOutside(connection, present);
        if (intruders.Count > 0)
        {
            Console.Error.WriteLine("Refusing to reset: tables outside this project reference tables inside it:");
            foreach (var line in intruders) Console.Error.WriteLine($"  {line}");
            Console.Error.WriteLine("Dropping ours would damage theirs. This needs a person.");
            return 1;
        }

        Console.WriteLine($"Nothing outside this project's {present.Count} table(s) depends on them.");
        Console.WriteLine();

        if (!apply)
        {
            Console.WriteLine($"Would drop {present.Count} table(s), then `npm run db:migrate` rebuilds all {ours.Count} and seeds reference data.");
            Console.WriteLine("Nothing was changed. Re-run with --apply to do it.");
            return 0;
        }

        var dropped = Drop(connection, present);

        Console.WriteLine();
        Console.WriteLine($"Dropped {dropped} table(s). The other application's tables, procedures and data were not touched.");
        Console.WriteLine("Next: `npm run db:migrate`.");
        return 0;
    }

    /// <summary>
    /// Drops the foreign keys first and then the tables, inside one transaction.
    ///
    /// The two passes are needed because the tables reference each other and SQL Server refuses to
    /// drop a table something still points at; removing every constraint in scope first means the
    /// drop order then does not matter. One transaction because a half-dropped schema is harder to
    /// reason about than either end state -- and `migrate` afterwards would half-skip it.
    /// </summary>
    private static int Drop(SqlConnection connection, List<string> tables)
    {
        using var transaction = connection.BeginTransaction();

        foreach (var table in tables)
        {
            // Named per table, so this reads only constraints on tables already proven in scope.
            using var read = new SqlCommand(
                @"SELECT fk.name FROM sys.foreign_keys fk WHERE fk.parent_object_id = OBJECT_ID(@t)",
                connection, transaction);
            read.Parameters.AddWithValue("t", $"dbo.{table}");

            var names = new List<string>();
            using (var reader = read.ExecuteReader())
            {
                while (reader.Read()) names.Add(reader.GetString(0));
            }

            foreach (var name in names)
            {
                using var drop = new SqlCommand(
                    $"ALTER TABLE [dbo].[{table}] DROP CONSTRAINT [{name}];", connection, transaction);
                drop.ExecuteNonQuery();
            }
        }

        var count = 0;
        foreach (var table in tables)
        {
            using var drop = new SqlCommand($"DROP TABLE [dbo].[{table}];", connection, transaction);
            drop.ExecuteNonQuery();
            Console.WriteLine($"  dropped  {table}");
            count++;
        }

        transaction.Commit();
        return count;
    }

    /// <summary>
    /// Foreign keys whose child table is outside the scope and whose parent is inside it. These are
    /// the ones that would make dropping our tables somebody else's problem.
    /// </summary>
    private static List<string> DependenciesFromOutside(SqlConnection connection, List<string> scope)
    {
        var found = new List<string>();
        using var command = new SqlCommand(
            @"SELECT OBJECT_NAME(fk.parent_object_id)      AS child,
                     OBJECT_NAME(fk.referenced_object_id)  AS parent,
                     fk.name
              FROM sys.foreign_keys fk
              WHERE OBJECT_SCHEMA_NAME(fk.referenced_object_id) = 'dbo'", connection);

        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var child = reader.GetString(0);
            var parent = reader.GetString(1);

            var parentInScope = scope.Contains(parent, StringComparer.OrdinalIgnoreCase);
            var childInScope = scope.Contains(child, StringComparer.OrdinalIgnoreCase);

            if (parentInScope && !childInScope)
            {
                found.Add($"{child} -> {parent} (constraint {reader.GetString(2)})");
            }
        }

        return found;
    }

    private static long Rows(SqlConnection connection, string table)
    {
        try
        {
            using var command = new SqlCommand($"SELECT COUNT_BIG(*) FROM [dbo].[{table}]", connection)
            {
                CommandTimeout = 60,
            };
            return Convert.ToInt64(command.ExecuteScalar());
        }
        catch (SqlException)
        {
            return -1;
        }
    }

    /// <summary>Same rule as DatabaseBaseline: CREATE TABLE at the start of a line, so a mention in
    /// a comment is not picked up.</summary>
    private static List<string> TablesCreatedBy(string sql) =>
        Regex.Matches(sql, @"^\s*CREATE\s+TABLE\s+(?:\[?dbo\]?\.)?\[?([A-Za-z_][A-Za-z0-9_]*)\]?",
                      RegexOptions.Multiline | RegexOptions.IgnoreCase)
            .Select(m => m.Groups[1].Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static bool ObjectExists(SqlConnection connection, string table)
    {
        using var command = new SqlCommand("SELECT OBJECT_ID(@name, 'U')", connection);
        command.Parameters.AddWithValue("name", $"dbo.{table}");
        return command.ExecuteScalar() is not null and not DBNull;
    }
}
