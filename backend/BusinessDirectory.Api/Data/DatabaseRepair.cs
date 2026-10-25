using Microsoft.Data.SqlClient;
using System.Text.RegularExpressions;

namespace BusinessDirectory.Api.Data;

/// <summary>
/// Applies the one-off scripts in database/sqlserver/repair, which complete a partly-applied
/// migration so that the ordinary DbUp path can take over.
///
///   dotnet run --project backend/BusinessDirectory.Api -- db-repair          (lists them, changes nothing)
///   dotnet run --project backend/BusinessDirectory.Api -- db-repair --apply  (runs them)
///
/// This is not a second migration system, and it deliberately keeps no journal. A repair script is
/// written to be re-runnable -- every statement guarded by an IF OBJECT_ID check -- so running it
/// twice is a no-op and there is nothing to record. Once DbUp's own journal exists, migrations are
/// the only way the schema changes and this folder should stay empty.
///
/// Why it exists at all: the production database had 26 of S0001-S0007's 27 tables. `db-baseline`
/// refuses a partially applied script, which is the right behaviour -- marking one applied when it
/// is not would skip it for ever. So the gap is closed with DDL copied from the migration itself,
/// and then the normal path proceeds. The alternative was to drop and rebuild this project's
/// tables, which works but destroys more than it needs to in a database shared with another
/// application.
///
/// It is additive by construction and by check: a script containing DROP or TRUNCATE is refused
/// before anything runs, so this command can never be the thing that loses data.
/// </summary>
public static class DatabaseRepair
{
    /// <summary>
    /// What must not appear in a repair script. The folder's promise is "only ever adds", and a
    /// reviewer should be able to trust that without reading every file.
    ///
    /// These are anchored at the start of a statement rather than searched for as substrings,
    /// because the first version of this guard was a plain Contains("DELETE ") and it refused the
    /// very first repair script over the words ON DELETE CASCADE in a foreign key -- which adds a
    /// constraint and deletes nothing. The second pattern then catches the inline form, so
    /// `ALTER TABLE x DROP CONSTRAINT y` is still refused while `ALTER TABLE x ADD ...` is allowed.
    /// </summary>
    private static readonly (string Label, Regex Pattern)[] Forbidden =
    [
        ("a DROP / TRUNCATE / DELETE / UPDATE / MERGE statement",
            new Regex(@"^\s*(DROP|TRUNCATE|DELETE|UPDATE|MERGE)\s",
                      RegexOptions.Multiline | RegexOptions.IgnoreCase)),
        ("an inline DROP of a table, column, constraint or index",
            new Regex(@"\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|VIEW|PROCEDURE|FUNCTION|TRIGGER)\b",
                      RegexOptions.IgnoreCase)),
    ];

    public static int Run(IConfiguration configuration, string contentRoot, string[] args)
    {
        var apply = args.Contains("--apply", StringComparer.OrdinalIgnoreCase);

        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            Console.Error.WriteLine("No ConnectionStrings:Default is configured.");
            return 2;
        }

        var repairPath = configuration["Database:RepairPath"]
            ?? MigrationRunner.FindDirectory(contentRoot, "database", "sqlserver", "repair");
        if (repairPath is null || !Directory.Exists(repairPath))
        {
            Console.Error.WriteLine("Repair folder not found. Set Database:RepairPath.");
            return 2;
        }

        var files = Directory.GetFiles(repairPath, "*.sql")
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToArray();

        var builder = new SqlConnectionStringBuilder(connectionString);
        Console.WriteLine($"Target: {builder.DataSource}/{builder.InitialCatalog}");
        Console.WriteLine(apply ? "Mode:   APPLY" : "Mode:   report only (no changes)");
        Console.WriteLine();

        if (files.Length == 0)
        {
            Console.WriteLine("No repair scripts. Nothing to do -- which is the intended steady state.");
            return 0;
        }

        // Checked before connecting, so a destructive script is refused without even opening a
        // connection to the database it would have damaged.
        foreach (var file in files)
        {
            var text = File.ReadAllText(file);
            var hit = Forbidden.FirstOrDefault(f => f.Pattern.IsMatch(text)).Label;
            if (hit is not null)
            {
                Console.Error.WriteLine($"Refusing to run {Path.GetFileName(file)}: it contains {hit}.");
                Console.Error.WriteLine("Repair scripts may only add. Put a destructive change in a migration instead.");
                return 1;
            }
            Console.WriteLine($"  {Path.GetFileName(file),-34} additive, {MigrationRunner.SplitBatches(text).Count()} batch(es)");
        }
        Console.WriteLine();

        if (!apply)
        {
            Console.WriteLine($"Would run {files.Length} script(s). Nothing was changed. Re-run with --apply.");
            return 0;
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

        foreach (var file in files)
        {
            var name = Path.GetFileName(file);

            // One transaction per script, the same granularity DbUp uses for migrations: a script
            // either happened or it did not.
            using var transaction = connection.BeginTransaction();
            try
            {
                var batches = 0;
                foreach (var batch in MigrationRunner.SplitBatches(File.ReadAllText(file)))
                {
                    using var command = new SqlCommand(batch, connection, transaction) { CommandTimeout = 300 };
                    command.ExecuteNonQuery();
                    batches++;
                }
                transaction.Commit();
                Console.WriteLine($"  applied  {name} ({batches} batch(es))");
            }
            catch (SqlException ex)
            {
                transaction.Rollback();
                Console.Error.WriteLine($"  FAILED   {name}: {ex.Message}");
                Console.Error.WriteLine("Rolled back. Nothing from this script was kept.");
                return 1;
            }
        }

        Console.WriteLine();
        Console.WriteLine("Repair complete. Next: `npm run db:baseline -- --apply`, then `npm run db:migrate`.");
        return 0;
    }
}
