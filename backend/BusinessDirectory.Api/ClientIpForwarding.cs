using Microsoft.AspNetCore.HttpOverrides;

namespace BusinessDirectory.Api;

/// <summary>
/// Where the caller's IP address comes from when this API runs behind a reverse proxy, which in
/// production is Azure App Service.
///
/// <para>
/// It matters more here than it looks. <c>context.Connection.RemoteIpAddress</c> is the partition
/// key for the global rate limiter, and it is also counted for the OTP per-IP allowance, the
/// enquiry limits and the abuse-report limits. Behind App Service the connection comes from the
/// front end, so without this every caller in the world shares one bucket: one of them can spend
/// everybody's allowance, and the per-IP half of the OTP throttle protects nothing.
/// </para>
/// <para>
/// This used to depend on <c>ASPNETCORE_FORWARDEDHEADERS_ENABLED=true</c> being set by hand on the
/// App Service, documented in <c>docs/deployment.md</c> and enforced nowhere. A security control
/// that works only if somebody remembers an environment variable is a control that is off.
/// </para>
/// </summary>
public static class ClientIpForwarding
{
    /// <summary>
    /// Configuration key. Defaults to on outside Development and off inside it, which is the honest
    /// default both ways: in production there is always a proxy in front, and locally there is
    /// never one — and trusting the header with no proxy in front would let any caller claim any
    /// address.
    /// </summary>
    public const string TrustSetting = "Hosting:TrustForwardedHeaders";

    /// <summary>
    /// The environment variable that makes the *host* add this middleware before the application
    /// starts: <c>ASPNETCORE_FORWARDEDHEADERS_ENABLED</c>. Named for messages and documentation;
    /// the detection reads <see cref="HostConfigurationKey"/>, because that is what the host reads.
    /// </summary>
    public const string HostEnvironmentVariable = "ASPNETCORE_FORWARDEDHEADERS_ENABLED";

    /// <summary>
    /// The configuration key the host itself checks. It is the environment variable above with the
    /// <c>ASPNETCORE_</c> prefix stripped, which is how that provider loads it — but reading the
    /// key rather than the variable also catches it arriving from any other provider, which the
    /// variable alone would miss. Configuration keys are case-insensitive.
    /// </summary>
    public const string HostConfigurationKey = "ForwardedHeaders_Enabled";

    /// <summary>
    /// The options the middleware runs with.
    ///
    /// <para>
    /// <c>ForwardLimit = 1</c> is the part that makes clearing the known-proxy lists safe, and it is
    /// the whole security argument. App Service's front ends are not loopback and their addresses
    /// are not published, so the default lists would reject every forwarded header and nothing
    /// would work. What stops a caller spoofing their address instead is that the proxy *appends*:
    /// a request arriving with <c>X-Forwarded-For: 1.1.1.1</c> reaches the application as
    /// <c>1.1.1.1, &lt;real client&gt;</c>, and reading exactly one hop takes the last entry — the
    /// one the proxy wrote. Raising the limit would start trusting what the client sent.
    /// </para>
    /// <para>
    /// <c>XForwardedProto</c> comes along because TLS is terminated at the front end. Without it
    /// every request looks like plain HTTP to the application, which is what decides whether HSTS
    /// is sent.
    /// </para>
    /// </summary>
    public static void Configure(ForwardedHeadersOptions options)
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = 1;
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();

        /* Set rather than left to the default, which is what this whole class is for. With symmetry
           required, a request whose X-Forwarded-For carries two entries while X-Forwarded-Proto
           carries one would have *both* headers discarded — and that mismatch is exactly what a
           caller who sends their own X-Forwarded-For produces, so it would hand them a way to turn
           the real address back off and put everyone into one rate-limit bucket again. false is
           today's default; stating it means a change of default cannot quietly do that. */
        options.RequireHeaderSymmetry = false;
    }

    /// <summary>Whether to read the forwarded headers at all. See <see cref="TrustSetting"/>.</summary>
    public static bool ShouldTrust(IConfiguration configuration, bool isDevelopment) =>
        configuration.GetValue(TrustSetting, !isDevelopment);

    /// <summary>
    /// True when the host has already added the forwarded-headers middleware of its own accord.
    /// Adding a second one would be worse than adding none: the first pass removes the entry it
    /// consumed, so the second would read the entry *before* it — which is the one a caller can
    /// write themselves.
    ///
    /// <para>
    /// The test is the host's own, deliberately: the literal string <c>true</c>, compared without
    /// case, read from configuration rather than from the environment variable. Asking the same
    /// question the same way is what stops the two answers disagreeing — a value arriving from
    /// anything but the environment provider would be invisible to a check that read only the
    /// variable, and the guard would be bypassed in precisely the case it exists for.
    /// </para>
    /// </summary>
    public static bool HostAlreadyForwards(IConfiguration configuration) =>
        string.Equals("true", configuration[HostConfigurationKey], StringComparison.OrdinalIgnoreCase);
}
