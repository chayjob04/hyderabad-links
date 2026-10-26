using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Data;

/// <summary>
/// Runs the transactional checks in database/sqlserver/checks against whatever
/// ConnectionStrings:Default points at.
///
///   dotnet run --project backend/BusinessDirectory.Api -- db-check
///   dotnet run --project backend/BusinessDirectory.Api -- db-check review
///
/// This replaces a shell script that piped each file into sqlcmd inside a Docker container. The
/// project no longer uses Docker, and a check that can only run against a container is a check that
/// stops running the moment the database moves — which is exactly what happened.
///
/// Each file opens a transaction, asserts, and rolls back, so running this leaves no data behind.
/// It is still a local command rather than a CI one: CI has no database, by design.
/// </summary>
public static class DatabaseChecks
{
    public static int Run(IConfiguration configuration, string contentRoot, string[] args)
    {
        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            Console.Error.WriteLine("No ConnectionStrings:Default is configured.");
            return 1;
        }

        var checksPath = MigrationRunner.FindDirectory(contentRoot, "database", "sqlserver", "checks");
        if (checksPath is null)
        {
            Console.Error.WriteLine("Could not find database/sqlserver/checks.");
            return 1;
        }

        // Anything after the command name narrows the run to matching file names, so a single check
        // can be re-run while working on it without waiting for the rest.
        var filters = args
            .SkipWhile(a => !a.Equals("db-check", StringComparison.OrdinalIgnoreCase))
            .Skip(1)
            .Where(a => !a.StartsWith('-'))
            .ToArray();

        var files = Directory.GetFiles(checksPath, "*.sql")
            .Where(f => filters.Length == 0
                        || filters.Any(x => Path.GetFileName(f).Contains(x, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToArray();

        if (files.Length == 0)
        {
            Console.Error.WriteLine(filters.Length == 0
                ? "No checks found."
                : $"No check matches {string.Join(", ", filters)}.");
            return 1;
        }

        Console.WriteLine($"Running {files.Length} check(s) against {DescribeTarget(connectionString)}.");
        Console.WriteLine();

        var failed = 0;
        foreach (var file in files)
        {
            if (!RunOne(connectionString, file))
            {
                failed++;
            }
        }

        Console.WriteLine();
        Console.WriteLine(failed == 0
            ? $"all {files.Length} database check(s) passed"
            : $"{failed} of {files.Length} database check(s) failed");

        return failed == 0 ? 0 : 1;
    }

    private static bool RunOne(string connectionString, string file)
    {
        var name = Path.GetFileName(file);
        var assertions = 0;
        var reported = new List<string>();

        using var connection = new SqlConnection(connectionString);

        /* The checks say what they are doing with PRINT, which arrives as an info message rather
           than a result set. Without this handler a passing check would be silent and a failing one
           would report only its final error, losing the line that says which assertion failed. */
        connection.InfoMessage += (_, e) =>
        {
            foreach (var line in e.Message.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                var text = line.TrimEnd('\r');
                if (text.StartsWith("ok: ", StringComparison.Ordinal))
                {
                    assertions++;
                }
                else if (text.Length > 0)
                {
                    reported.Add(text);
                }
            }
        };

        try
        {
            connection.Open();

            // Batch by batch on one connection, so the BEGIN TRANSACTION in the first batch and the
            // ROLLBACK in the last are the same transaction.
            foreach (var batch in MigrationRunner.SplitBatches(File.ReadAllText(file)))
            {
                using var command = new SqlCommand(batch, connection) { CommandTimeout = 120 };
                command.ExecuteNonQuery();
            }

            Console.WriteLine($"PASS  {name}  ({assertions} assertions)");
            foreach (var line in reported.Where(l => l.StartsWith("SKIP", StringComparison.Ordinal)))
            {
                Console.WriteLine($"      {line}");
            }
            return true;
        }
        catch (SqlException ex)
        {
            Console.WriteLine($"FAIL  {name}  ({assertions} assertions passed before the failure)");
            foreach (var line in reported)
            {
                Console.WriteLine($"      {line}");
            }
            Console.WriteLine($"      {ex.Message.Trim()}");

            /* A check that threw part-way leaves its transaction open on this connection. The
               connection is disposed immediately below, which rolls it back, but say so plainly:
               "the check failed" and "the check wrote something" are very different problems. */
            Console.WriteLine("      (the transaction was rolled back; the check wrote nothing)");
            return false;
        }
    }

    /// <summary>
    /// Server and database only, never the credentials: this line is printed, and printed output
    /// ends up in terminals, logs and screenshots.
    /// </summary>
    private static string DescribeTarget(string connectionString)
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
