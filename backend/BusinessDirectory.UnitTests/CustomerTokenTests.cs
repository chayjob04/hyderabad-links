using System.Security.Cryptography;
using BusinessDirectory.Api.Auth;
using Microsoft.IdentityModel.JsonWebTokens;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// The customer identity is separated from the owner identity by one thing only: the audience on
/// the token. Both are signed with the same key and carry nothing but a subject id, so if audience
/// validation ever stopped working, an owner token would open a customer's saved list and a
/// customer token would open a business dashboard.
///
/// These are the tests that would notice.
/// </summary>
public class CustomerTokenTests
{
    private static AuthSettings NewSettings() => new()
    {
        JwtKey = RandomNumberGenerator.GetBytes(32),
        OtpKey = RandomNumberGenerator.GetBytes(32),
        TotpKey = RandomNumberGenerator.GetBytes(TotpSecrets.KeyBytes),
    };

    [Fact]
    public async Task Customer_token_round_trips_and_carries_the_customer_id()
    {
        var service = new TokenService(NewSettings());
        var (token, expiresIn) = service.CreateCustomerAccessToken(7);

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, service.CustomerValidationParameters);

        Assert.True(result.IsValid);
        Assert.Equal("7", result.ClaimsIdentity.FindFirst(JwtRegisteredClaimNames.Sub)?.Value);
        Assert.Equal(15 * 60, expiresIn);
    }

    [Fact]
    public async Task A_customer_token_is_refused_everywhere_else()
    {
        var service = new TokenService(NewSettings());
        var token = service.CreateCustomerAccessToken(7).Token;
        var handler = new JsonWebTokenHandler();

        Assert.False((await handler.ValidateTokenAsync(token, service.ValidationParameters)).IsValid);
        Assert.False((await handler.ValidateTokenAsync(token, service.AdminValidationParameters)).IsValid);
        Assert.False((await handler.ValidateTokenAsync(token, service.SuperAdminValidationParameters)).IsValid);
    }

    [Fact]
    public async Task An_owner_token_is_refused_on_the_customer_audience()
    {
        var service = new TokenService(NewSettings());
        var token = service.CreateAccessToken(7).Token;

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, service.CustomerValidationParameters);

        Assert.False(result.IsValid);
    }

    [Fact]
    public async Task An_admin_token_is_refused_on_the_customer_audience()
    {
        var service = new TokenService(NewSettings());
        var token = service.CreateAdminAccessToken(7).Token;

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, service.CustomerValidationParameters);

        Assert.False(result.IsValid);
    }

    /// <summary>
    /// The same subject id in both realms is a different account, which is the whole design: one
    /// phone number may hold a customer account and a business account independently. The tokens
    /// must therefore not be interchangeable even when the number inside them is identical.
    /// </summary>
    [Fact]
    public async Task The_same_id_in_both_realms_does_not_make_the_tokens_interchangeable()
    {
        var service = new TokenService(NewSettings());
        var customer = service.CreateCustomerAccessToken(42).Token;
        var owner = service.CreateAccessToken(42).Token;

        Assert.NotEqual(customer, owner);
        var handler = new JsonWebTokenHandler();
        Assert.False((await handler.ValidateTokenAsync(customer, service.ValidationParameters)).IsValid);
        Assert.False((await handler.ValidateTokenAsync(owner, service.CustomerValidationParameters)).IsValid);
    }

    [Fact]
    public void The_two_otp_purposes_are_distinct()
    {
        // A code minted for one sign-in must not open the other. OtpFlow puts `purpose` in the
        // lookup; this is the guard that the two constants never become the same string.
        Assert.NotEqual(OtpFlow.OwnerPurpose, OtpFlow.CustomerPurpose);
        Assert.Equal("owner_login", OtpFlow.OwnerPurpose);
        Assert.Equal("customer_login", OtpFlow.CustomerPurpose);
    }
}
