using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace BusinessDirectory.Api;

/// <summary>
/// How this API describes itself as OpenAPI.
///
/// <para>
/// The brief asks for an OpenAPI document and `packages/api-client` is waiting on one: the plan is a
/// generated TypeScript client, and nothing could be generated while there was nothing to generate
/// from. This is that document.
/// </para>
/// <para>
/// <b>The route groups are the interesting part, so the document says so.</b> Every path in this API
/// belongs to exactly one audience — `/public` for anybody, `/customer`, `/me` for business owners,
/// `/admin`, `/super-admin` — and separate token audiences keep them apart. A reader of the raw
/// document would see forty paths in one undifferentiated list, so <see cref="AudienceTags"/> tags
/// each operation from its own path. Doing it from the path rather than by hand on each group is
/// deliberate: an endpoint added next week is tagged correctly without anyone remembering to.
/// </para>
/// <para>
/// <b>It is not published by default outside Development.</b> A complete map of the administrative
/// surface is not something to hand out: every one of those routes already refuses an unauthorised
/// caller, so this is not the control that protects them, but there is no reason to advertise the
/// shape of the staff API to the internet either. Set <c>OpenApi:Enabled</c> to true where a
/// generator needs to read it — CI, or a staging deployment — and leave it off in production.
/// </para>
/// </summary>
public static class ApiDescription
{
    /// <summary>The configuration key that publishes the document outside Development.</summary>
    public const string EnabledSetting = "OpenApi:Enabled";

    /// <summary>
    /// The audiences, in the order a reader should meet them, with what each one is.
    ///
    /// Declared on the document rather than left implicit in the operations, for two reasons. A tag
    /// reference resolves its name against this list, so an operation tagged with something that is
    /// not here would serialise badly; and the order here is the order a generator or a viewer shows
    /// them in, which is worth choosing -- public first, staff last, because that is the order of
    /// how many people the surface is for.
    /// </summary>
    private static readonly (string Name, string Description)[] Audiences =
    [
        ("Public", "No token. Everything the directory shows to anybody."),
        ("Sign in", "No token, because these are what issue one. Four separate sign-ins for four separate identities."),
        ("Customer", "A customer's token: saved businesses, their reviews, their own details."),
        ("Business owner", "A business owner's token, and only for the listings that token is authorised for. A matching phone number is not proof of ownership."),
        ("Admin", "A staff token for the moderation surface."),
        ("Super admin", "A staff token for the platform surface: staff accounts, roles, the audit log. A separate audience from Admin, not a stronger claim on the same one."),
        ("Webhooks", "No token: a signed server-to-server callback. The signature is the authentication."),
        ("Health", "No token. Platform probes."),
        ("Other", "Not matched to an audience. A path here means a new route group that TagFor has not been told about."),
    ];

    /// <summary>
    /// Whether the document should be served. On in Development, because that is where a client is
    /// generated from it; elsewhere only when asked for.
    /// </summary>
    public static bool ShouldPublish(IConfiguration configuration, bool isDevelopment) =>
        configuration.GetValue(EnabledSetting, isDevelopment);

    /// <summary>
    /// Fills in what the framework cannot infer: who this API is for, and that most of it needs a
    /// bearer token.
    ///
    /// The security scheme is declared but not applied to every operation, because it is not true of
    /// every operation — `/public` needs no token at all. Each group's own authorization metadata is
    /// what marks the rest, and <see cref="AudienceTags"/> records the audience a token must carry.
    /// </summary>
    public sealed class Describe : IOpenApiDocumentTransformer
    {
        public Task TransformAsync(
            OpenApiDocument document,
            OpenApiDocumentTransformerContext context,
            CancellationToken cancellationToken)
        {
            document.Info = new OpenApiInfo
            {
                Title = "HYDERABAD LINKS API",
                Version = "v1",
                Description =
                    "A location-first business directory for Hyderabad.\n\n"
                    + "Paths are grouped by audience, and the groups are kept apart by separate token "
                    + "audiences rather than by convention: a token issued for one will not open "
                    + "another.\n\n"
                    + "- `/api/v1/public` needs no token.\n"
                    + "- `/api/v1/customer` needs a customer token.\n"
                    + "- `/api/v1/me` needs a business owner's token.\n"
                    + "- `/api/v1/admin` and `/api/v1/super-admin` need a staff token for that surface, "
                    + "and every permission is re-read from the database on each request.\n\n"
                    + "A customer is not a business owner: they are separate identities in separate "
                    + "tables with separate sign-ins (decision D56).",
            };

            document.Tags = new HashSet<OpenApiTag>(
                Audiences.Select(a => new OpenApiTag { Name = a.Name, Description = a.Description }));

            document.Components ??= new OpenApiComponents();
            document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
            document.Components.SecuritySchemes["bearer"] = new OpenApiSecurityScheme
            {
                Type = SecuritySchemeType.Http,
                Scheme = "bearer",
                BearerFormat = "JWT",
                Description =
                    "A short-lived access token from the sign-in for that audience. The websites hold "
                    + "it server-side and call this API server-to-server; a browser never sees it.",
            };

            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// Tags each operation with the audience its path belongs to, so the document reads in the shape
    /// the API is actually built in.
    /// </summary>
    public sealed class AudienceTags : IOpenApiOperationTransformer
    {
        public Task TransformAsync(
            OpenApiOperation operation,
            OpenApiOperationTransformerContext context,
            CancellationToken cancellationToken)
        {
            var tag = TagFor(context.Description.RelativePath ?? string.Empty);
            operation.Tags = new HashSet<OpenApiTagReference> { new(tag, context.Document) };
            return Task.CompletedTask;
        }

        /// <summary>
        /// The audience a path belongs to. Ordered most specific first: `/api/v1/auth/admin` is a
        /// sign-in rather than part of the administrative surface, and the sign-ins are worth reading
        /// together because they are the four separate identities this platform has.
        /// </summary>
        public static string TagFor(string relativePath)
        {
            var path = "/" + relativePath.TrimStart('/');

            return path switch
            {
                _ when path.StartsWith("/api/v1/auth/", StringComparison.Ordinal) => "Sign in",
                _ when path.StartsWith("/api/v1/public", StringComparison.Ordinal) => "Public",
                _ when path.StartsWith("/api/v1/customer", StringComparison.Ordinal) => "Customer",
                _ when path.StartsWith("/api/v1/me", StringComparison.Ordinal) => "Business owner",
                _ when path.StartsWith("/api/v1/super-admin", StringComparison.Ordinal) => "Super admin",
                _ when path.StartsWith("/api/v1/admin", StringComparison.Ordinal) => "Admin",
                _ when path.StartsWith("/api/v1/webhooks", StringComparison.Ordinal) => "Webhooks",
                _ when path.StartsWith("/health", StringComparison.Ordinal) => "Health",
                _ => "Other",
            };
        }
    }
}
