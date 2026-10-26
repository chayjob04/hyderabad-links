using System.Security.Cryptography;

namespace BusinessDirectory.Api.Auth;

/// <summary>
/// Login settings for owners and admins. Secrets come from configuration (Key Vault / environment variables in Azure), never from source code.
/// In Development, missing keys are replaced by random ones generated at startup (sessions then end on every restart).
/// Outside Development, missing or weak keys stop the app from starting.
/// </summary>
public sealed class AuthSettings
{
    public const string OwnerAudience = "owner";

    /// <summary>
    /// Admin tokens carry their own audience, so an owner token presented on an /api/v1/admin route
    /// fails validation outright instead of relying on a permission check further in.
    /// (The super-admin surface gets "superadmin" when it is built; see docs/security.md.)
    /// </summary>
    public const string AdminAudience = "admin";

    /// <summary>
    /// Platform administration (/api/v1/super-admin). A separate audience from
    /// <see cref="AdminAudience"/>, so an ordinary administrator's token is refused by the
    /// super-admin scheme outright rather than relying on a permission check inside a handler.
    /// </summary>
    public const string SuperAdminAudience = "super-admin";

    /// <summary>
    /// The audience a token carries between the password step and the TOTP step. It is deliberately
    /// *not* <see cref="AdminAudience"/>: the admin scheme validates the audience, so a half-finished
    /// sign-in fails validation on every admin route rather than depending on a check somewhere in
    /// the handler. That is what stops a password-only session acting.
    /// </summary>
    public const string AdminMfaAudience = "admin-mfa";

    /// <summary>
    /// The same idea for an admin who has no authenticator yet: this audience reaches the enrollment
    /// endpoints and nothing else.
    /// </summary>
    public const string AdminEnrollAudience = "admin-enroll";

    public required byte[] JwtKey { get; init; }
    public required byte[] OtpKey { get; init; }

    /// <summary>Encrypts `admin_users.totp_secret_encrypted`. See <see cref="TotpSecrets"/> for why.</summary>
    public required byte[] TotpKey { get; init; }
    public string Issuer { get; init; } = "hyderabadlinks-api";
    public string Audience { get; init; } = OwnerAudience;
    public int AccessTokenMinutes { get; init; } = 15;
    public int RefreshTokenDays { get; init; } = 30;
    public int OtpTtlSeconds { get; init; } = 300;
    public int ResendCooldownSeconds { get; init; } = 30;
    public int MaxOtpPerPhonePerHour { get; init; } = 5;
    public int MaxOtpPerIpPerHour { get; init; } = 20;

    /// <summary>
    /// The one code every login uses while <see cref="DummyOtpEnabled"/> is on. Not a secret: the
    /// point of it is that whoever is testing already knows it without reading an SMS.
    /// </summary>
    public const string DummyOtpCode = "123456";

    /// <summary>
    /// Development and testing only (`Auth:DummyOtpEnabled`). When on, every login code is
    /// <see cref="DummyOtpCode"/> and no SMS is sent, so owner sign-in can be exercised before
    /// MSG91 delivery is proven. Only the code's *value* changes: it is still hashed, stored,
    /// rate-limited, attempt-counted and consumed the same way, so the account, the session and the
    /// tokens are the production path exactly.
    ///
    /// It is an authentication bypass — anyone who can reach the API can sign in as any phone
    /// number — so it is off unless configuration turns it on, announced on every start
    /// (`Program.cs`) and logged on every code issued (`OwnerAuthEndpoints`). It is temporary;
    /// remove the setting to remove the behaviour.
    /// </summary>
    public bool DummyOtpEnabled { get; init; }

    // Admin sign-in. Shorter-lived than an owner session: admins work in sittings, owners come back weeks later.
    public int AdminAccessTokenMinutes { get; init; } = 15;
    public int AdminRefreshTokenDays { get; init; } = 7;

    /// <summary>Wrong passwords allowed before the account is locked for <see cref="AdminLockoutMinutes"/>.</summary>
    public int AdminMaxFailedLogins { get; init; } = 5;
    public int AdminLockoutMinutes { get; init; } = 15;

    /// <summary>
    /// How long the half-finished sign-in lasts. Short on purpose: it only has to cover reading a
    /// code off a phone, and it is the window in which a stolen password is one factor short.
    /// </summary>
    public int AdminMfaTokenMinutes { get; init; } = 5;

    /// <summary>Wrong TOTP codes or recovery codes allowed per sign-in attempt before it is abandoned.</summary>
    public int AdminMaxMfaAttempts { get; init; } = 5;

    public static AuthSettings Load(IConfiguration configuration, bool isDevelopment)
    {
        var section = configuration.GetSection("Auth");
        return new AuthSettings
        {
            JwtKey = ReadKey(section["JwtSigningKey"], "Auth:JwtSigningKey", isDevelopment),
            OtpKey = ReadKey(section["OtpHmacKey"], "Auth:OtpHmacKey", isDevelopment),
            // AES-256-GCM needs exactly 32 bytes, so a longer key is cut rather than refused.
            TotpKey = ReadKey(section["TotpEncryptionKey"], "Auth:TotpEncryptionKey", isDevelopment)[..TotpSecrets.KeyBytes],
            Issuer = section["Issuer"] ?? "hyderabadlinks-api",
            AccessTokenMinutes = section.GetValue("AccessTokenMinutes", 15),
            RefreshTokenDays = section.GetValue("RefreshTokenDays", 30),
            OtpTtlSeconds = section.GetValue("OtpTtlSeconds", 300),
            ResendCooldownSeconds = section.GetValue("ResendCooldownSeconds", 30),
            MaxOtpPerPhonePerHour = section.GetValue("MaxOtpPerPhonePerHour", 5),
            MaxOtpPerIpPerHour = section.GetValue("MaxOtpPerIpPerHour", 20),
            DummyOtpEnabled = section.GetValue("DummyOtpEnabled", false),
            AdminAccessTokenMinutes = section.GetValue("AdminAccessTokenMinutes", 15),
            AdminRefreshTokenDays = section.GetValue("AdminRefreshTokenDays", 7),
            AdminMaxFailedLogins = section.GetValue("AdminMaxFailedLogins", 5),
            AdminLockoutMinutes = section.GetValue("AdminLockoutMinutes", 15),
            AdminMfaTokenMinutes = section.GetValue("AdminMfaTokenMinutes", 5),
            AdminMaxMfaAttempts = section.GetValue("AdminMaxMfaAttempts", 5),
        };
    }

    private static byte[] ReadKey(string? base64, string name, bool isDevelopment)
    {
        if (string.IsNullOrWhiteSpace(base64))
        {
            if (isDevelopment)
            {
                return RandomNumberGenerator.GetBytes(32);
            }
            throw new InvalidOperationException($"{name} must be set (base64, at least 32 bytes) outside Development.");
        }

        byte[] key;
        try
        {
            key = Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            throw new InvalidOperationException($"{name} must be a base64 string.");
        }

        if (key.Length < 32)
        {
            throw new InvalidOperationException($"{name} must decode to at least 32 bytes.");
        }
        return key;
    }
}
