using BusinessDirectory.Api.Data;
using System.Data;
using System.Net;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// One-time registration for an owner who has verified their phone but has no profile yet
/// (decision D24). It fills in their name and email and creates their first business and draft
/// listing in a single transaction, so a failure leaves no half-made account.
///
/// There is no "verified phone" session to guard here, unlike the prototype this was modelled on:
/// verifying the OTP already created the user row and issued a token, so the caller's phone is
/// proven by the token itself. An owner who still needs this step is simply one whose name is null.
/// </summary>
public static class OwnerOnboardingEndpoints
{
    public sealed record OnboardingRequest(
        string? Name,
        string? Email,
        string? BusinessName,
        string? LocalitySlug,
        string? CategorySlug);

    public sealed record OnboardingResultDto(string Name, string Email, long? ListingId, bool Created);

    public static RouteGroupBuilder MapOwnerOnboardingEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/onboarding", Onboard);
        return group;
    }

    private static async Task<IResult> Onboard(
        OnboardingRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        // Locking the user row makes a double submit wait rather than race. The second one then sees
        // the name already set and takes the "already onboarded" path below instead of creating a
        // second business and listing.
        string phone;
        string? existingName;
        string? existingEmail;
        await using (var find = new SqlCommand(
            /* UPDLOCK + ROWLOCK is SQL Server's FOR UPDATE: it takes the update lock on the row
               as it is read, so two registrations for the same person queue instead of racing.
               HOLDLOCK keeps it to the end of the transaction, which FOR UPDATE also did. */
            @"SELECT phone_e164, name, email
              FROM users WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE id = @id AND status = 'active'", conn, tx))
        {
            find.Parameters.AddWithValue("id", userId);
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.Unauthorized();
            }
            phone = reader.GetString(0);
            existingName = reader.IsDBNull(1) ? null : reader.GetString(1);
            existingEmail = reader.IsDBNull(2) ? null : reader.GetString(2);
        }

        // Already registered. Because the name is written in the same transaction that creates the
        // business, a non-null name means the whole thing succeeded. Report what exists instead of
        // creating a duplicate, so a repeated request is harmless.
        if (existingName is not null)
        {
            var firstListingId = await FindFirstListingId(conn, tx, userId, ct);
            await tx.CommitAsync(ct);
            return Results.Ok(new OnboardingResultDto(existingName, existingEmail ?? "", firstListingId, Created: false));
        }

        var profile = ProfileValidator.Validate(new ProfileInput(request.Name, request.Email));
        if (profile.Value is not { } validProfile)
        {
            return Results.ValidationProblem(profile.Errors);
        }

        // The first listing reuses the ordinary owner-listing rules, so onboarding cannot create a
        // listing that the normal screens would reject. The phone falls back to the verified number.
        var listingInput = new ListingInput(
            Name: request.BusinessName,
            Description: null,
            CitySlug: ListingValidator.DefaultCity,
            LocalitySlug: request.LocalitySlug,
            CategorySlug: request.CategorySlug,
            AddressLine: null,
            Pincode: null,
            PhonePrimary: null,
            PhoneWhatsapp: null,
            WebsiteUrl: null,
            Latitude: null,
            Longitude: null);

        var listing = ListingValidator.Validate(listingInput, requireLocality: true, fallbackPhone: phone);
        if (listing.Value is not { } validListing)
        {
            // The form calls this field "business name", so point the error at the name the user typed.
            var errors = listing.Errors.ToDictionary(
                pair => pair.Key == "name" ? "businessName" : pair.Key,
                pair => pair.Value);
            return Results.ValidationProblem(errors);
        }

        var locality = await ListingWriter.FindLocality(conn, tx, validListing.CitySlug, validListing.LocalitySlug!, ct);
        if (locality is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["localitySlug"] = ["Unknown area."] });
        }

        var categoryId = await ListingWriter.FindCategoryId(conn, tx, validListing.CategorySlug, ct);
        if (categoryId is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["categorySlug"] = ["Unknown category."] });
        }

        long listingId;
        try
        {
            var slug = await ListingWriter.ChooseSlug(conn, tx, locality.Id, validListing.Name, ct);
            var businessId = await ListingWriter.InsertBusiness(conn, tx, validListing.Name, ct);

            await using (var member = new SqlCommand(
                "INSERT INTO business_members (business_id, user_id, role) VALUES (@business, @user, 'owner')", conn, tx))
            {
                member.Parameters.AddWithValue("business", businessId);
                member.Parameters.AddWithValue("user", userId);
                await member.ExecuteNonQueryAsync(ct);
            }

            /* A draft, and it has to be: onboarding asks for a business name, an area and a
               category, and nothing else — look at the AddressLine: null and Description: null
               above. A reviewer needs both, so queueing this now would put a listing with a blank
               address in front of a moderator whose only honest answer is to reject it.
               It queues itself the moment the owner saves those two fields, in
               OwnerListingEndpoints.Update; they never press a submit button. */
            listingId = await ListingWriter.InsertListing(
                conn, tx, businessId, locality, slug, validListing,
                status: "draft", source: "owner", createdByUserId: userId, ct);

            await ListingWriter.AddPrimaryCategory(conn, tx, listingId, categoryId.Value, ct);
        }
        catch (SqlException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            return Results.Problem("That name was just taken in this area. Please try a different one.", statusCode: StatusCodes.Status409Conflict);
        }

        // `name IS NULL` repeats the check made under the row lock, so this can never overwrite a
        // profile that was filled in by some other path.
        await using (var update = new SqlCommand(
            "UPDATE users SET name = @name, email = @email, updated_at = SYSDATETIMEOFFSET() WHERE id = @id AND name IS NULL", conn, tx))
        {
            update.Parameters.AddWithValue("name", validProfile.Name);
            update.Parameters.AddWithValue("email", validProfile.Email);
            update.Parameters.AddWithValue("id", userId);
            if (await update.ExecuteNonQueryAsync(ct) != 1)
            {
                return Results.Problem("Your account was registered a moment ago. Please reload the page.", statusCode: StatusCodes.Status409Conflict);
            }
        }

        await WriteAudit(conn, tx, userId, listingId, http, ct);
        await tx.CommitAsync(ct);

        return Results.Created($"/api/v1/me/listings/{listingId}",
            new OnboardingResultDto(validProfile.Name, validProfile.Email, listingId, Created: true));
    }

    private static async Task<long?> FindFirstListingId(SqlConnection conn, SqlTransaction tx, long userId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT TOP (1) li.id
              FROM listings li
              JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              WHERE li.status <> 'archived'
              ORDER BY li.created_at, li.id", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        return (long?)await command.ExecuteScalarAsync(ct);
    }

    private static async Task WriteAudit(
        SqlConnection conn, SqlTransaction tx, long userId, long listingId, HttpContext http, CancellationToken ct)
    {
        IPAddress? ip = http.Connection.RemoteIpAddress;
        await using var command = new SqlCommand(
            @"INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, ip)
              VALUES ('owner', @user, 'owner.onboarded', 'listing', @entity, @ip)", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("entity", listingId.ToString());
        command.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
        await command.ExecuteNonQueryAsync(ct);
    }
}
