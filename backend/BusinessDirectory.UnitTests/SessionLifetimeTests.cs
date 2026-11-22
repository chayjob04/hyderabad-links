using BusinessDirectory.Api.Auth;
using Microsoft.Extensions.Configuration;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// A session lasts one day, for all four kinds of account, and both halves of it end together.
///
/// <para>
/// They used to last fifteen minutes. The access token was the whole session -- no frontend has
/// ever spent a refresh token, though <c>/api/v1/auth/owner/refresh</c> and its customer and admin
/// siblings all exist -- so a quarter of an hour was the real answer to "how long can I stay signed
/// in", and switching tabs or stepping away for a coffee was enough to be asked again. The refresh
/// tokens were set to thirty days (seven for an admin) and never used, so they neither extended a
/// session nor bounded it.
/// </para>
/// <para>
/// Both halves are now one day. That is what makes "signing in again is required after a day" true
/// rather than nominal: with a thirty-day refresh token still in the cookie jar, a session that
/// looked expired could be revived by any future code that started calling refresh.
/// </para>
/// </summary>
public class SessionLifetimeTests
{
    private const int OneDayInMinutes = 60 * 24;

    private static readonly AuthSettings Defaults = AuthSettings.Load(
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            // Load refuses to start without these; the lifetimes are what this file is about.
            ["Auth:JwtSigningKey"] = new string('k', 64),
            ["Auth:OtpHmacKey"] = new string('o', 64),
            ["Auth:TotpEncryptionKey"] = new string('t', 64),
        }).Build(),
        isDevelopment: false);

    [Fact]
    public void An_owner_or_customer_session_lasts_a_day()
    {
        Assert.Equal(OneDayInMinutes, Defaults.AccessTokenMinutes);
        Assert.Equal(1, Defaults.RefreshTokenDays);
    }

    [Fact]
    public void An_admin_or_platform_owner_session_lasts_a_day()
    {
        Assert.Equal(OneDayInMinutes, Defaults.AdminAccessTokenMinutes);
        Assert.Equal(1, Defaults.AdminRefreshTokenDays);
    }

    [Fact]
    public void Both_halves_of_a_session_end_together()
    {
        /* The access token is what every request carries and the refresh token is the only thing
           that could outlive it. If the refresh token were the longer of the two, a session would
           be expired in practice and revivable in principle. */
        Assert.Equal(TimeSpan.FromMinutes(Defaults.AccessTokenMinutes), TimeSpan.FromDays(Defaults.RefreshTokenDays));
        Assert.Equal(
            TimeSpan.FromMinutes(Defaults.AdminAccessTokenMinutes),
            TimeSpan.FromDays(Defaults.AdminRefreshTokenDays));
    }

    [Fact]
    public void A_token_is_issued_with_the_lifetime_the_settings_name()
    {
        /* Through TokenService, so this is the lifetime a signed-in person actually gets rather than
           the number in the settings object. ExpiresInSeconds is what the websites turn into a
           cookie lifetime, so it is the one that decides when a tab stops working. */
        var tokens = new TokenService(Defaults);

        Assert.Equal(OneDayInMinutes * 60, tokens.CreateAccessToken(1).ExpiresInSeconds);
        Assert.Equal(OneDayInMinutes * 60, tokens.CreateCustomerAccessToken(1).ExpiresInSeconds);
        Assert.Equal(OneDayInMinutes * 60, tokens.CreateAdminAccessToken(1).ExpiresInSeconds);
        Assert.Equal(OneDayInMinutes * 60, tokens.CreateSuperAdminAccessToken(1).ExpiresInSeconds);
    }

    [Fact]
    public void The_lifetimes_can_still_be_set_from_configuration()
    {
        // The defaults are a policy, not a ceiling: an operator can still shorten them without a
        // deployment, which is the only way to tighten this in a hurry.
        var settings = AuthSettings.Load(
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Auth:JwtSigningKey"] = new string('k', 64),
                ["Auth:OtpHmacKey"] = new string('o', 64),
                ["Auth:TotpEncryptionKey"] = new string('t', 64),
                ["Auth:AccessTokenMinutes"] = "30",
                ["Auth:AdminAccessTokenMinutes"] = "45",
                ["Auth:RefreshTokenDays"] = "2",
                ["Auth:AdminRefreshTokenDays"] = "3",
            }).Build(),
            isDevelopment: false);

        Assert.Equal(30, settings.AccessTokenMinutes);
        Assert.Equal(45, settings.AdminAccessTokenMinutes);
        Assert.Equal(2, settings.RefreshTokenDays);
        Assert.Equal(3, settings.AdminRefreshTokenDays);
    }

    [Fact]
    public void The_half_finished_sign_in_stays_short()
    {
        /* The MFA token is not a session: it is the gap between a correct password and a correct
           authenticator code, and lengthening sessions must not have lengthened that. */
        Assert.Equal(5, Defaults.AdminMfaTokenMinutes);
        Assert.True(
            Defaults.AdminMfaTokenMinutes < Defaults.AdminAccessTokenMinutes,
            "the half-finished sign-in must be shorter than a session");
    }
}
