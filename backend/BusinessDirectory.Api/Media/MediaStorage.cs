using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace BusinessDirectory.Api.Media;

/// <summary>
/// Where listing photos, logos and videos are kept. One interface, so the API code never knows
/// which storage account it is talking to: the difference is a connection string in configuration.
/// Development points at a dev or test account; there is no local emulator any more.
/// </summary>
public interface IMediaStorage
{
    /// <summary>
    /// False when no storage is configured. Endpoints answer 503 instead of recording a database row
    /// for a file that was never stored, which would leave a gallery full of broken images.
    /// </summary>
    bool IsConfigured { get; }

    /// <summary>Writes the bytes under <paramref name="storageKey"/>. The key is new, so nothing is overwritten.</summary>
    Task SaveAsync(string storageKey, string contentType, Stream content, CancellationToken cancellationToken);

    /// <summary>Removes the bytes. Succeeds when the blob is already gone, so a retry is safe.</summary>
    Task DeleteAsync(string storageKey, CancellationToken cancellationToken);

    /// <summary>The address a browser loads the file from.</summary>
    string PublicUrl(string storageKey);
}

/// <summary>Which storage service the files live in.</summary>
public enum MediaProvider
{
    /// <summary>Nothing configured. Uploads are refused; see <see cref="UnconfiguredMediaStorage"/>.</summary>
    None,

    /// <summary>Azure Blob Storage, by connection string.</summary>
    Azure,

    /// <summary>Cloudflare R2, over its S3-compatible API.</summary>
    R2,
}

/// <summary>
/// Media storage configuration. Nothing here has a production default: with nothing configured,
/// storage is simply off, which is honest, rather than a half-working fallback.
///
/// Two services are supported, and <see cref="Provider"/> chooses. It is inferred when unset, so an
/// existing deployment that has only a blob connection string keeps working untouched.
/// </summary>
/// <param name="Provider">
/// <c>r2</c> or <c>azure</c>. Left unset it is inferred from whichever credentials are present, and
/// R2 wins if both are there; an explicit setting is the way to be unambiguous.
/// </param>
/// <param name="ConnectionString">
/// Azure only. A storage account connection string. Secret, so it comes from user-secrets, Key Vault
/// or an app setting, never from a committed file.
/// </param>
/// <param name="AccountId">
/// R2 only. The Cloudflare account id, which is what makes the endpoint host
/// <c>&lt;account-id&gt;.r2.cloudflarestorage.com</c>. Not a secret on its own.
/// </param>
/// <param name="AccessKeyId">R2 only. The id half of an R2 API token's S3 credentials.</param>
/// <param name="SecretAccessKey">R2 only. The secret half. Never logged, never returned by an endpoint.</param>
/// <param name="BucketName">The bucket (R2) or container (Azure) the files go in.</param>
/// <param name="PublicBaseUrl">
/// The address browsers load the files from.
///
/// Optional on Azure, where the container has a public URL of its own. **Required on R2**, which
/// serves nothing publicly from the S3 endpoint: an R2 bucket is reachable only through a custom
/// domain or its r2.dev development subdomain, and that address cannot be derived from the account
/// id. Without it, every upload would record a URL that resolves to nothing.
/// </param>
public sealed record MediaSettings(
    MediaProvider Provider,
    string? ConnectionString,
    string? AccountId,
    string? AccessKeyId,
    string? SecretAccessKey,
    string BucketName,
    string? PublicBaseUrl)
{
    public static MediaSettings Load(IConfiguration configuration)
    {
        var connectionString = configuration["Media:BlobConnectionString"];
        var accountId = configuration["Media:R2AccountId"];
        var accessKeyId = configuration["Media:R2AccessKeyId"];
        var secretAccessKey = configuration["Media:R2SecretAccessKey"];

        return new MediaSettings(
            ResolveProvider(configuration["Media:Provider"], connectionString, accountId, accessKeyId, secretAccessKey),
            connectionString,
            accountId,
            accessKeyId,
            secretAccessKey,
            // BucketName is R2's word for it; ContainerName is what an Azure deployment already sets,
            // and it is still read so none of them has to be edited.
            configuration["Media:BucketName"] ?? configuration.GetValue("Media:ContainerName", "listing-media")!,
            configuration["Media:PublicBaseUrl"]);
    }

    /// <summary>
    /// The provider to use. An explicit <c>Media:Provider</c> is obeyed even when its credentials are
    /// missing, so a typo or a half-finished setup fails loudly instead of quietly falling back to the
    /// other service — or to no storage at all, which would look like a working deploy until the first
    /// owner tried to add a photo.
    /// </summary>
    private static MediaProvider ResolveProvider(
        string? configured, string? connectionString, string? accountId, string? accessKeyId, string? secretAccessKey)
    {
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured.Trim().ToLowerInvariant() switch
            {
                "r2" or "cloudflare" or "cloudflare-r2" => MediaProvider.R2,
                "azure" or "blob" or "azureblob" => MediaProvider.Azure,
                "none" or "off" => MediaProvider.None,
                _ => throw new InvalidOperationException(
                    $"Media:Provider is '{configured}'. It must be 'r2', 'azure' or 'none'."),
            };
        }

        if (!string.IsNullOrWhiteSpace(accountId)
            || !string.IsNullOrWhiteSpace(accessKeyId)
            || !string.IsNullOrWhiteSpace(secretAccessKey))
        {
            return MediaProvider.R2;
        }

        return string.IsNullOrWhiteSpace(connectionString) ? MediaProvider.None : MediaProvider.Azure;
    }

    /// <summary>
    /// Why the chosen provider cannot be used, or null when it can. Checked at startup, so a missing
    /// key is a line in the boot log rather than a 500 the first time an owner adds a photo.
    /// </summary>
    public string? ConfigurationError => Provider switch
    {
        MediaProvider.Azure when string.IsNullOrWhiteSpace(ConnectionString) =>
            "Media:Provider is 'azure' but Media:BlobConnectionString is not set.",
        MediaProvider.R2 when string.IsNullOrWhiteSpace(AccountId) =>
            "Media:Provider is 'r2' but Media:R2AccountId is not set.",
        MediaProvider.R2 when string.IsNullOrWhiteSpace(AccessKeyId) || string.IsNullOrWhiteSpace(SecretAccessKey) =>
            "Media:Provider is 'r2' but Media:R2AccessKeyId and/or Media:R2SecretAccessKey is not set.",
        MediaProvider.R2 when string.IsNullOrWhiteSpace(PublicBaseUrl) =>
            "Media:Provider is 'r2' but Media:PublicBaseUrl is not set. R2 serves nothing publicly from "
            + "its S3 endpoint, so set this to the bucket's custom domain or its r2.dev subdomain.",
        _ => null,
    };

    /// <summary>Whether a real storage backend can be built from this configuration.</summary>
    public bool IsUsable => Provider != MediaProvider.None && ConfigurationError is null;
}

/// <summary>Azure Blob Storage, through the Azure SDK.</summary>
public sealed class BlobMediaStorage : IMediaStorage
{
    private readonly BlobContainerClient container;
    private readonly string? publicBaseUrl;

    public BlobMediaStorage(MediaSettings settings)
    {
        container = new BlobContainerClient(settings.ConnectionString, settings.BucketName);
        publicBaseUrl = settings.PublicBaseUrl?.TrimEnd('/');
    }

    public bool IsConfigured => true;

    /// <summary>
    /// Called once at startup. The container is public-read because every file in it is a photo on a
    /// public listing page; nothing private is ever stored here. The storage account must therefore
    /// allow blob public access (see docs/deployment.md) — if it does not, this falls back to a private
    /// container, and the images will 404 until the account setting or a CDN is in place.
    /// </summary>
    public async Task EnsureContainerAsync(CancellationToken cancellationToken)
    {
        try
        {
            await container.CreateIfNotExistsAsync(PublicAccessType.Blob, cancellationToken: cancellationToken);
        }
        catch (RequestFailedException)
        {
            await container.CreateIfNotExistsAsync(cancellationToken: cancellationToken);
        }
    }

    public async Task SaveAsync(string storageKey, string contentType, Stream content, CancellationToken cancellationToken)
    {
        var blob = container.GetBlobClient(storageKey);
        await blob.UploadAsync(
            content,
            new BlobUploadOptions
            {
                // Stored explicitly so the browser is told the type we verified from the bytes,
                // not whatever the uploader claimed and not a guess from the extension.
                HttpHeaders = new BlobHttpHeaders { ContentType = contentType, CacheControl = "public, max-age=31536000, immutable" },
            },
            cancellationToken);
    }

    public Task DeleteAsync(string storageKey, CancellationToken cancellationToken) =>
        container.DeleteBlobIfExistsAsync(storageKey, cancellationToken: cancellationToken);

    public string PublicUrl(string storageKey) =>
        publicBaseUrl is { Length: > 0 }
            ? $"{publicBaseUrl}/{storageKey}"
            : container.GetBlobClient(storageKey).Uri.ToString();
}

/// <summary>
/// Used when no provider is configured, or when the chosen one is missing a setting. Uploads are
/// refused rather than accepted and quietly dropped, and existing rows still render a URL so a
/// configuration gap does not blank out a gallery uploaded while storage was working.
/// </summary>
public sealed class UnconfiguredMediaStorage(IConfiguration configuration) : IMediaStorage
{
    private readonly string? publicBaseUrl = configuration["Media:PublicBaseUrl"]?.TrimEnd('/');

    public bool IsConfigured => false;

    public Task SaveAsync(string storageKey, string contentType, Stream content, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("No media storage is configured. See the Media: settings.");

    public Task DeleteAsync(string storageKey, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("No media storage is configured. See the Media: settings.");

    public string PublicUrl(string storageKey) => $"{publicBaseUrl ?? ""}/{storageKey}";
}
