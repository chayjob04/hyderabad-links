using System.Security.Cryptography;
using BusinessDirectory.Api.Auth;
using Microsoft.IdentityModel.JsonWebTokens;

namespace BusinessDirectory.UnitTests;

public class TokenServiceTests
{
    private static AuthSettings NewSettings(string audience = AuthSettings.OwnerAudience) => new()
    {
        JwtKey = RandomNumberGenerator.GetBytes(32),
        OtpKey = RandomNumberGenerator.GetBytes(32),
        TotpKey = RandomNumberGenerator.GetBytes(TotpSecrets.KeyBytes),
        Audience = audience,
    };

    [Fact]
    public async Task Access_token_round_trips_and_carries_the_user_id()
    {
        var settings = NewSettings();
        var service = new TokenService(settings);
        var (token, expiresIn) = service.CreateAccessToken(42);

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, service.ValidationParameters);

        Assert.True(result.IsValid);
        Assert.Equal("42", result.ClaimsIdentity.FindFirst(JwtRegisteredClaimNames.Sub)?.Value);
        /* From the settings rather than a literal: this test is about the token round-tripping,
           and the lifetime is pinned once, in SessionLifetimeTests. It read 15 * 60. */
        Assert.Equal(settings.AccessTokenMinutes * 60, expiresIn);
    }

    [Fact]
    public async Task Token_signed_with_another_key_is_rejected()
    {
        var token = new TokenService(NewSettings()).CreateAccessToken(42).Token;
        var other = new TokenService(NewSettings());

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, other.ValidationParameters);

        Assert.False(result.IsValid);
    }

    [Fact]
    public async Task Token_for_another_audience_is_rejected()
    {
        var settings = NewSettings();
        var adminLike = new TokenService(new AuthSettings { JwtKey = settings.JwtKey, OtpKey = settings.OtpKey, TotpKey = settings.TotpKey, Audience = "admin" });
        var token = adminLike.CreateAccessToken(42).Token;

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, new TokenService(settings).ValidationParameters);

        Assert.False(result.IsValid);
    }

    [Fact]
    public async Task Admin_token_round_trips_and_carries_the_admin_id()
    {
        var settings = NewSettings();
        var service = new TokenService(settings);
        var (token, expiresIn) = service.CreateAdminAccessToken(7);

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, service.AdminValidationParameters);

        Assert.True(result.IsValid);
        Assert.Equal("7", result.ClaimsIdentity.FindFirst(JwtRegisteredClaimNames.Sub)?.Value);
        /* From the settings rather than a literal: this test is about the token round-tripping,
           and the lifetime is pinned once, in SessionLifetimeTests. It read 15 * 60. */
        Assert.Equal(settings.AdminAccessTokenMinutes * 60, expiresIn);
    }

    [Fact]
    public async Task An_owner_token_is_rejected_on_the_admin_audience()
    {
        // The admin routes validate with these parameters, so an owner token cannot reach them.
        var service = new TokenService(NewSettings());
        var ownerToken = service.CreateAccessToken(42).Token;

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(ownerToken, service.AdminValidationParameters);

        Assert.False(result.IsValid);
    }

    [Fact]
    public async Task An_admin_token_is_rejected_on_the_owner_audience()
    {
        var service = new TokenService(NewSettings());
        var adminToken = service.CreateAdminAccessToken(7).Token;

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(adminToken, service.ValidationParameters);

        Assert.False(result.IsValid);
    }

    [Fact]
    public void A_token_carries_no_permissions_so_revoking_a_role_takes_effect_at_once()
    {
        // Permissions are read from the database on every request. If they ever travelled in the token,
        // removing a role would only take effect when the token expired.
        var token = new TokenService(NewSettings()).CreateAdminAccessToken(7).Token;
        var payload = token.Split('.')[1];
        var json = System.Text.Encoding.UTF8.GetString(System.Buffers.Text.Base64Url.DecodeFromChars(payload));

        Assert.DoesNotContain("listings.", json, StringComparison.Ordinal);
        Assert.DoesNotContain("permission", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("role", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Refresh_tokens_are_unique_and_long()
    {
        var a = TokenService.NewRefreshToken();
        var b = TokenService.NewRefreshToken();
        Assert.NotEqual(a, b);
        Assert.True(a.Length >= 43);
    }

    [Fact]
    public void Refresh_token_hash_is_stable_and_is_not_the_token()
    {
        var token = TokenService.NewRefreshToken();
        Assert.Equal(TokenService.HashRefreshToken(token), TokenService.HashRefreshToken(token));
        Assert.NotEqual(TokenService.HashRefreshToken(token), TokenService.HashRefreshToken(token + "x"));
        Assert.Equal(32, TokenService.HashRefreshToken(token).Length);
    }
}
