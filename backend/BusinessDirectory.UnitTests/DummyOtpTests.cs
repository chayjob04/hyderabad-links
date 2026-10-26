using System.Security.Cryptography;
using BusinessDirectory.Api.Auth;
using Microsoft.Extensions.Configuration;

namespace BusinessDirectory.UnitTests;

// `Auth:DummyOtpEnabled` is a temporary testing switch (see AuthSettings for what it does and why
// it is loud). Two things about it are worth holding: it is off unless something explicitly turns
// it on, and the code it uses is one the existing OTP flow accepts without a special case.
//
// This file is the whole test surface of the feature, so it can be deleted with it.
public class DummyOtpTests
{
    private static AuthSettings Load(params (string Key, string? Value)[] settings) =>
        AuthSettings.Load(
            new ConfigurationBuilder()
                .AddInMemoryCollection(settings.Select(s => new KeyValuePair<string, string?>(s.Key, s.Value)))
                .Build(),
            // Development, so the signing keys this does not care about are generated rather than demanded.
            isDevelopment: true);

    [Fact]
    public void Is_off_when_nothing_is_configured() => Assert.False(Load().DummyOtpEnabled);

    [Theory]
    [InlineData("false")]
    [InlineData("False")]
    public void Is_off_when_configuration_says_so(string value) =>
        Assert.False(Load(("Auth:DummyOtpEnabled", value)).DummyOtpEnabled);

    [Theory]
    [InlineData("true")]
    [InlineData("True")]
    public void Is_on_only_when_configuration_says_true(string value) =>
        Assert.True(Load(("Auth:DummyOtpEnabled", value)).DummyOtpEnabled);

    [Fact]
    public void The_fixed_code_is_well_formed()
    {
        // VerifyOtp rejects a malformed code before it looks anything up, so a dummy code that
        // failed this check would be refused with 400 whatever was stored against it.
        Assert.True(OtpCodes.IsWellFormed(AuthSettings.DummyOtpCode));
    }

    [Fact]
    public void The_fixed_code_verifies_against_its_own_stored_hash()
    {
        // This is why nothing downstream needed changing: the dummy code is hashed and verified by
        // exactly the two calls a real one goes through.
        var key = RandomNumberGenerator.GetBytes(32);
        var hash = OtpCodes.Hash(key, "+919876543210", AuthSettings.DummyOtpCode);

        Assert.True(OtpCodes.Verify(key, "+919876543210", AuthSettings.DummyOtpCode, hash));
    }

    [Fact]
    public void A_different_code_is_still_refused_while_dummy_mode_is_on()
    {
        // The switch does not loosen verification: it only decides which code was issued. A caller
        // who guesses something else is refused exactly as before.
        var key = RandomNumberGenerator.GetBytes(32);
        var hash = OtpCodes.Hash(key, "+919876543210", AuthSettings.DummyOtpCode);

        Assert.False(OtpCodes.Verify(key, "+919876543210", "654321", hash));
    }
}
