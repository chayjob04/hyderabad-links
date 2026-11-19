using BusinessDirectory.Api;
// ForwardedHeadersOptions is in Microsoft.AspNetCore.Builder; the ForwardedHeaders flags are in
// Microsoft.AspNetCore.HttpOverrides. Program.cs gets the first from the web SDK's implicit usings
// and this project does not, so both are spelled out here.
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;

namespace BusinessDirectory.UnitTests;

// Behind Azure App Service the caller's address arrives in X-Forwarded-For, and everything that
// limits by IP -- the global rate limiter, the OTP allowance, the enquiry and report limits -- reads
// Connection.RemoteIpAddress. These tests pin the two things that make that both work and stay safe:
// exactly one hop is read, and the header is not trusted when there is no proxy in front.
public class ClientIpForwardingTests
{
    private static IConfiguration Configuration(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    [Fact]
    public void It_reads_the_forwarded_address_and_the_forwarded_scheme()
    {
        var options = new ForwardedHeadersOptions();

        ClientIpForwarding.Configure(options);

        Assert.True(options.ForwardedHeaders.HasFlag(ForwardedHeaders.XForwardedFor));
        // TLS is terminated at the front end; without this every request looks like plain HTTP.
        Assert.True(options.ForwardedHeaders.HasFlag(ForwardedHeaders.XForwardedProto));
    }

    // The whole security argument for clearing the known-proxy lists. App Service appends the real
    // address to whatever the caller sent, so reading one hop takes the entry the proxy wrote.
    // Raising this would start trusting the caller's own value.
    [Fact]
    public void It_reads_exactly_one_hop()
    {
        var options = new ForwardedHeadersOptions();

        ClientIpForwarding.Configure(options);

        Assert.Equal(1, options.ForwardLimit);
    }

    [Fact]
    public void It_clears_the_known_proxy_lists_because_App_Services_front_ends_are_not_in_them()
    {
        var options = new ForwardedHeadersOptions();

        ClientIpForwarding.Configure(options);

        Assert.Empty(options.KnownIPNetworks);
        Assert.Empty(options.KnownProxies);
    }

    [Fact]
    public void Production_trusts_the_proxy_by_default()
    {
        Assert.True(ClientIpForwarding.ShouldTrust(Configuration(), isDevelopment: false));
    }

    // Locally there is no proxy, so a trusted X-Forwarded-For would let any caller claim any
    // address -- including one that has not spent its OTP allowance.
    [Fact]
    public void Development_does_not()
    {
        Assert.False(ClientIpForwarding.ShouldTrust(Configuration(), isDevelopment: true));
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    public void Configuration_overrides_the_default_either_way(string value, bool expected)
    {
        Assert.Equal(
            expected,
            ClientIpForwarding.ShouldTrust(
                Configuration((ClientIpForwarding.TrustSetting, value)),
                isDevelopment: !expected));
    }

    // A caller who sends their own X-Forwarded-For makes the two headers asymmetric, and with
    // symmetry required that discards both -- handing them a way to switch the real address back
    // off. The default is false; the point of asserting it is that it is now set, not inherited.
    [Fact]
    public void It_does_not_require_the_two_headers_to_carry_the_same_number_of_entries()
    {
        var options = new ForwardedHeadersOptions();

        ClientIpForwarding.Configure(options);

        Assert.False(options.RequireHeaderSymmetry);
    }

    // Two passes of the middleware would read one entry too far to the left, which is the entry a
    // caller can write for themselves -- so when the host has already enabled it, the application
    // must not add a second. Read from configuration, which is where the host reads it: a value
    // arriving from anything but the environment provider must still be seen.
    [Theory]
    [InlineData("true", true)]
    [InlineData("True", true)]
    [InlineData("TRUE", true)]
    [InlineData("false", false)]
    [InlineData("", false)]
    [InlineData("1", false)]   // the host tests for the literal "true" and so does this
    public void The_hosts_own_switch_is_detected(string value, bool expected)
    {
        var configuration = Configuration((ClientIpForwarding.HostConfigurationKey, value));

        Assert.Equal(expected, ClientIpForwarding.HostAlreadyForwards(configuration));
    }

    [Fact]
    public void With_the_hosts_switch_unset_the_application_adds_the_middleware_itself()
    {
        Assert.False(ClientIpForwarding.HostAlreadyForwards(Configuration()));
    }

    // The environment variable the host reads is this key with the ASPNETCORE_ prefix, which the
    // environment provider strips. If either name drifts the guard stops matching the host.
    [Fact]
    public void The_configuration_key_and_the_environment_variable_name_agree()
    {
        Assert.Equal(
            ClientIpForwarding.HostEnvironmentVariable,
            "ASPNETCORE_" + ClientIpForwarding.HostConfigurationKey.ToUpperInvariant());
    }
}
