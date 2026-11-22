using System.Text.RegularExpressions;
using BusinessDirectory.Api.Data;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// No public helper in the API is declared and then called by nothing.
///
/// <para>
/// <see cref="BusinessDirectory.Api.Endpoints.SearchTuningEndpoints"/> had one.
/// <c>ExpandAsync</c> turns a search term into whatever synonym an admin mapped it to, and its own
/// comment said "Called by the search endpoint before it queries". Nothing called it. So the search
/// tuning screen accepted a synonym, the API stored the row, the screen listed it back, and every
/// public search ignored it -- for as long as the feature had existed.
/// </para>
/// <para>
/// Nothing else could have noticed. The method compiled, had no warnings (an unused *public* member
/// is not one), was covered by no test because it was reachable from no path, and the feature it
/// served failed silently by doing nothing at all. The admin screen worked perfectly.
/// </para>
/// <para>
/// <b>Why this reads source files.</b> A call is not metadata, and an unreferenced public method is
/// indistinguishable from a used one by reflection. Comments are stripped before counting, because
/// prose naming a method is not a call to it -- the comment now explaining where the expander is
/// used would otherwise be the only "use" it needed.
/// </para>
/// </summary>
public class UnusedHelperTests
{
    /// <summary>A <c>public static</c> method declaration, capturing its name.</summary>
    private static readonly Regex Declaration = new(
        @"public\s+static\s+(?:async\s+)?[\w<>,\?\[\]\. ]+?\s+(\w+)\s*\(",
        RegexOptions.Compiled);

    private static readonly Regex BlockComment = new(@"/\*.*?\*/", RegexOptions.Singleline | RegexOptions.Compiled);
    private static readonly Regex LineComment = new(@"//[^\r\n]*", RegexOptions.Compiled);

    /// <summary>
    /// Names that are declared for a caller outside this solution, so a search of it finds nothing.
    /// Each one needs a reason, which is the point of listing them here rather than widening the
    /// regex until the test passes.
    /// </summary>
    private static readonly HashSet<string> CalledFromOutsideTheSolution = new(StringComparer.Ordinal)
    {
        // Nothing today. An entry here is a claim that something outside backend/ calls it.
    };

    private static string Strip(string source) => LineComment.Replace(BlockComment.Replace(source, " "), " ");

    private static IEnumerable<string> SourceFiles(string root) =>
        Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                        && !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"));

    [Fact]
    public void Every_public_helper_in_the_api_is_called_by_something()
    {
        var backend = MigrationRunner.FindDirectory(AppContext.BaseDirectory, "backend");
        Assert.True(backend is not null, "Could not locate backend/ from the test assembly.");

        var api = Path.Combine(backend!, "BusinessDirectory.Api");
        Assert.True(Directory.Exists(api), $"Expected the API project at {api}.");

        // Every file in the solution, comments removed, is where a call could be.
        var solution = string.Join("\n", SourceFiles(backend!).Select(f => Strip(File.ReadAllText(f))));

        var declaredIn = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var file in SourceFiles(api))
        {
            foreach (Match match in Declaration.Matches(Strip(File.ReadAllText(file))))
            {
                var name = match.Groups[1].Value;
                if (!declaredIn.TryGetValue(name, out var files))
                {
                    declaredIn[name] = files = [];
                }
                files.Add(Path.GetFileName(file));
            }
        }

        // Guards the test: a regex that quietly matched nothing would make the assertion vacuous.
        Assert.True(
            declaredIn.Count >= 100,
            $"Only {declaredIn.Count} public static methods found; the scan has probably stopped working.");

        var unreferenced = new List<string>();
        foreach (var (name, files) in declaredIn)
        {
            if (CalledFromOutsideTheSolution.Contains(name))
            {
                continue;
            }

            // One mention per declaration is the declaration itself; a call is one more.
            var mentions = Regex.Matches(solution, $@"\b{Regex.Escape(name)}\b").Count;
            if (mentions <= files.Count)
            {
                unreferenced.Add($"{name} ({string.Join(", ", files)}) is declared and called by nothing");
            }
        }

        Assert.Empty(unreferenced);
    }

    [Fact]
    public void The_scan_would_notice_a_helper_nothing_calls()
    {
        /* Proves the counting rule rather than trusting it: a name that appears once is
           unreferenced, and one that appears twice is not. Without this, an off-by-one in the
           comparison above would let every dead helper through and the suite would stay green. */
        const string onlyDeclared = "public static string Lonely(string s) => s;";
        const string alsoCalled = onlyDeclared + "\nvar x = Lonely(\"a\");";

        Assert.Single(Declaration.Matches(onlyDeclared));
        Assert.Single(Regex.Matches(onlyDeclared, @"\bLonely\b"));
        Assert.Equal(2, Regex.Matches(alsoCalled, @"\bLonely\b").Count);
    }

    [Fact]
    public void A_mention_in_a_comment_does_not_count_as_a_call()
    {
        // The reason this test exists at all: the comment documenting where the expander is used
        // was, before comments were stripped, the only mention that stopped it being reported.
        const string source = """
            // Lonely is called by the search endpoint before it queries.
            /* See Lonely for the mapping. */
            public static string Lonely(string s) => s;
            """;

        var stripped = Strip(source);

        Assert.Single(Regex.Matches(stripped, @"\bLonely\b"));
    }
}
