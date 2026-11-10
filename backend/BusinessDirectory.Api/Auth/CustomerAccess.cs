using System.Security.Claims;
using Microsoft.IdentityModel.JsonWebTokens;

namespace BusinessDirectory.Api.Auth;

/// <summary>
/// The customer realm: people who save businesses and write reviews, held in `customers` and
/// signed in through /api/v1/auth/customer.
///
/// This is deliberately as thin as it looks. A customer has no roles and no permissions — there is
/// nothing to load from the database beyond the row itself, which the handlers read where they need
/// it. What matters here is the scheme and the policy.
///
/// Both realms put a bare subject id in the token and sign it with the same key, so the audience is
/// the only thing telling a customer token from an owner token. The scheme validates the audience
/// and the policy pins the scheme; without that pinning an owner token would satisfy a customer
/// route and the other way round. A customer id reaching a route that reads `users` would also be
/// refused by the foreign keys, but the scheme is the control and the keys are the backstop.
/// </summary>
public static class CustomerAccess
{
    /// <summary>JWT scheme: same signing key, but it only accepts the customer audience.</summary>
    public const string Scheme = "CustomerBearer";

    /// <summary>Authorization policy name. It pins the scheme, so an owner token cannot satisfy it.</summary>
    public const string Policy = "Customer";

    /// <summary>Reads the customer's id from the validated token.</summary>
    public static bool TryGetCustomerId(ClaimsPrincipal principal, out long customerId)
    {
        var sub = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        return long.TryParse(
            sub,
            System.Globalization.NumberStyles.None,
            System.Globalization.CultureInfo.InvariantCulture,
            out customerId);
    }
}
