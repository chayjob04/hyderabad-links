using BusinessDirectory.Api.Data;
using System.Data;
using System.Net;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Customer reviews, under three audiences: the public reads approved ones, a signed-in customer
/// writes one, and an administrator moderates.
///
/// Decision D11 is enforced in two places that matter:
///   - the reviewer must be a phone-verified user, which the token already proves
///   - nothing appears publicly until a moderator approves it
/// </summary>
public static class ReviewEndpoints
{
    public sealed record SubmitReviewRequest(int? Rating, string? Body);

    /// <param name="AuthorName">The reviewer's first name only. Reviews are not anonymous, but a
    /// full name and phone number are not the public's business either.</param>
    public sealed record PublicReviewDto(long Id, short Rating, string Body, string AuthorName, DateTimeOffset CreatedAt);

    /// <param name="Average">Null when nothing has been approved yet, rather than 0, which would
    /// read as "rated zero".</param>
    public sealed record ReviewSummaryDto(double? Average, int Count, IReadOnlyList<PublicReviewDto> Items);

    /// <param name="Status">pending, approved or rejected — the reviewer can see what happened.</param>
    public sealed record MyReviewDto(
        long Id,
        long ListingId,
        string ListingName,
        string Url,
        short Rating,
        string Body,
        string Status,
        string? ModerationNote,
        DateTimeOffset CreatedAt);

    public sealed record ModerationReviewDto(
        long Id,
        long ListingId,
        string ListingName,
        short Rating,
        string Body,
        string ReviewerPhone,
        DateTimeOffset CreatedAt);

    public sealed record ModerationPage(IReadOnlyList<ModerationReviewDto> Items, int Page, int PageSize, int Total, int TotalPages);

    public sealed record DecisionRequest(string? Note);

    private const int PublicPageSize = 10;
    private const int ModerationPageSize = 20;

    public static RouteGroupBuilder MapPublicReviewEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/listings/{citySlug}/{localitySlug}/{slug}/reviews", GetPublicReviews);
        return group;
    }

    public static RouteGroupBuilder MapCustomerReviewEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/reviews/{citySlug}/{localitySlug}/{slug}", Submit);
        group.MapGet("/reviews", ListMine);
        return group;
    }

    public static RouteGroupBuilder MapAdminReviewEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/reviews", ListForModeration);
        group.MapPost("/reviews/{id:long}/approve", Approve);
        group.MapPost("/reviews/{id:long}/reject", Reject);
        return group;
    }

    // ------------------------------------------------------------------ public
    private static async Task<IResult> GetPublicReviews(
        string citySlug,
        string localitySlug,
        string slug,
        SqlDatabase db,
        CancellationToken ct)
    {
        // Only approved reviews, and only for a live listing. The average is computed over the same
        // set the visitor can read, so the number and the list can never disagree.
        await using var command = db.CreateCommand(
            @"WITH target AS (
                  SELECT li.id
                  FROM listings li
                  JOIN localities lo ON lo.id = li.locality_id
                  JOIN cities ci ON ci.id = lo.city_id
                  WHERE ci.slug = @city AND lo.slug = @locality AND li.slug = @slug AND li.status = 'active'
              ),
              approved AS (
                  /* Two LEFT JOINs, not one JOIN. A review written since the identity split has a
                     customer_id and no user_id; one written before it may still have only a
                     user_id until S0027 drops the column. An inner join on either would silently
                     drop half the reviews. */
                  SELECT r.id, r.rating, r.body, r.created_at,
                         COALESCE(c.name, u.name) AS author_name
                  FROM reviews r
                  JOIN target t ON t.id = r.listing_id
                  LEFT JOIN customers c ON c.id = r.customer_id
                  LEFT JOIN users u ON u.id = r.user_id
                  WHERE r.status = 'approved'
              )
              SELECT (SELECT COUNT_BIG(*) FROM approved),
                     /* The cast has to be inside the average, not outside it: AVG over a smallint
                        column does integer arithmetic in SQL Server, so 4 and 5 would average to 4. */
                     (SELECT AVG(CAST(rating AS float)) FROM approved),
                     a.id, a.rating, a.body, a.author_name, a.created_at
              FROM (SELECT 1 AS one) AS always_one_row
              LEFT JOIN (SELECT TOP (@limit) * FROM approved ORDER BY created_at DESC) a ON 1 = 1
              ORDER BY a.created_at DESC");
        command.Parameters.AddWithValue("city", citySlug);
        command.Parameters.AddWithValue("locality", localitySlug);
        command.Parameters.AddWithValue("slug", slug);
        command.Parameters.AddWithValue("limit", PublicPageSize);

        await using var reader = await command.ExecuteReaderAsync(ct);
        var items = new List<PublicReviewDto>();
        var count = 0;
        double? average = null;
        while (await reader.ReadAsync(ct))
        {
            count = (int)reader.GetInt64(0);
            average = reader.IsDBNull(1) ? null : Math.Round(reader.GetDouble(1), 1);
            if (reader.IsDBNull(2))
            {
                continue;   // the placeholder row: nothing approved yet
            }

            items.Add(new PublicReviewDto(
                reader.GetInt64(2),
                reader.GetInt16(3),
                reader.GetString(4),
                FirstNameOf(reader.IsDBNull(5) ? null : reader.GetString(5)),
                reader.GetFieldValue<DateTimeOffset>(6)));
        }

        return Results.Ok(new ReviewSummaryDto(average, count, items));
    }

    /// <summary>A reviewer is identified by their first name only; the rest is not public.</summary>
    private static string FirstNameOf(string? name)
    {
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return "A customer";
        }

        var space = trimmed.IndexOf(' ');
        return space > 0 ? trimmed[..space] : trimmed;
    }

    // ------------------------------------------------------------------ customer: write one
    private static async Task<IResult> Submit(
        string citySlug,
        string localitySlug,
        string slug,
        SubmitReviewRequest request,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!CustomerAccess.TryGetCustomerId(principal, out var customerId))
        {
            return Results.Unauthorized();
        }

        var validation = ReviewValidator.Validate(new ReviewInput(request.Rating, request.Body));
        if (validation.Value is not { } review)
        {
            return Results.ValidationProblem(validation.Errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        /* D11: the reviewer must have verified a phone number. Every customer reaches the site
           through the OTP flow, so this is belt and braces against a future path that does not.

           The phone comes back with it, because it is the only thing that connects a customer to
           the businesses they own. Since the identity split, a customer id means nothing to
           `business_members`; the number is what the two identities share. */
        string reviewerPhone;
        await using (var verified = new SqlCommand(
            // A yes/no answer is a bit in SQL Server, not a bare condition.
            @"SELECT phone_e164, CAST(CASE WHEN phone_verified_at IS NOT NULL THEN 1 ELSE 0 END AS bit)
              FROM customers WHERE id = @id AND status = 'active'", conn, tx))
        {
            verified.Parameters.AddWithValue("id", customerId);
            await using var reader = await verified.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct) || !reader.GetBoolean(1))
            {
                return Results.Problem(
                    "Verify your mobile number before writing a review.",
                    statusCode: StatusCodes.Status403Forbidden);
            }
            reviewerPhone = reader.GetString(0);
        }

        long listingId;
        bool ownsIt;
        await using (var find = new SqlCommand(
            @"SELECT li.id,
                     -- EXISTS is a condition, so reading it as a column means wrapping it in a CASE.
                     -- Matched on the verified phone number, not on an id: a customer id is not a
                     -- business member and never will be. The owner account with the same number is.
                     CAST(CASE WHEN EXISTS (SELECT 1 FROM business_members bm
                                            JOIN users ou ON ou.id = bm.user_id
                                            WHERE bm.business_id = li.business_id AND ou.phone_e164 = @phone)
                               THEN 1 ELSE 0 END AS bit)
              FROM listings li
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              WHERE ci.slug = @city AND lo.slug = @locality AND li.slug = @slug AND li.status = 'active'", conn, tx))
        {
            find.Parameters.AddWithValue("city", citySlug);
            find.Parameters.AddWithValue("locality", localitySlug);
            find.Parameters.AddWithValue("slug", slug);
            find.Parameters.AddWithValue("phone", reviewerPhone);
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.NotFound();
            }
            listingId = reader.GetInt64(0);
            ownsIt = reader.GetBoolean(1);
        }

        // Reviewing your own business is the most obvious way to manufacture a rating.
        if (ownsIt)
        {
            return Results.Problem(
                "You cannot review a business you manage.",
                statusCode: StatusCodes.Status403Forbidden);
        }

        try
        {
            await using var insert = new SqlCommand(
                @"INSERT INTO reviews (listing_id, customer_id, rating, body)
                  OUTPUT inserted.id
                  VALUES (@listing, @customer, @rating, @body)", conn, tx);
            insert.Parameters.AddWithValue("listing", listingId);
            insert.Parameters.AddWithValue("customer", customerId);
            insert.Parameters.AddWithValue("rating", review.Rating);
            insert.Parameters.AddWithValue("body", review.Body);
            var id = (long)(await insert.ExecuteScalarAsync(ct))!;
            await tx.CommitAsync(ct);

            // 202, not 201: it exists, but nothing is public until a moderator approves it.
            return Results.Accepted($"/api/v1/customer/reviews", new { id, status = "pending" });
        }
        catch (SqlException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            // The unique constraint, not an API check, is what makes one-per-person true.
            return Results.Problem(
                "You have already reviewed this business.",
                statusCode: StatusCodes.Status409Conflict);
        }
    }

    // ------------------------------------------------------------------ customer: see their own
    private static async Task<IResult> ListMine(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!CustomerAccess.TryGetCustomerId(principal, out var customerId))
        {
            return Results.Unauthorized();
        }

        await using var command = db.CreateCommand(
            @"SELECT r.id, r.listing_id, li.name, ci.slug, lo.slug, pc.slug, li.slug,
                     r.rating, r.body, r.status, r.moderation_note, r.created_at
              FROM reviews r
              JOIN listings li ON li.id = r.listing_id
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              JOIN categories pc ON pc.id = lc.category_id
              WHERE r.customer_id = @customer
              ORDER BY r.created_at DESC");
        command.Parameters.AddWithValue("customer", customerId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        var items = new List<MyReviewDto>();
        while (await reader.ReadAsync(ct))
        {
            items.Add(new MyReviewDto(
                reader.GetInt64(0),
                reader.GetInt64(1),
                reader.GetString(2),
                $"/{reader.GetString(3)}/{reader.GetString(4)}/{reader.GetString(5)}/{reader.GetString(6)}",
                reader.GetInt16(7),
                reader.GetString(8),
                reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.GetFieldValue<DateTimeOffset>(11)));
        }

        return Results.Ok(items);
    }

    // ------------------------------------------------------------------ admin: moderate
    private static async Task<IResult> ListForModeration(
        string? status,
        int? page,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return Results.Unauthorized();
        }
        if (AdminAccess.Authorize(admin, AdminPermissions.ReportsHandle) is { } refusal)
        {
            return refusal;
        }

        var wanted = status?.Trim().ToLowerInvariant() ?? "pending";
        if (wanted is not ("pending" or "approved" or "rejected"))
        {
            return Results.Problem("Unknown status filter.", statusCode: StatusCodes.Status400BadRequest);
        }

        var currentPage = Math.Max(page ?? 1, 1);

        await using var command = db.CreateCommand(
            @"WITH matching AS (
                  -- LEFT JOINs for the same reason as the public query above: a review has a
                  -- customer_id or a user_id, and the moderator must see it either way.
                  SELECT r.id, r.listing_id, li.name AS listing_name, r.rating, r.body,
                         COALESCE(c.phone_e164, u.phone_e164) AS phone_e164, r.created_at
                  FROM reviews r
                  JOIN listings li ON li.id = r.listing_id
                  LEFT JOIN customers c ON c.id = r.customer_id
                  LEFT JOIN users u ON u.id = r.user_id
                  WHERE r.status = @status
              ),
              page AS (
                  SELECT * FROM matching ORDER BY created_at OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY
              )
              SELECT (SELECT COUNT_BIG(*) FROM matching),
                     p.id, p.listing_id, p.listing_name, p.rating, p.body, p.phone_e164, p.created_at
              FROM (SELECT 1 AS one) AS always_one_row
              LEFT JOIN page p ON 1 = 1
              ORDER BY p.created_at");
        command.Parameters.AddWithValue("status", wanted);
        command.Parameters.AddWithValue("size", ModerationPageSize);
        command.Parameters.AddWithValue("offset", (currentPage - 1) * ModerationPageSize);

        await using var reader = await command.ExecuteReaderAsync(ct);
        var items = new List<ModerationReviewDto>();
        var total = 0;
        while (await reader.ReadAsync(ct))
        {
            total = (int)reader.GetInt64(0);
            if (reader.IsDBNull(1))
            {
                continue;
            }

            items.Add(new ModerationReviewDto(
                reader.GetInt64(1),
                reader.GetInt64(2),
                reader.GetString(3),
                reader.GetInt16(4),
                reader.GetString(5),
                reader.GetString(6),
                reader.GetFieldValue<DateTimeOffset>(7)));
        }

        var totalPages = (int)Math.Ceiling(total / (double)ModerationPageSize);
        return Results.Ok(new ModerationPage(items, currentPage, ModerationPageSize, total, totalPages));
    }

    private static Task<IResult> Approve(
        long id,
        DecisionRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct) =>
        Decide(id, "approved", request.Note, principal, http, db, ct);

    private static Task<IResult> Reject(
        long id,
        DecisionRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct) =>
        Decide(id, "rejected", request.Note, principal, http, db, ct);

    private static async Task<IResult> Decide(
        long id,
        string status,
        string? note,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return Results.Unauthorized();
        }
        if (AdminAccess.Authorize(admin, AdminPermissions.ReportsHandle) is { } refusal)
        {
            return refusal;
        }

        var trimmedNote = note?.Trim();
        if (trimmedNote is { Length: 0 })
        {
            trimmedNote = null;
        }
        if (trimmedNote is { Length: > 1000 })
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["note"] = ["Note must be 1000 characters or fewer."],
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        // Only a pending review can be decided, so two moderators cannot both record a decision.
        await using (var update = new SqlCommand(
            @"UPDATE reviews
              SET status = @status, moderation_note = @note, moderated_at = SYSDATETIMEOFFSET(),
                  moderated_by_admin_id = @admin, updated_at = SYSDATETIMEOFFSET()
              OUTPUT inserted.id
              WHERE id = @id AND status = 'pending'", conn, tx))
        {
            update.Parameters.AddWithValue("status", status);
            update.Parameters.Add(new SqlParameter("note", SqlDbType.NVarChar) { Value = (object?)trimmedNote ?? DBNull.Value });
            update.Parameters.AddWithValue("admin", admin.Id);
            update.Parameters.AddWithValue("id", id);
            if (await update.ExecuteScalarAsync(ct) is null)
            {
                return Results.NotFound();
            }
        }

        await using (var audit = new SqlCommand(
            @"INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, ip)
              VALUES ('admin', @admin, @action, 'review', @entity, @ip)", conn, tx))
        {
            IPAddress? ip = http.Connection.RemoteIpAddress;
            audit.Parameters.AddWithValue("admin", admin.Id);
            audit.Parameters.AddWithValue("action", status == "approved" ? "review.approved" : "review.rejected");
            audit.Parameters.AddWithValue("entity", id.ToString());
            audit.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
            await audit.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return Results.NoContent();
    }
}
