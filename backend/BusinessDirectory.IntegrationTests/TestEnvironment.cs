using System.Runtime.CompilerServices;

namespace BusinessDirectory.IntegrationTests;

/// <summary>
/// Gives the test host a connection string before any WebApplicationFactory builds.
///
/// The tests need no database, and still do not: nothing here connects. What they need is for
/// ConnectionStrings:Default to *exist*, because Program.cs registers SqlDatabase only when it does,
/// and a minimal-API handler that takes an unregistered type has it inferred as a body parameter.
/// A GET endpoint cannot have one, so endpoint construction throws before a single request is made:
///
///     System.InvalidOperationException : Body was inferred but the method does not allow
///     inferred body parameters.  [ db | Body (Inferred) ]
///
/// That made the suite depend on whatever configuration happened to be on the machine running it --
/// it passed while a developer had a user-secret set and failed in CI, which is the wrong way round
/// for a suite whose whole point is that it needs nothing.
///
/// A module initializer runs before any test and before any host is built, which is the only
/// reliable moment: an xUnit fixture is too late for a factory created in a constructor.
///
/// The value is deliberately unusable. SqlDatabase only stores the string -- it opens nothing until
/// a query runs -- so an unreachable server is exactly right: DI is satisfied, and any test that
/// accidentally tried to reach a database would fail loudly instead of quietly finding a real one.
/// </summary>
internal static class TestEnvironment
{
    [ModuleInitializer]
    internal static void SetUp()
    {
        // Only if the environment has not already supplied one, so a developer can still point the
        // suite somewhere on purpose.
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ConnectionStrings__Default")))
        {
            Environment.SetEnvironmentVariable(
                "ConnectionStrings__Default",
                "Server=(tests-have-no-database);Database=none;User Id=none;Password=none;"
                + "Encrypt=False;TrustServerCertificate=True;Connect Timeout=1");
        }
    }
}
