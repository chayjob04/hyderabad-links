using System.Data;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Listings;

/// <summary>
/// The two INSERTs that add to the taxonomy: an area, and a category at any tier.
///
/// They live here because there are now two ways to reach each of them — an admin typing into the
/// categories or areas screen, and an admin approving an owner's request for one (S0032) — and a
/// second copy of either statement is how the two paths end up disagreeing about a default, a slug
/// or a parent level. The validation in front of them is the caller's: what a name may be, where an
/// area is on the map, and which tier a parent sits at are all decided before anything is written.
///
/// Both take the caller's transaction. Approving a suggestion inserts the row, marks the request and
/// writes the audit entry together, and a half-done approval would leave a request pointing at
/// nothing.
/// </summary>
public static class TaxonomyWriter
{
    /// <summary>
    /// Adds an area to a city. Returns its id, or null when the slug is already taken there.
    /// </summary>
    /// <remarks>
    /// 4326 is WGS 84 — the SRID the rest of the schema uses, and the one latitude and longitude
    /// from a map are expressed in. <c>geography::Point</c> takes latitude first, which is the
    /// opposite order to most map APIs and worth the comment every time.
    /// </remarks>
    public static async Task<int?> InsertLocalityAsync(
        SqlConnection conn,
        SqlTransaction tx,
        int cityId,
        string slug,
        string name,
        double latitude,
        double longitude,
        string? pincode,
        CancellationToken ct)
    {
        try
        {
            await using var insert = new SqlCommand(
                @"INSERT INTO dbo.localities (city_id, slug, name, center, pincode)
                  OUTPUT INSERTED.id
                  VALUES (@city, @slug, @name, geography::Point(@lat, @long, 4326), @pincode)", conn, tx);
            insert.Parameters.AddWithValue("city", cityId);
            insert.Parameters.Add(new SqlParameter("slug", SqlDbType.NVarChar) { Value = slug });
            insert.Parameters.Add(new SqlParameter("name", SqlDbType.NVarChar) { Value = name });
            insert.Parameters.AddWithValue("lat", latitude);
            insert.Parameters.AddWithValue("long", longitude);
            insert.Parameters.Add(new SqlParameter("pincode", SqlDbType.NVarChar)
            {
                Value = (object?)pincode ?? DBNull.Value,
            });
            return (int)(await insert.ExecuteScalarAsync(ct))!;
        }
        catch (SqlException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            // The caller words the refusal: it knows whether a person typed this name or asked for it.
            return null;
        }
    }

    /// <summary>
    /// Adds a segment, a category or a subcategory. Returns its id, or null when the slug is taken.
    /// </summary>
    /// <param name="level">
    /// The tier, from <see cref="CategoryTree"/>. <paramref name="parentId"/> must be a row at the
    /// tier above it — the table's composite foreign key enforces that, so a wrong pair is a failed
    /// insert rather than a bad row, but the caller should have checked first and said why.
    /// </param>
    public static async Task<int?> InsertCategoryAsync(
        SqlConnection conn,
        SqlTransaction tx,
        short level,
        int? parentId,
        string slug,
        string name,
        int sortOrder,
        CancellationToken ct)
    {
        try
        {
            await using var insert = new SqlCommand(
                @"INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name, sort_order)
                  OUTPUT INSERTED.id
                  VALUES (@level, @parent, @parentLevel, @slug, @name, @sort)", conn, tx);
            insert.Parameters.AddWithValue("level", level);
            insert.Parameters.Add(new SqlParameter("parent", SqlDbType.Int)
            {
                Value = (object?)parentId ?? DBNull.Value,
            });
            insert.Parameters.Add(new SqlParameter("parentLevel", SqlDbType.SmallInt)
            {
                // Null when nothing is above it: a segment, or a category with no segment yet.
                Value = parentId is null ? DBNull.Value : (object?)CategoryTree.ParentLevelFor(level) ?? DBNull.Value,
            });
            insert.Parameters.Add(new SqlParameter("slug", SqlDbType.NVarChar) { Value = slug });
            insert.Parameters.Add(new SqlParameter("name", SqlDbType.NVarChar) { Value = name });
            insert.Parameters.AddWithValue("sort", sortOrder);
            return (int)(await insert.ExecuteScalarAsync(ct))!;
        }
        catch (SqlException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            return null;
        }
    }
}
