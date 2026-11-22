using System.Text.RegularExpressions;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// Ties every endpoint to the permission it names, which is the test
/// <see cref="AdminAccess.AuthorizeSuper"/> says in its own comment is missing.
///
/// <para>
/// The failure it exists for cost an afternoon on 2026-11-07 and no existing test could have caught
/// it. <c>/api/v1/super-admin/accounts</c> required <c>users.view</c>, which was on the *admin*
/// list, and <see cref="AdminAccess.AuthorizeSuper"/> refuses a permission from the other surface
/// before it ever looks at what the account holds. So the endpoint answered "You do not have
/// permission to do that" to a super admin holding every permission there is -- for ever, with
/// every test green, because a permanent refusal is indistinguishable from a real one. Refusing is
/// the right behaviour; the gap was that nothing noticed.
/// </para>
/// <para>
/// <b>Why this reads source files.</b> The permission a handler names is an argument at a call site,
/// not metadata: there is nothing to reflect over. <c>AdminPermissionSurfaceTests</c> asserts the
/// two *lists* are disjoint and that each gate accepts its own list -- a different statement, which
/// cannot see a handler naming the wrong one.
/// </para>
/// <para>
/// <b>What it does not do.</b> It is not a C# parser. It infers which gate guards a call from the
/// gates present in that file, which is exact for a file using one of them. A file using both --
/// today only <c>ListingAlertEndpoints</c>, deliberately, so one handler serves both surfaces --
/// is handled by reading its <c>Surface</c> declarations, each of which names its own gate. Where a
/// gate still cannot be determined the weaker assertion applies: the permission must at least
/// belong to one surface. Both real failure modes are caught everywhere: a permission on neither
/// list, and a permission on the opposite list to its gate.
/// </para>
/// </summary>
public class AdminPermissionBindingTests
{
    /// <summary>
    /// A gate call, or a call to a file's own <c>Gate</c> helper, naming a permission constant.
    /// <c>AuthorizeSuper</c> comes first in the alternation because <c>Authorize</c> is a prefix of
    /// it, and the shorter one would otherwise win and report the wrong surface.
    /// </summary>
    private static readonly Regex GateCall = new(
        @"(?:AdminAccess\.(?<gate>AuthorizeSuper|Authorize)|\bGate)\s*\([^;]{0,200}?AdminPermissions\.(?<permission>\w+)",
        RegexOptions.Singleline | RegexOptions.Compiled);

    /// <summary>
    /// A <c>Surface</c> declaration, pairing a permission with the gate that checks it and passing
    /// that gate round as a delegate rather than calling it. Capturing the declaration's *name* is
    /// what lets the override below resolve to the right gate instead of being guessed.
    /// </summary>
    private static readonly Regex SurfaceDeclaration = new(
        @"Surface\s+(?<name>\w+)\s*=\s*new\(\s*AdminPermissions\.(?<permission>\w+),\s*AdminAccess\.(?<gate>AuthorizeSuper|Authorize)\b",
        RegexOptions.Singleline | RegexOptions.Compiled);

    /// <summary>
    /// <c>AdminSurface with { Permission = AdminPermissions.ListingsView }</c> -- the same surface,
    /// and therefore the same gate, carrying a different permission for the read route.
    /// </summary>
    private static readonly Regex PermissionOverride = new(
        @"(?<surface>\w+)\s+with\s*\{\s*Permission\s*=\s*AdminPermissions\.(?<permission>\w+)",
        RegexOptions.Compiled);

    private sealed record Binding(string File, string Permission, string? Gate);

    /// <summary>
    /// Walks up to the API's Endpoints folder. Reused from the migration runner rather than
    /// reinvented: it answers the same question -- find a known folder from wherever this ran.
    /// </summary>
    private static string EndpointsDirectory()
    {
        var found = MigrationRunner.FindDirectory(AppContext.BaseDirectory, "backend", "BusinessDirectory.Api", "Endpoints");
        Assert.True(found is not null, "Could not locate backend/BusinessDirectory.Api/Endpoints from the test assembly.");
        return found!;
    }

    private static List<Binding> ReadBindings()
    {
        var bindings = new List<Binding>();

        foreach (var file in Directory.GetFiles(EndpointsDirectory(), "*.cs"))
        {
            var source = File.ReadAllText(file);
            var name = Path.GetFileName(file);

            /* Named, not necessarily called: ListingAlertEndpoints hands the gate over as a
               delegate, so requiring a following "(" would miss it. The lookahead stops
               "Authorize" matching the first half of "AuthorizeSuper". */
            var usesAdmin = Regex.IsMatch(source, @"AdminAccess\.Authorize(?!Super)");
            var usesSuper = source.Contains("AdminAccess.AuthorizeSuper", StringComparison.Ordinal);

            if (!usesAdmin && !usesSuper)
            {
                continue;   // no permission gate in this file
            }

            // Null = this file uses both, so a bare Gate() call's surface is not inferable from it.
            var fileGate = usesAdmin && usesSuper ? null
                : usesSuper ? "AuthorizeSuper"
                : "Authorize";

            // Surface declarations carry their own gate, and name it for the overrides below.
            var surfaceGates = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (Match match in SurfaceDeclaration.Matches(source))
            {
                surfaceGates[match.Groups["name"].Value] = match.Groups["gate"].Value;
                bindings.Add(new Binding(name, match.Groups["permission"].Value, match.Groups["gate"].Value));
            }

            foreach (Match match in GateCall.Matches(source))
            {
                var gate = match.Groups["gate"].Success ? match.Groups["gate"].Value : fileGate;
                bindings.Add(new Binding(name, match.Groups["permission"].Value, gate));
            }

            foreach (Match match in PermissionOverride.Matches(source))
            {
                // The surface it copies decides the gate; fall back only if that surface is unknown.
                var gate = surfaceGates.TryGetValue(match.Groups["surface"].Value, out var declared) ? declared : fileGate;
                bindings.Add(new Binding(name, match.Groups["permission"].Value, gate));
            }
        }

        return bindings;
    }

    /// <summary>The constant's name turned into the code it holds, so assertions compare codes.</summary>
    private static string CodeFor(string constantName)
    {
        var field = typeof(AdminPermissions).GetField(constantName);
        Assert.True(field is not null, $"AdminPermissions.{constantName} does not exist.");
        return (string)field!.GetValue(null)!;
    }

    [Fact]
    public void The_scan_finds_the_gates_that_are_there()
    {
        // Guards the test itself. A regex that quietly matched nothing would make every assertion
        // below pass by vacuity, which is the one way a test like this fails silently.
        var bindings = ReadBindings();

        Assert.True(bindings.Count >= 20, $"Only {bindings.Count} permission gates found; the scan has probably stopped working.");
        Assert.True(
            bindings.Select(b => b.File).Distinct().Count() >= 10,
            "Permission gates were found in suspiciously few files.");
        Assert.True(
            bindings.Count(b => b.Gate == "Authorize") >= 5 && bindings.Count(b => b.Gate == "AuthorizeSuper") >= 5,
            "Both gates should appear; finding only one means the surface inference has broken.");
    }

    [Fact]
    public void No_endpoint_names_a_permission_that_belongs_to_neither_surface()
    {
        // A permission on neither list satisfies neither gate, so that endpoint is refused for ever.
        // This is the cheaper half of the 2026-11-07 failure and needs no gate inference at all.
        var orphans = ReadBindings()
            .Where(b =>
            {
                var code = CodeFor(b.Permission);
                return !AdminPermissions.AdminSurface.Contains(code)
                    && !AdminPermissions.SuperAdminOnly.Contains(code);
            })
            .Select(b => $"{b.File} names AdminPermissions.{b.Permission}")
            .Distinct()
            .ToArray();

        Assert.Empty(orphans);
    }

    [Fact]
    public void Every_endpoint_names_a_permission_its_own_gate_can_accept()
    {
        // The 2026-11-07 failure itself: the right permission, checked by the wrong gate.
        var mismatched = ReadBindings()
            .Where(b => b.Gate is not null)
            .Where(b =>
            {
                var code = CodeFor(b.Permission);
                return b.Gate == "Authorize"
                    ? !AdminPermissions.AdminSurface.Contains(code)
                    : !AdminPermissions.SuperAdminOnly.Contains(code);
            })
            .Select(b => $"{b.File} passes AdminPermissions.{b.Permission} to {b.Gate}")
            .Distinct()
            .ToArray();

        Assert.Empty(mismatched);
    }

    [Fact]
    public void A_gate_accepts_exactly_the_permissions_the_endpoints_name()
    {
        /* Proves the assertions above check the live rule rather than a copy of it: every binding is
           replayed through the real gate with an identity holding every permission. Null means "go
           ahead", so a non-null answer is an endpoint no account could ever use. */
        var everything = new AdminIdentity(
            1, "every@example.com", "Every Permission",
            ["admin", "super_admin"],
            [.. AdminPermissions.AdminSurface, .. AdminPermissions.SuperAdminOnly]);

        foreach (var binding in ReadBindings().Where(b => b.Gate is not null))
        {
            var code = CodeFor(binding.Permission);
            var refusal = binding.Gate == "Authorize"
                ? AdminAccess.Authorize(everything, code)
                : AdminAccess.AuthorizeSuper(everything, code);

            Assert.True(
                refusal is null,
                $"{binding.File} passes {code} to {binding.Gate}, which refuses it even to an account holding everything.");
        }
    }

    [Fact]
    public void Obsolete_and_dormant_permissions_are_not_gated_by_any_endpoint()
    {
        /* listings.verify is obsolete: a listing is Verified because an active subscription grants
           the badge, computed by dbo.listing_entitlements, not because somebody marked it. Its
           permission row stays in production -- removing it would be production DML for no
           functional gain -- but no endpoint may start depending on it, because nothing would then
           be able to set what it guards.

           data.export and plans.manage are dormant rather than obsolete: real features nobody has
           built. They are named here so that building one is a deliberate act that fails this test
           and has to update it, rather than a quiet addition nobody reviews. */
        string[] notToBeGated = [AdminPermissions.ListingsVerify, AdminPermissions.DataExport, AdminPermissions.PlansManage];

        var gated = ReadBindings()
            .Where(b => notToBeGated.Contains(CodeFor(b.Permission)))
            .Select(b => $"{b.File} gates on {CodeFor(b.Permission)}")
            .Distinct()
            .ToArray();

        Assert.Empty(gated);
    }
}
