using BusinessDirectory.Api.Data;
using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Abuse reports about a listing or a review (V0009), under two audiences: anyone can send one, and
/// a moderator holding <c>reports.handle</c> works through them.
///
/// Reporting deliberately does not require an account. The people most likely to spot a fake listing
/// are the customers it tried to catch, and asking them to sign in first would mean most of them
/// simply do not report it. The trade is abuse of the reporting itself, which is why the limits
/// below are counted in the database rather than trusted to the client.
/// </summary>
public static class ReportEndpoints
{
    public sealed record SubmitReportRequest(string? Reason, string? Details);

    public sealed record ReportDto(
        long Id,
        string SubjectType,
        long SubjectId,
        /// <summary>The listing's name, or the name of the listing the reported review is on.</summary>
        string SubjectName,
        /// <summary>The reported review's text. Null for a reported listing.</summary>
        string? ReviewBody,
        string Reason,
        string? Details,
        string Status,
        string? ResolutionNote,
        DateTimeOffset CreatedAt);

    public sealed record ReportPage(IReadOnlyList<ReportDto> Items, int Page, int PageSize, int Total, int TotalPages);

    public sealed record DecisionRequest(string? Note);

    /// <summary>The reasons the schema accepts, offered to the UI so the two cannot drift apart.</summary>
    public static readonly string[] Reasons =
        ["not_a_real_business", "wrong_details", "closed_down", "offensive_content", "spam", "other"];

    private const int PageSize = 20;

    /// <summary>
    /// Per-address limits. A genuine customer reports one or two things; a hundred in an hour is
    /// someone trying to bury a competitor, and the queue is a human being's time.
    /// </summary>
    private const int MaxPerIpPerDay = 20;
    private const int MaxPerSubjectPerIp = 3;

    public static RouteGroupBuilder MapPublicReportEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/report-reasons", () => Results.Ok(Reasons));
        group.MapPost("/listings/{citySlug}/{localitySlug}/{slug}/reports", ReportListing);
        group.MapPost("/reviews/{id:long}/reports", ReportReview);
        return group;
    }

    public static RouteGroupBuilder MapAdminReportEndpoints(this RouteGroupBuilder admin)
    {
        admin.MapGet("/reports", List);
        admin.MapPost("/reports/{id:long}/action", MarkActioned);
        admin.MapPost("/reports/{id:long}/dismiss", Dismiss);
        return admin;
    }

    // ------------------------------------------------------------------ sending one
    private static async Task<IResult> ReportListing(
        string citySlug,
        string localitySlug,
        string slug,
        SubmitReportRequest request,
        HttpContext http,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        // Only a live listing can be reported: anything else has no public page to complain about.
        await using var find = db.CreateCommand(
            @"SELECT li.id
              FROM listings li
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              WHERE ci.slug = @city AND lo.slug = @locality AND li.slug = @slug AND li.status = 'active'");
        find.Parameters.AddWithValue("city", citySlug);
        find.Parameters.AddWithValue("locality", localitySlug);
        find.Parameters.AddWithValue("slug", slug);
        if (await find.ExecuteScalarAsync(ct) is not long listingId)
        {
            return Results.NotFound();
        }

        return await Insert("listing", listingId, request, http, principal, db, ct);
    }

    private static async Task<IResult> ReportReview(
        long id,
        SubmitReportRequest request,
        HttpContext http,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        // Only a published review can be reported. A pending or rejected one is not public, so a
        // report about it would be a way of discovering that it exists.
        await using var find = db.CreateCommand("SELECT id FROM reviews WHERE id = @id AND status = 'approved'");
        find.Parameters.AddWithValue("id", id);
        if (await find.ExecuteScalarAsync(ct) is not long reviewId)
        {
            return Results.NotFound();
        }

        return await Insert("review", reviewId, request, http, principal, db, ct);
    }

    private static async Task<IResult> Insert(
        string subjectType,
        long subjectId,
        SubmitReportRequest request,
        HttpContext http,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        var reason = request.Reason?.Trim().ToLowerInvariant();
        if (reason is null || !Reasons.Contains(reason))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["Choose a reason."] });
        }

        var details = request.Details?.Trim();
        if (details is { Length: 0 })
        {
            details = null;
        }
        if (details is { Length: > 2000 })
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["details"] = ["Keep it to 2000 characters or fewer."],
            });
        }
        if (reason == "other" && details is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["details"] = ["Tell us what is wrong, so a moderator knows what to look at."],
            });
        }

        /* A signed-in reporter is recorded; a visitor is not, and that is fine (see the class
           comment). This is a public route, so the default scheme has already run and `principal`
           holds an owner if one is signed in. A customer token carries a different audience and is
           invisible to that scheme, so it is asked for separately — otherwise every report from a
           customer would be anonymous, which is a step backwards from where this started. */
        long? userId = MeEndpoints.TryGetUserId(principal, out var id) ? id : null;
        long? customerId = null;
        if (userId is null)
        {
            var customer = await http.AuthenticateAsync(CustomerAccess.Scheme);
            if (customer.Principal is { } customerPrincipal
                && CustomerAccess.TryGetCustomerId(customerPrincipal, out var foundCustomerId))
            {
                customerId = foundCustomerId;
            }
        }
        var ip = http.Connection.RemoteIpAddress;

        await using var conn = await db.OpenConnectionAsync(ct);
        await using (var limits = new SqlCommand(
            @"SELECT
                (SELECT COUNT_BIG(*) FROM reports
                 WHERE reporter_ip = @ip AND created_at > DATEADD(day, -1, SYSDATETIMEOFFSET())),
                (SELECT COUNT_BIG(*) FROM reports
                 WHERE reporter_ip = @ip AND subject_type = @type AND subject_id = @subject)", conn))
        {
            limits.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
            limits.Parameters.AddWithValue("type", subjectType);
            limits.Parameters.AddWithValue("subject", subjectId);
            await using var reader = await limits.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            if (reader.GetInt64(0) >= MaxPerIpPerDay || reader.GetInt64(1) >= MaxPerSubjectPerIp)
            {
                // The same answer whether the day's limit or this subject's was reached, so repeating
                // the request cannot be used to work out which.
                return Results.Problem(
                    "You have sent us enough reports for now. We are looking at them.",
                    statusCode: StatusCodes.Status429TooManyRequests);
            }
        }

        await using (var insert = new SqlCommand(
            @"INSERT INTO reports (subject_type, subject_id, reason, details,
                                   reported_by_user_id, reported_by_customer_id, reporter_ip)
              VALUES (@type, @subject, @reason, @details, @user, @customer, @ip)", conn))
        {
            insert.Parameters.AddWithValue("type", subjectType);
            insert.Parameters.AddWithValue("subject", subjectId);
            insert.Parameters.AddWithValue("reason", reason);
            insert.Parameters.AddWithValue("details", (object?)details ?? DBNull.Value);
            insert.Parameters.AddWithValue("user", (object?)userId ?? DBNull.Value);
            insert.Parameters.AddWithValue("customer", (object?)customerId ?? DBNull.Value);
            insert.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
            await insert.ExecuteNonQueryAsync(ct);
        }

        // 202, not 201: the report exists, but nothing has happened to the listing yet, and the
        // reporter should not be told it has.
        return Results.Accepted();
    }

    // ------------------------------------------------------------------ moderation
    private static async Task<IResult> List(
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

        var wanted = status?.Trim().ToLowerInvariant() ?? "open";
        if (wanted is not ("open" or "actioned" or "dismissed"))
        {
            return Results.Problem("Unknown status filter.", statusCode: StatusCodes.Status400BadRequest);
        }

        var currentPage = Math.Max(page ?? 1, 1);

        // One query for both kinds of subject: a reported listing joins straight to `listings`, and a
        // reported review joins through to the listing it is on, so the queue always names a business.
        await using var command = db.CreateCommand(
            @"WITH matching AS (
                  SELECT r.id, r.subject_type, r.subject_id, r.reason, r.details, r.status,
                         r.resolution_note, r.created_at,
                         COALESCE(li.name, rli.name) AS subject_name,
                         rv.body AS review_body
                  FROM reports r
                  LEFT JOIN listings li ON r.subject_type = 'listing' AND li.id = r.subject_id
                  LEFT JOIN reviews rv ON r.subject_type = 'review' AND rv.id = r.subject_id
                  LEFT JOIN listings rli ON rli.id = rv.listing_id
                  WHERE r.status = @status
              ),
              page AS (
                  SELECT * FROM matching ORDER BY created_at OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY
              )
              SELECT (SELECT COUNT_BIG(*) FROM matching),
                     p.id, p.subject_type, p.subject_id, p.subject_name, p.review_body,
                     p.reason, p.details, p.status, p.resolution_note, p.created_at
              FROM (SELECT 1 AS one) AS always_one_row
              LEFT JOIN page p ON 1 = 1
              ORDER BY p.created_at");
        command.Parameters.AddWithValue("status", wanted);
        command.Parameters.AddWithValue("size", PageSize);
        command.Parameters.AddWithValue("offset", (currentPage - 1) * PageSize);

        await using var reader = await command.ExecuteReaderAsync(ct);
        var items = new List<ReportDto>();
        var total = 0;
        while (await reader.ReadAsync(ct))
        {
            total = (int)reader.GetInt64(0);
            if (reader.IsDBNull(1))
            {
                continue;   // the placeholder row: this page holds no reports
            }

            items.Add(new ReportDto(
                reader.GetInt64(1),
                reader.GetString(2),
                reader.GetInt64(3),
                // A listing deleted since the report leaves nothing to name.
                reader.IsDBNull(4) ? "(removed)" : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.GetString(8),
                reader.IsDBNull(9) ? null : reader.GetString(9),
                reader.GetFieldValue<DateTimeOffset>(10)));
        }

        var totalPages = (int)Math.Ceiling(total / (double)PageSize);
        return Results.Ok(new ReportPage(items, currentPage, PageSize, total, totalPages));
    }

    private static Task<IResult> MarkActioned(
        long id, DecisionRequest request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        Decide(id, "actioned", request.Note, principal, http, db, ct);

    private static Task<IResult> Dismiss(
        long id, DecisionRequest request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        Decide(id, "dismissed", request.Note, principal, http, db, ct);

    /// <summary>
    /// Closes a report. "Actioned" records that something was done about the subject (suspending the
    /// listing, rejecting the review); the doing of it is a separate, audited action on its own
    /// endpoint, so closing a report never changes a listing by itself.
    /// </summary>
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

        var trimmed = note?.Trim();
        if (trimmed is { Length: 0 })
        {
            trimmed = null;
        }
        if (trimmed is { Length: > 1000 })
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["note"] = ["Keep the note to 1000 characters or fewer."],
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        // Only an open report can be closed, so two moderators cannot both record an outcome.
        await using (var update = new SqlCommand(
            @"UPDATE reports
              SET status = @status, resolution_note = @note, handled_at = SYSDATETIMEOFFSET(),
                  handled_by_admin_id = @admin, updated_at = SYSDATETIMEOFFSET()
              OUTPUT inserted.id
              WHERE id = @id AND status = 'open'", conn, tx))
        {
            update.Parameters.AddWithValue("status", status);
            update.Parameters.AddWithValue("note", (object?)trimmed ?? DBNull.Value);
            update.Parameters.AddWithValue("admin", admin.Id);
            update.Parameters.AddWithValue("id", id);
            if (await update.ExecuteScalarAsync(ct) is null)
            {
                return Results.NotFound();
            }
        }

        await using (var audit = new SqlCommand(
            @"INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, details, ip)
              VALUES ('admin', @admin, @action, 'report', @id, @details, @ip)", conn, tx))
        {
            audit.Parameters.AddWithValue("admin", admin.Id);
            audit.Parameters.AddWithValue("action", status == "actioned" ? "report.actioned" : "report.dismissed");
            audit.Parameters.AddWithValue("id", id.ToString(System.Globalization.CultureInfo.InvariantCulture));
            audit.Parameters.AddWithValue("details", System.Text.Json.JsonSerializer.Serialize(new { note = trimmed }));
            audit.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar)
            {
                Value = (object?)http.Connection.RemoteIpAddress?.ToString() ?? DBNull.Value,
            });
            await audit.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return Results.NoContent();
    }
}
