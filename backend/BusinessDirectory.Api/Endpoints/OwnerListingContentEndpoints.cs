using System.Security.Claims;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// An owner's FAQs and content sections, under /api/v1/me/listings/{id}/faqs and /content.
///
/// These are the first things the Verified plan buys that are not a badge, a photo or a link, so
/// the allowance is enforced exactly the way media is (OwnerMediaEndpoints): the count is taken
/// inside the same transaction that inserts the row, with the listing locked first, so two
/// requests arriving together cannot both see room for the last one.
///
/// A Free listing has an allowance of zero, which is why the refusal message says what the plan
/// allows rather than simply "no": an owner who hits this should learn what the paid plan does.
///
/// Rows beyond the allowance are kept and hidden, never deleted (D10). The views
/// `listing_visible_faqs` and `listing_visible_content` (S0020) decide what the public sees, so a
/// lapsed plan hides the extras and a renewal brings them back with nothing having to run.
/// </summary>
public static class OwnerListingContentEndpoints
{
    public const int MaxQuestionLength = 300;
    public const int MaxAnswerLength = 2000;
    public const int MaxHeadingLength = 200;
    public const int MaxBodyLength = 4000;

    public sealed record FaqDto(long Id, string Question, string Answer, int SortOrder);

    public sealed record FaqRequest(string? Question, string? Answer, int? SortOrder);

    public sealed record ContentDto(long Id, string Heading, string Body, int SortOrder);

    public sealed record ContentRequest(string? Heading, string? Body, int? SortOrder);

    /// <param name="Limit">What the current plan allows. 0 on Free.</param>
    /// <param name="Used">How many exist, including any over the allowance that are hidden.</param>
    public sealed record CollectionDto<T>(IReadOnlyList<T> Items, int Limit, int Used, string PlanName);

    public static RouteGroupBuilder MapOwnerListingContentEndpoints(this RouteGroupBuilder listings)
    {
        listings.MapGet("/{id:long}/faqs", ListFaqs);
        listings.MapPost("/{id:long}/faqs", AddFaq);
        listings.MapDelete("/{id:long}/faqs/{faqId:long}", DeleteFaq);

        listings.MapGet("/{id:long}/content", ListContent);
        listings.MapPost("/{id:long}/content", AddContent);
        listings.MapDelete("/{id:long}/content/{sectionId:long}", DeleteContent);
        return listings;
    }

    // ------------------------------------------------------------------ FAQs
    private static async Task<IResult> ListFaqs(
        long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var allowance = await ReadAllowance(conn, null, userId, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        await using var command = new SqlCommand(
            @"SELECT id, question, answer, sort_order
              FROM dbo.listing_faqs WHERE listing_id = @listing
              ORDER BY sort_order, id", conn);
        command.Parameters.AddWithValue("listing", id);

        var items = new List<FaqDto>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                items.Add(new FaqDto(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3)));
            }
        }

        return Results.Ok(new CollectionDto<FaqDto>(items, allowance.FaqLimit, items.Count, allowance.PlanName));
    }

    private static async Task<IResult> AddFaq(
        long id, FaqRequest request, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        var question = request.Question?.Trim() ?? string.Empty;
        var answer = request.Answer?.Trim() ?? string.Empty;
        if (Validate(question, "question", MaxQuestionLength, answer, "answer", MaxAnswerLength) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var allowance = await ReadAllowance(conn, tx, userId, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        var used = await CountAsync(conn, tx, "dbo.listing_faqs", id, ct);
        if (used >= allowance.FaqLimit)
        {
            return Results.Problem(
                allowance.FaqLimit == 0
                    ? $"The {allowance.PlanName} plan does not include FAQs."
                    : $"The {allowance.PlanName} plan allows {allowance.FaqLimit} FAQs. Remove one first.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await using var insert = new SqlCommand(
            @"INSERT INTO dbo.listing_faqs (listing_id, question, answer, sort_order)
              OUTPUT INSERTED.id
              VALUES (@listing, @question, @answer, @sort)", conn, tx);
        insert.Parameters.AddWithValue("listing", id);
        insert.Parameters.AddWithValue("question", question);
        insert.Parameters.AddWithValue("answer", answer);
        insert.Parameters.AddWithValue("sort", request.SortOrder ?? used);
        var newId = (long)(await insert.ExecuteScalarAsync(ct))!;

        await tx.CommitAsync(ct);
        return Results.Created(
            $"/api/v1/me/listings/{id}/faqs/{newId}",
            new FaqDto(newId, question, answer, request.SortOrder ?? used));
    }

    private static Task<IResult> DeleteFaq(
        long id, long faqId, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct) =>
        DeleteRow(id, faqId, "dbo.listing_faqs", principal, db, ct);

    // ------------------------------------------------------------------ content sections
    private static async Task<IResult> ListContent(
        long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var allowance = await ReadAllowance(conn, null, userId, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        await using var command = new SqlCommand(
            @"SELECT id, heading, body, sort_order
              FROM dbo.listing_content_sections WHERE listing_id = @listing
              ORDER BY sort_order, id", conn);
        command.Parameters.AddWithValue("listing", id);

        var items = new List<ContentDto>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                items.Add(new ContentDto(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3)));
            }
        }

        return Results.Ok(new CollectionDto<ContentDto>(
            items, allowance.ContentLimit, items.Count, allowance.PlanName));
    }

    private static async Task<IResult> AddContent(
        long id, ContentRequest request, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        var heading = request.Heading?.Trim() ?? string.Empty;
        var body = request.Body?.Trim() ?? string.Empty;
        if (Validate(heading, "heading", MaxHeadingLength, body, "body", MaxBodyLength) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var allowance = await ReadAllowance(conn, tx, userId, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        var used = await CountAsync(conn, tx, "dbo.listing_content_sections", id, ct);
        if (used >= allowance.ContentLimit)
        {
            return Results.Problem(
                allowance.ContentLimit == 0
                    ? $"The {allowance.PlanName} plan does not include content sections."
                    : $"The {allowance.PlanName} plan allows {allowance.ContentLimit} sections. Remove one first.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await using var insert = new SqlCommand(
            @"INSERT INTO dbo.listing_content_sections (listing_id, heading, body, sort_order)
              OUTPUT INSERTED.id
              VALUES (@listing, @heading, @body, @sort)", conn, tx);
        insert.Parameters.AddWithValue("listing", id);
        insert.Parameters.AddWithValue("heading", heading);
        insert.Parameters.AddWithValue("body", body);
        insert.Parameters.AddWithValue("sort", request.SortOrder ?? used);
        var newId = (long)(await insert.ExecuteScalarAsync(ct))!;

        await tx.CommitAsync(ct);
        return Results.Created(
            $"/api/v1/me/listings/{id}/content/{newId}",
            new ContentDto(newId, heading, body, request.SortOrder ?? used));
    }

    private static Task<IResult> DeleteContent(
        long id, long sectionId, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct) =>
        DeleteRow(id, sectionId, "dbo.listing_content_sections", principal, db, ct);

    // ------------------------------------------------------------------ shared
    /// <summary>Both kinds have the same two-field shape, so they share the rules.</summary>
    public static Dictionary<string, string[]>? Validate(
        string first, string firstName, int firstMax, string second, string secondName, int secondMax)
    {
        var errors = new Dictionary<string, string[]>();

        if (first.Length == 0)
        {
            errors[firstName] = [$"Enter a {firstName}."];
        }
        else if (first.Length > firstMax)
        {
            errors[firstName] = [$"Keep the {firstName} under {firstMax} characters."];
        }

        if (second.Length == 0)
        {
            errors[secondName] = [$"Enter {(secondName == "answer" ? "an" : "a")} {secondName}."];
        }
        else if (second.Length > secondMax)
        {
            errors[secondName] = [$"Keep the {secondName} under {secondMax} characters."];
        }

        return errors.Count > 0 ? errors : null;
    }

    private sealed record Allowance(int FaqLimit, int ContentLimit, string PlanName);

    /// <summary>
    /// The allowance for a listing this user owns, or null when they do not own it.
    ///
    /// Read from `listing_entitlements`, never from `listings.plan_slug`: the view works the plan
    /// out against the clock, so a lapsed subscription is Free here the instant it expires with no
    /// job having run. The listing row is locked when this is called inside a write, so the count
    /// taken next already includes any concurrent insert.
    /// </summary>
    private static async Task<Allowance?> ReadAllowance(
        SqlConnection conn, SqlTransaction? tx, long userId, long listingId, CancellationToken ct)
    {
        var lockHint = tx is null ? string.Empty : " WITH (UPDLOCK, ROWLOCK)";
        await using var command = new SqlCommand(
            $@"SELECT e.faq_limit, e.content_section_limit, e.effective_plan_name
               FROM dbo.listings li{lockHint}
               JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
               JOIN dbo.listing_entitlements e ON e.listing_id = li.id
               WHERE li.id = @listing", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("listing", listingId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct)
            ? new Allowance(reader.GetInt32(0), reader.GetInt32(1), reader.GetString(2))
            : null;
    }

    private static async Task<int> CountAsync(
        SqlConnection conn, SqlTransaction tx, string table, long listingId, CancellationToken ct)
    {
        // The table name is a compile-time constant from this file, never user input.
        await using var command = new SqlCommand(
            $"SELECT COUNT_BIG(*) FROM {table} WHERE listing_id = @listing", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);
        return (int)(long)(await command.ExecuteScalarAsync(ct))!;
    }

    /// <summary>
    /// Deletes one row, with the listing id in the WHERE clause as well as the row id so an owner
    /// cannot remove something from another listing by guessing its number.
    /// </summary>
    private static async Task<IResult> DeleteRow(
        long listingId, long rowId, string table, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        if (await ReadAllowance(conn, null, userId, listingId, ct) is null)
        {
            return Results.NotFound();
        }

        await using var command = new SqlCommand(
            $"DELETE FROM {table} WHERE id = @row AND listing_id = @listing", conn);
        command.Parameters.AddWithValue("row", rowId);
        command.Parameters.AddWithValue("listing", listingId);
        await command.ExecuteNonQueryAsync(ct);

        // No rows deleted means it was already gone. The caller's intent is true either way.
        return Results.NoContent();
    }
}
