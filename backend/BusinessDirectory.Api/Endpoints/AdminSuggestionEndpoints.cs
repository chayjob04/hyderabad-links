using System.Data;
using System.Globalization;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Requests from owners for an area or a category that does not exist — /api/v1/admin/suggestions.
///
/// Gated on <c>taxonomy.manage</c>, the same permission as the screens that add an area or a
/// category by hand, because approving one of these does exactly that.
///
/// <b>Approving is not a rubber stamp, and the schema will not let it be.</b> An area needs a point
/// on the map and a city; a category needs the category it belongs under. Those are facts only a
/// person has, so the approval request carries them and the row is written through
/// <see cref="TaxonomyWriter"/> — the same INSERT the admin screens use. The suggestion is then
/// marked approved <i>and</i> pointed at what it became, which the table's own CHECK requires: an
/// approved request with nothing to show for it cannot be stored.
///
/// Rejecting and "it already exists" both need a note, for the same reason a rejected listing does:
/// the owner asked a question and a status is not an answer.
/// </summary>
public static class AdminSuggestionEndpoints
{
    /// <param name="CitySlug">For an area: which city it is in. Hyderabad today, and the schema allows more.</param>
    /// <param name="ParentId">For a category: the category the new subcategory belongs under.</param>
    /// <param name="Name">
    /// Optional. The name to create it under, when staff want to tidy what was typed -- "hitech
    /// city" becoming "HITEC City". Left out, the owner's own words are used.
    /// </param>
    public sealed record ApproveRequest(
        string? Name,
        string? CitySlug,
        double? Latitude,
        double? Longitude,
        string? Pincode,
        int? ParentId,
        int? SortOrder);

    public sealed record NoteRequest(string? Note);

    public sealed record SuggestionDto(
        long Id,
        string Kind,
        string SuggestedName,
        string Status,
        string? Note,
        string? RequestedByPhone,
        string? RequestedByName,
        long? ListingId,
        string? ListingName,
        /// <summary>What it became, when it was approved. The area or category now in the directory.</summary>
        string? ResolvedName,
        DateTimeOffset CreatedAt,
        DateTimeOffset? ReviewedAt,
        string? ReviewedBy);

    public static RouteGroupBuilder MapAdminSuggestionEndpoints(this RouteGroupBuilder admin)
    {
        var group = admin.MapGroup("/suggestions");
        group.MapGet("", List);
        group.MapPost("/{id:long}/approve", Approve);
        group.MapPost("/{id:long}/reject", Reject);
        group.MapPost("/{id:long}/already-exists", MarkAlreadyExists);
        return admin;
    }

    private static async Task<(AdminIdentity? Admin, IResult? Refusal)> Gate(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return (null, Results.Unauthorized());
        }
        return (admin, AdminAccess.Authorize(admin, AdminPermissions.TaxonomyManage));
    }

    private static SuggestionDto ToDto(TaxonomySuggestion.Row row) => new(
        row.Id, row.Kind, row.SuggestedName, row.Status, row.Note,
        row.UserPhone, row.UserName, row.ListingId, row.ListingName,
        row.ResolvedName, row.CreatedAt, row.ReviewedAt, row.ReviewedBy);

    /// <summary>
    /// The queue. Pending by default, because that is the work; `all` to see what was decided.
    /// </summary>
    private static async Task<IResult> List(
        string? status, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var wanted = string.IsNullOrWhiteSpace(status)
            ? TaxonomySuggestion.Pending
            : status.Trim().ToLowerInvariant();
        if (wanted != "all" && !TaxonomySuggestion.Statuses.Contains(wanted))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["status"] = [$"Expected one of: {string.Join(", ", TaxonomySuggestion.Statuses)}, all."],
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            $@"{TaxonomySuggestion.Select}
               WHERE (@status = 'all' OR s.status = @status)
               ORDER BY CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END, s.created_at ASC",
            conn);
        command.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar) { Value = wanted });

        var items = new List<SuggestionDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(ToDto(TaxonomySuggestion.Read(reader)));
        }

        return Results.Ok(items);
    }

    /// <summary>
    /// Creates the area or the category the owner asked for, and records that this request is what
    /// it came from.
    /// </summary>
    private static async Task<IResult> Approve(
        long id,
        ApproveRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null || admin is null)
        {
            return refused ?? Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var suggestion = await LockPending(conn, tx, id, ct);
        if (suggestion is null)
        {
            return Results.NotFound();
        }

        /* The name to create it under: what staff typed, or the owner's words. Validated either
           way, through the taxonomy screens' own rules, so an approved request cannot create a row
           those screens would have refused. */
        if (!AdminTaxonomyEndpoints.TryReadName(
                string.IsNullOrWhiteSpace(request.Name) ? suggestion.SuggestedName : request.Name,
                out var name, out var nameError))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [nameError] });
        }
        if (!AdminTaxonomyEndpoints.TryReadSlug(name, out var slug, out var slugError))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [slugError] });
        }

        int createdId;
        string entityType;
        string auditAction;

        if (suggestion.Kind == TaxonomySuggestion.LocalityKind)
        {
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(request.CitySlug))
            {
                errors["citySlug"] = ["Choose a city."];
            }
            if (!AdminTaxonomyEndpoints.TryReadPoint(
                    request.Latitude, request.Longitude, out var latitude, out var longitude, out var pointError))
            {
                /* An area has to be somewhere: "near me" ranks by distance from this point, and the
                   area page's map is drawn from it. There is no sensible default, which is why
                   approving an area is a small form rather than a button. */
                errors["latitude"] = [pointError];
            }
            if (!AdminTaxonomyEndpoints.TryReadPincode(request.Pincode, out var pincode, out var pincodeError))
            {
                errors["pincode"] = [pincodeError];
            }
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            int cityId;
            await using (var city = new SqlCommand("SELECT id FROM dbo.cities WHERE slug = @slug", conn, tx))
            {
                city.Parameters.Add(new SqlParameter("slug", SqlDbType.NVarChar) { Value = request.CitySlug });
                if (await city.ExecuteScalarAsync(ct) is not int foundCity)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["citySlug"] = ["That city does not exist."],
                    });
                }
                cityId = foundCity;
            }

            if (await TaxonomyWriter.InsertLocalityAsync(
                    conn, tx, cityId, slug, name, latitude, longitude, pincode, ct) is not int localityId)
            {
                return Results.Problem(
                    $"This city already has an area with the web address '{slug}'. Mark the request as already existing instead, and say which area to use.",
                    statusCode: StatusCodes.Status409Conflict);
            }

            createdId = localityId;
            entityType = "locality";
            auditAction = "taxonomy.suggestion_approved_locality";

            await Resolve(conn, tx, suggestion.Id, admin.Id, localityId: createdId, categoryId: null, ct);
        }
        else
        {
            /* A category request becomes a **subcategory**, because that is the only tier a listing
               can be filed under: approving one as a top-level category would create a page nobody
               could be listed on. So the parent is required, and it has to be a category. */
            if (request.ParentId is not { } parentId)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["parentId"] = ["Choose the category this belongs under. Businesses are listed under a subcategory."],
                });
            }

            await using (var parent = new SqlCommand(
                "SELECT TOP (1) 1 FROM dbo.categories WHERE id = @id AND level = @level", conn, tx))
            {
                parent.Parameters.AddWithValue("id", parentId);
                parent.Parameters.AddWithValue("level", CategoryTree.CategoryLevel);
                if (await parent.ExecuteScalarAsync(ct) is null)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["parentId"] = ["That category does not exist."],
                    });
                }
            }

            if (await TaxonomyWriter.InsertCategoryAsync(
                    conn, tx, CategoryTree.SubcategoryLevel, parentId, slug, name,
                    request.SortOrder ?? 0, ct) is not int categoryId)
            {
                return Results.Problem(
                    $"Something already uses the web address '{slug}'. Mark the request as already existing instead, and say which category to use.",
                    statusCode: StatusCodes.Status409Conflict);
            }

            createdId = categoryId;
            entityType = "category";
            auditAction = "taxonomy.suggestion_approved_category";

            await Resolve(conn, tx, suggestion.Id, admin.Id, localityId: null, categoryId: createdId, ct);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, auditAction, entityType,
            createdId.ToString(CultureInfo.InvariantCulture), http,
            new { suggestionId = suggestion.Id, requested = suggestion.SuggestedName, slug, name }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    /// <summary>It will not be added, and the note says why. The owner reads that note.</summary>
    private static Task<IResult> Reject(
        long id, NoteRequest request, ClaimsPrincipal principal, HttpContext http,
        SqlDatabase db, CancellationToken ct) =>
        Decide(id, request, TaxonomySuggestion.Rejected, "taxonomy.suggestion_rejected", principal, http, db, ct);

    /// <summary>
    /// It is already in the directory under another name, and the note says which.
    /// </summary>
    /// <remarks>
    /// Not a rejection, and worth its own state: the owner was right to ask and the answer is "use
    /// this one". A rejection would read as "no", which would be wrong and unhelpful at once.
    /// </remarks>
    private static Task<IResult> MarkAlreadyExists(
        long id, NoteRequest request, ClaimsPrincipal principal, HttpContext http,
        SqlDatabase db, CancellationToken ct) =>
        Decide(id, request, TaxonomySuggestion.AlreadyExists, "taxonomy.suggestion_already_exists", principal, http, db, ct);

    private static async Task<IResult> Decide(
        long id,
        NoteRequest request,
        string status,
        string auditAction,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null || admin is null)
        {
            return refused ?? Results.Unauthorized();
        }

        var note = request.Note?.Trim();
        if (string.IsNullOrEmpty(note))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["note"] = [status == TaxonomySuggestion.AlreadyExists
                    ? "Say which area or category to use instead. The owner reads this."
                    : "Say why. The owner reads this."],
            });
        }
        if (note.Length > 1000)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["note"] = ["Keep it under 1000 characters."],
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var suggestion = await LockPending(conn, tx, id, ct);
        if (suggestion is null)
        {
            return Results.NotFound();
        }

        await using (var update = new SqlCommand(
            @"UPDATE dbo.taxonomy_suggestions
              SET status = @status,
                  note = @note,
                  reviewed_at = SYSDATETIMEOFFSET(),
                  reviewed_by_admin_id = @admin,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            update.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar) { Value = status });
            update.Parameters.Add(new SqlParameter("note", SqlDbType.NVarChar) { Value = note });
            update.Parameters.AddWithValue("admin", admin.Id);
            await update.ExecuteNonQueryAsync(ct);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, auditAction, "taxonomy_suggestion",
            id.ToString(CultureInfo.InvariantCulture), http,
            new { requested = suggestion.SuggestedName, kind = suggestion.Kind }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    /// <summary>Marks the request approved and points it at what it became.</summary>
    private static async Task Resolve(
        SqlConnection conn,
        SqlTransaction tx,
        long id,
        long adminId,
        int? localityId,
        int? categoryId,
        CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"UPDATE dbo.taxonomy_suggestions
              SET status = 'approved',
                  resolved_locality_id = @locality,
                  resolved_category_id = @category,
                  reviewed_at = SYSDATETIMEOFFSET(),
                  reviewed_by_admin_id = @admin,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("admin", adminId);
        command.Parameters.Add(new SqlParameter("locality", SqlDbType.Int) { Value = (object?)localityId ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("category", SqlDbType.Int) { Value = (object?)categoryId ?? DBNull.Value });
        await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Reads a request that is still pending and holds it for the rest of the transaction.
    /// </summary>
    /// <remarks>
    /// Two admins approving the same request at the same moment would otherwise create the area
    /// twice -- or rather, create it once and fail the second insert on the unique slug, after the
    /// first had already been recorded. The lock makes the second one find a request that is no
    /// longer pending and say so.
    /// </remarks>
    private static async Task<TaxonomySuggestion.Row?> LockPending(
        SqlConnection conn, SqlTransaction tx, long id, CancellationToken ct)
    {
        await using (var lockRow = new SqlCommand(
            @"SELECT TOP (1) 1 FROM dbo.taxonomy_suggestions WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE id = @id AND status = 'pending'", conn, tx))
        {
            lockRow.Parameters.AddWithValue("id", id);
            if (await lockRow.ExecuteScalarAsync(ct) is null)
            {
                return null;
            }
        }

        await using var command = new SqlCommand(
            $"{TaxonomySuggestion.Select} WHERE s.id = @id", conn, tx);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? TaxonomySuggestion.Read(reader) : null;
    }
}
