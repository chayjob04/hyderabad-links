using Microsoft.Data.SqlClient;
using System.Globalization;
using System.Text;

namespace BusinessDirectory.Api.Data;

/// <summary>
/// Exports the live schema and every row to local files, using nothing but SELECT.
///
///   dotnet run --project backend/BusinessDirectory.Api -- db-export [--out &lt;folder&gt;]
///
/// Why this exists: BACKUP DATABASE needs db_backupoperator or db_owner, which a shared-hosting
/// login usually does not have, so "take a backup before touching anything" can fail at exactly the
/// moment it matters. Reading the catalogue views and the tables themselves needs only the SELECT
/// rights any application login already has, so this works where BACKUP does not.
///
/// It is not a substitute for a real backup of a database with real data in it -- there is no log,
/// no point-in-time, and restoring means running the generated INSERTs by hand. It is enough for
/// what this database currently holds, and it is enough to prove afterwards that nothing was lost.
///
/// Three files, all plain text so they can be read and diffed:
///   schema.txt    tables, columns, keys, indexes and constraints as the server reports them
///   data.sql      INSERT statements for every row, newest-safe ordering not attempted
///   manifest.txt  server, database, timestamp, row counts, and schema vs the migration scripts
/// </summary>
public static class DatabaseExport
{
    public static int Run(IConfiguration configuration, string contentRoot, string[] args)
    {
        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            Console.Error.WriteLine("No ConnectionStrings:Default is configured.");
            return 2;
        }

        var outDir = ArgumentValue(args, "--out")
            ?? Path.Combine(contentRoot, "..", "..", "database", "backups",
                            DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture));
        outDir = Path.GetFullPath(outDir);
        Directory.CreateDirectory(outDir);

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
        Console.WriteLine($"Exporting {builder.DataSource}/{builder.InitialCatalog}");
        Console.WriteLine($"  into {outDir}");
        Console.WriteLine();

        var tables = ReadTableNames(connection);
        Console.WriteLine($"  {tables.Count} user table(s)");

        File.WriteAllText(Path.Combine(outDir, "schema.txt"), BuildSchemaReport(connection, tables));
        Console.WriteLine("  schema.txt written");

        var counts = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        File.WriteAllText(Path.Combine(outDir, "data.sql"), BuildDataScript(connection, tables, counts));
        Console.WriteLine($"  data.sql written ({counts.Values.Sum()} row(s) across {counts.Count(c => c.Value > 0)} non-empty table(s))");

        File.WriteAllText(Path.Combine(outDir, "programmability.sql"), BuildProgrammability(connection));
        Console.WriteLine("  programmability.sql written");

        File.WriteAllText(Path.Combine(outDir, "manifest.txt"),
            BuildManifest(connection, builder, tables, counts, contentRoot, configuration));
        Console.WriteLine("  manifest.txt written");

        Console.WriteLine();
        Console.WriteLine("Export complete. Nothing was modified.");
        return 0;
    }

    private static string? ArgumentValue(string[] args, string name)
    {
        var index = Array.FindIndex(args, a => a.Equals(name, StringComparison.OrdinalIgnoreCase));
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    private static List<string> ReadTableNames(SqlConnection connection)
    {
        return Resilient(connection, () =>
        {
            var names = new List<string>();
            using var command = new SqlCommand(
                "SELECT name FROM sys.tables WHERE is_ms_shipped = 0 ORDER BY name", connection)
            {
                CommandTimeout = 60,
            };
            using var reader = command.ExecuteReader();
            while (reader.Read()) names.Add(reader.GetString(0));
            return names;
        });
    }

    /// <summary>
    /// The schema as the *server* reports it, which is the point: the migration scripts say what was
    /// intended, and this says what is actually there. Comparing the two is how a hand-applied schema
    /// gets verified.
    /// </summary>
    private static string BuildSchemaReport(SqlConnection connection, List<string> tables)
    {
        var text = new StringBuilder();
        text.AppendLine($"-- Live schema, read {DateTime.Now:u}");
        text.AppendLine();

        foreach (var table in tables)
        {
            text.AppendLine($"TABLE {table}");

            Append(connection, text,
                @"SELECT '  ' + c.name + ' ' + t.name
                         + CASE WHEN t.name IN ('varchar','nvarchar','char','nchar','varbinary','binary')
                                THEN '(' + CASE WHEN c.max_length = -1 THEN 'max'
                                                WHEN t.name LIKE 'n%' THEN CAST(c.max_length / 2 AS varchar(10))
                                                ELSE CAST(c.max_length AS varchar(10)) END + ')'
                                WHEN t.name IN ('decimal','numeric') THEN '(' + CAST(c.precision AS varchar(5)) + ',' + CAST(c.scale AS varchar(5)) + ')'
                                WHEN t.name IN ('datetimeoffset','datetime2','time') THEN '(' + CAST(c.scale AS varchar(5)) + ')'
                                ELSE '' END
                         + CASE WHEN c.is_nullable = 1 THEN ' NULL' ELSE ' NOT NULL' END
                         + CASE WHEN c.is_identity = 1 THEN ' IDENTITY' ELSE '' END
                         + ISNULL(' DEFAULT ' + d.definition, '')
                  FROM sys.columns c
                  JOIN sys.types t ON t.user_type_id = c.user_type_id
                  LEFT JOIN sys.default_constraints d ON d.object_id = c.default_object_id
                  WHERE c.object_id = OBJECT_ID(@t) ORDER BY c.column_id", table);

            Append(connection, text,
                @"SELECT '  INDEX ' + i.name + CASE WHEN i.is_unique = 1 THEN ' UNIQUE' ELSE '' END
                         + CASE WHEN i.is_primary_key = 1 THEN ' PRIMARY KEY' ELSE '' END
                         + ISNULL(' WHERE ' + i.filter_definition, '')
                  FROM sys.indexes i WHERE i.object_id = OBJECT_ID(@t) AND i.name IS NOT NULL ORDER BY i.name", table);

            Append(connection, text,
                @"SELECT '  CHECK ' + name + ' ' + definition
                  FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(@t) ORDER BY name", table);

            Append(connection, text,
                @"SELECT '  FOREIGN KEY ' + fk.name + ' -> ' + OBJECT_NAME(fk.referenced_object_id)
                         + CASE fk.delete_referential_action WHEN 1 THEN ' ON DELETE CASCADE'
                                                             WHEN 2 THEN ' ON DELETE SET NULL' ELSE '' END
                  FROM sys.foreign_keys fk WHERE fk.parent_object_id = OBJECT_ID(@t) ORDER BY fk.name", table);

            Append(connection, text,
                "SELECT '  TRIGGER ' + name FROM sys.triggers WHERE parent_id = OBJECT_ID(@t) ORDER BY name", table);

            text.AppendLine();
        }

        text.AppendLine("PROGRAMMABILITY");
        Append(connection, text,
            // COLLATE DATABASE_DEFAULT on both halves: sys.objects.type_desc carries the server's
            // metadata collation and name carries the database's, so concatenating them raises
            // "cannot resolve collation conflict" whenever the two differ -- which silently emptied
            // this whole section the first time it was run against the live database.
            @"SELECT '  ' + type_desc COLLATE DATABASE_DEFAULT + ' ' + name COLLATE DATABASE_DEFAULT
              FROM sys.objects
              WHERE is_ms_shipped = 0 AND type IN ('FN','IF','TF','P','V') ORDER BY type_desc, name", null);

        text.AppendLine();
        text.AppendLine("FULL-TEXT");
        Append(connection, text, "SELECT '  CATALOG ' + name FROM sys.fulltext_catalogs ORDER BY name", null);
        Append(connection, text,
            "SELECT '  INDEX ON ' + OBJECT_NAME(object_id) FROM sys.fulltext_indexes ORDER BY object_id", null);

        return text.ToString();
    }

    /// <summary>
    /// The source of every stored procedure, view and function, so the export can actually put one
    /// back.
    ///
    /// schema.txt lists these by name, which is enough to notice one has gone but not enough to
    /// restore it. That matters here because this database is shared: ten of the procedures belong
    /// to another application, and an export taken to cover a change to *our* tables should still
    /// leave their code recoverable. Definitions are read from OBJECT_DEFINITION rather than
    /// sys.sql_modules.definition so an encrypted object comes back NULL and is reported, instead of
    /// being silently absent.
    /// </summary>
    private static string BuildProgrammability(SqlConnection connection)
    {
        var text = new StringBuilder();
        text.AppendLine($"-- Stored procedures, views and functions, {DateTime.Now:u}");
        text.AppendLine("-- Source as the server holds it. Apply with GO between batches.");
        text.AppendLine();

        List<(string Type, string Name)> objects;
        try
        {
            objects = Resilient(connection, () =>
            {
                var found = new List<(string, string)>();
                using var command = new SqlCommand(
                    @"SELECT type_desc COLLATE DATABASE_DEFAULT, name COLLATE DATABASE_DEFAULT
                      FROM sys.objects
                      WHERE is_ms_shipped = 0 AND type IN ('FN','IF','TF','P','V')
                      ORDER BY type_desc, name", connection) { CommandTimeout = 60 };
                using var reader = command.ExecuteReader();
                while (reader.Read()) found.Add((reader.GetString(0), reader.GetString(1)));
                return found;
            });
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            text.AppendLine($"-- could not list programmability ({ex.Message})");
            return text.ToString();
        }

        if (objects.Count == 0)
        {
            text.AppendLine("-- none");
            return text.ToString();
        }

        foreach (var (type, name) in objects)
        {
            var definition = Scalar(connection, $"SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.{name}'))");

            text.AppendLine($"-- ---------------------------------------------------------------- {type} dbo.{name}");
            if (string.IsNullOrWhiteSpace(definition))
            {
                // Encrypted, or a permission this login does not have. Say so: a silently missing
                // procedure is the failure mode this file exists to prevent.
                text.AppendLine($"-- NOT EXPORTED: no definition readable for dbo.{name} (encrypted, or not permitted).");
            }
            else
            {
                text.AppendLine(definition.TrimEnd());
                text.AppendLine("GO");
            }
            text.AppendLine();
        }

        return text.ToString();
    }

    /// <summary>
    /// Runs one query, reopening the connection and trying again if it has been dropped underneath.
    ///
    /// An export of this database is roughly five queries for each of its 85 tables plus the row
    /// reads -- several hundred round trips on one connection to a shared-hosting server, which
    /// closed it part way through and turned the whole export into:
    ///
    ///     System.InvalidOperationException : ExecuteReader requires an open and available
    ///     Connection. The connection's current state is closed.
    ///
    /// That is not a SqlException, so the per-query guards did not catch it and an export that was
    /// already most of the way done was lost. Every query here is an independent catalogue read, so
    /// there is no session state to lose by reconnecting. A second failure is a real outage and is
    /// left to the caller.
    /// </summary>
    private static T Resilient<T>(SqlConnection connection, Func<T> work)
    {
        try
        {
            EnsureOpen(connection);
            return work();
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            EnsureOpen(connection);
            return work();
        }
    }

    private static void EnsureOpen(SqlConnection connection)
    {
        if (connection.State == System.Data.ConnectionState.Open) return;
        connection.Close();
        connection.Open();
    }

    /// <summary>One scalar as text, or null when it cannot be read. An export must never fail
    /// because one descriptive line could not be fetched.</summary>
    private static string? Scalar(SqlConnection connection, string sql)
    {
        try
        {
            return Resilient(connection, () =>
            {
                using var command = new SqlCommand(sql, connection) { CommandTimeout = 60 };
                return command.ExecuteScalar()?.ToString();
            });
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            return null;
        }
    }

    private static void Append(SqlConnection connection, StringBuilder text, string sql, string? table)
    {
        try
        {
            // Buffered, then appended: a connection dropped half way through a reader would
            // otherwise leave half a table's columns in the report and the retry would add the rest
            // again underneath them.
            var lines = Resilient(connection, () =>
            {
                var found = new List<string>();
                using var command = new SqlCommand(sql, connection) { CommandTimeout = 60 };
                if (table is not null) command.Parameters.AddWithValue("t", table);
                using var reader = command.ExecuteReader();
                while (reader.Read()) found.Add(reader.GetString(0));
                return found;
            });

            foreach (var line in lines) text.AppendLine(line);
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            text.AppendLine($"  (could not read: {ex.Message})");
        }
    }

    /// <summary>
    /// Every row, as INSERT statements. Identity columns are written explicitly inside
    /// IDENTITY_INSERT, because the ids are what the foreign keys point at: re-inserting this data
    /// with fresh identities would preserve the rows and silently destroy the relationships.
    /// </summary>
    private static string BuildDataScript(SqlConnection connection, List<string> tables, Dictionary<string, long> counts)
    {
        var script = new StringBuilder();
        script.AppendLine($"-- Data export, {DateTime.Now:u}");
        script.AppendLine("-- Restore order is NOT dependency-sorted: disable constraints or insert parents first.");
        script.AppendLine("SET NOCOUNT ON;");
        script.AppendLine();

        foreach (var table in tables)
        {
            var columns = new List<string>();
            var hasIdentity = false;

            try
            {
                var meta = Resilient(connection, () =>
                {
                    var found = new List<(string Name, bool Identity)>();
                    using var command = new SqlCommand(
                        @"SELECT c.name, c.is_identity FROM sys.columns c
                          WHERE c.object_id = OBJECT_ID(@t)
                            AND c.is_computed = 0
                          ORDER BY c.column_id", connection) { CommandTimeout = 60 };
                    command.Parameters.AddWithValue("t", table);
                    using var reader = command.ExecuteReader();
                    while (reader.Read()) found.Add((reader.GetString(0), reader.GetBoolean(1)));
                    return found;
                });

                columns.AddRange(meta.Select(m => m.Name));
                hasIdentity = meta.Any(m => m.Identity);
            }
            catch (Exception ex) when (ex is SqlException or InvalidOperationException)
            {
                script.AppendLine($"-- {table}: could not read its columns ({ex.Message})");
                script.AppendLine();
                counts[table] = -1;
                continue;
            }

            if (columns.Count == 0) continue;

            // geography has no literal form; Literal() reads it as its native bytes and rebuilds it
            // with CONVERT on insert.
            var selectList = string.Join(", ", columns.Select(c => $"[{c}]"));
            var rows = new List<string>();


            try
            {
                // Resilient() may run this twice, so the rows are collected fresh inside it rather
                // than appended to the outer list: a retry must not double the table's data.
                rows = Resilient(connection, () =>
                {
                    var found = new List<string>();
                    using var command = new SqlCommand($"SELECT {selectList} FROM [dbo].[{table}]", connection)
                    {
                        CommandTimeout = 120,
                    };
                    using var reader = command.ExecuteReader();
                    while (reader.Read())
                    {
                        var values = new List<string>();
                        for (var i = 0; i < columns.Count; i++) values.Add(Literal(reader, i));
                        found.Add($"INSERT INTO [dbo].[{table}] ({string.Join(", ", columns.Select(c => $"[{c}]"))}) "
                                  + $"VALUES ({string.Join(", ", values)});");
                    }
                    return found;
                });
            }
            catch (Exception ex) when (ex is SqlException or InvalidOperationException)
            {
                script.AppendLine($"-- {table}: could not read ({ex.Message})");
                script.AppendLine();
                counts[table] = -1;
                continue;
            }

            counts[table] = rows.Count;
            if (rows.Count == 0) continue;

            script.AppendLine($"-- {table}: {rows.Count} row(s)");
            if (hasIdentity) script.AppendLine($"SET IDENTITY_INSERT [dbo].[{table}] ON;");
            foreach (var row in rows) script.AppendLine(row);
            if (hasIdentity) script.AppendLine($"SET IDENTITY_INSERT [dbo].[{table}] OFF;");
            script.AppendLine();
        }

        return script.ToString();
    }

    /// <summary>One value as a T-SQL literal. Anything unrecognised becomes a quoted string, which is
    /// the safe direction: a wrong quote fails loudly on restore rather than inserting nonsense.</summary>
    private static string Literal(SqlDataReader reader, int i)
    {
        if (reader.IsDBNull(i)) return "NULL";

        /* Spatial columns are handled first, by their type *name*, because reading one at all is
           what breaks. GetValue on a CLR UDT tries to load Microsoft.SqlServer.Types, which this
           project deliberately does not reference, and throws FileNotFoundException before any of
           the switch below can run — so the `geography` arm that used to sit in that switch was
           unreachable, and the whole export died on the first listing with a location. (It only
           surfaced once a real row existed: an empty `listings` table never reaches this.)

           GetSqlBytes stays in metadata and hands back the native serialization. CONVERT rebuilds
           it exactly, SRID included, which a well-known-text round trip would have had to restate
           and would have rounded to the text's precision. */
        var typeName = reader.GetDataTypeName(i);
        var spatial = typeName.EndsWith("geography", StringComparison.OrdinalIgnoreCase) ? "geography"
            : typeName.EndsWith("geometry", StringComparison.OrdinalIgnoreCase) ? "geometry"
            : null;
        if (spatial is not null)
        {
            var bytes = reader.GetSqlBytes(i);
            return bytes.IsNull ? "NULL" : $"CONVERT({spatial}, 0x{Convert.ToHexString(bytes.Value)})";
        }

        var value = reader.GetValue(i);
        return value switch
        {
            bool b => b ? "1" : "0",
            byte or short or int or long or decimal or float or double =>
                Convert.ToString(value, CultureInfo.InvariantCulture) ?? "NULL",
            DateTime d => $"'{d:yyyy-MM-ddTHH:mm:ss.fff}'",
            DateTimeOffset o => $"'{o:yyyy-MM-ddTHH:mm:ss.fffzzz}'",
            Guid g => $"'{g}'",
            byte[] bytes => "0x" + Convert.ToHexString(bytes),
            _ => $"N'{value.ToString()?.Replace("'", "''")}'",
        };
    }

    /// <summary>
    /// The part a person reads first: what this is, how much data it holds, and whether the live
    /// schema matches what the migration scripts were supposed to create.
    /// </summary>
    private static string BuildManifest(
        SqlConnection connection, SqlConnectionStringBuilder builder, List<string> tables,
        Dictionary<string, long> counts, string contentRoot, IConfiguration configuration)
    {
        var text = new StringBuilder();
        text.AppendLine($"Exported     {DateTime.Now:u}");
        text.AppendLine($"Server       {builder.DataSource}");
        text.AppendLine($"Database     {builder.InitialCatalog}");

        // The collation is here because it cannot be changed after the database is created, and the
        // slug CHECK constraints depend on it: they compare under an explicit binary collation
        // precisely because the database's own is case-insensitive. A reader deciding whether this
        // database is the right target needs to see it without having to go and ask the server.
        foreach (var (label, sql) in new[]
        {
            ("Collation", "CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS nvarchar(128))"),
            ("Edition", "CAST(SERVERPROPERTY('Edition') AS nvarchar(128))"),
            ("Version", "CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64))"),
            ("Full-text", "CASE WHEN SERVERPROPERTY('IsFullTextInstalled') = 1 THEN 'installed' ELSE 'NOT installed' END"),
        })
        {
            text.AppendLine($"{label,-12} {Scalar(connection, $"SELECT {sql}") ?? "(unreadable)"}");
        }

        text.AppendLine();

        /* Tables outside dbo, which everything in this project assumes. An unqualified CREATE TABLE
           lands in the *login's* default schema, not necessarily dbo, so on a shared-hosting login
           whose default schema is its own name, a migration can quietly build the whole schema
           somewhere the application never looks. That is not hypothetical: the first repair script
           here created category_search_terms unqualified, it went to the login's schema, and
           db-baseline went on reporting the table as missing while the server's table count went up.
           Anything listed here is in the wrong place. */
        text.AppendLine("Schemas");
        var strays = new List<string>();
        try
        {
            strays = Resilient(connection, () =>
            {
                var found = new List<string>();
                using var command = new SqlCommand(
                    @"SELECT s.name + '.' + t.name
                      FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
                      WHERE t.is_ms_shipped = 0 AND s.name <> 'dbo'
                      ORDER BY s.name, t.name", connection) { CommandTimeout = 60 };
                using var reader = command.ExecuteReader();
                while (reader.Read()) found.Add(reader.GetString(0));
                return found;
            });
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            text.AppendLine($"  (could not read: {ex.Message})");
        }

        text.AppendLine($"  default schema of this login   {Scalar(connection, "SELECT SCHEMA_NAME()") ?? "(unreadable)"}");
        if (strays.Count == 0)
        {
            text.AppendLine("  every user table is in dbo");
        }
        else
        {
            text.AppendLine($"  {strays.Count} table(s) OUTSIDE dbo -- the application will not see these:");
            foreach (var stray in strays) text.AppendLine($"    {stray}");
        }
        text.AppendLine();

        text.AppendLine("Row counts");
        foreach (var (table, count) in counts.OrderBy(c => c.Key, StringComparer.Ordinal))
        {
            text.AppendLine($"  {table,-28} {(count < 0 ? "(unreadable)" : count.ToString(CultureInfo.InvariantCulture))}");
        }
        text.AppendLine($"  {"TOTAL",-28} {counts.Values.Where(c => c > 0).Sum()}");
        text.AppendLine();

        // Live schema against the migration scripts: the whole point of verifying before repairing.
        var migrationsPath = configuration["Database:MigrationsPath"]
            ?? MigrationRunner.FindDirectory(contentRoot, "database", "sqlserver", "migrations");

        text.AppendLine("Schema vs migration scripts");
        if (migrationsPath is null || !Directory.Exists(migrationsPath))
        {
            text.AppendLine("  (migrations folder not found; comparison skipped)");
            return text.ToString();
        }

        var live = new HashSet<string>(tables, StringComparer.OrdinalIgnoreCase);
        var expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var file in Directory.GetFiles(migrationsPath, "*.sql").OrderBy(f => f, StringComparer.Ordinal))
        {
            var wanted = DatabaseBaselineTables(File.ReadAllText(file));
            foreach (var t in wanted) expected.Add(t);

            var missing = wanted.Where(t => !live.Contains(t)).ToList();
            text.AppendLine($"  {Path.GetFileName(file),-46} "
                            + (wanted.Count == 0 ? "no tables"
                               : missing.Count == 0 ? $"all {wanted.Count} table(s) present"
                               : $"MISSING {string.Join(", ", missing)}"));
        }

        var unexpected = live.Where(t => !expected.Contains(t)).OrderBy(t => t, StringComparer.Ordinal).ToList();
        text.AppendLine();
        text.AppendLine(unexpected.Count == 0
            ? "  No tables beyond what the migrations create."
            : $"  Tables not created by any migration: {string.Join(", ", unexpected)}");

        return text.ToString();
    }

    /// <summary>Shares the parsing rule with the baseline command, so the two cannot disagree.</summary>
    private static List<string> DatabaseBaselineTables(string sql) =>
        System.Text.RegularExpressions.Regex
            .Matches(sql, @"^\s*CREATE\s+TABLE\s+(?:\[?dbo\]?\.)?\[?([A-Za-z_][A-Za-z0-9_]*)\]?",
                     System.Text.RegularExpressions.RegexOptions.Multiline
                     | System.Text.RegularExpressions.RegexOptions.IgnoreCase)
            .Select(m => m.Groups[1].Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
}
