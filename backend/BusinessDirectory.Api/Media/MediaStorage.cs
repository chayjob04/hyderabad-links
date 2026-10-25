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

/// <summary>
/// Media storage configuration. Nothing here has a production default: an unset connection string
/// means storage is simply not configured, which is honest, rather than a half-working fallback.
/// </summary>
/// <param name="ConnectionString">
/// An Azure Storage account connection string: a dev or test account in development, the real one in
/// production. It is a secret, so it comes from user-secrets, Key Vault or an app setting, never from
/// a committed file. Empty disables uploads rather than accepting files nothing can store.
/// </param>
/// <param name="ContainerName">The blob container. Created on startup if it does not exist.</param>
/// <param name="PublicBaseUrl">
/// Set this when the files are served through a CDN or custom domain. Left empty, the container's own
/// URL is used, which is what a plain storage account serves.
/// </param>
public sealed record MediaSettings(string? ConnectionString, string ContainerName, string? PublicBaseUrl)
{
    public static MediaSettings Load(IConfiguration configuration) => new(
        configuration["Media:BlobConnectionString"],
        configuration.GetValue("Media:ContainerName", "listing-media")!,
        configuration["Media:PublicBaseUrl"]);
}

/// <summary>Azure Blob Storage, through the Azure SDK.</summary>
public sealed class BlobMediaStorage : IMediaStorage
{
    private readonly BlobContainerClient container;
    private readonly string? publicBaseUrl;

    public BlobMediaStorage(MediaSettings settings)
    {
        container = new BlobContainerClient(settings.ConnectionString, settings.ContainerName);
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
/// Used when Media:BlobConnectionString is not set. Uploads are refused rather than accepted and
/// quietly dropped, and existing rows still render a URL so a configuration gap does not blank out
/// a gallery that was uploaded while storage was working.
/// </summary>
public sealed class UnconfiguredMediaStorage(IConfiguration configuration) : IMediaStorage
{
    private readonly string? publicBaseUrl = configuration["Media:PublicBaseUrl"]?.TrimEnd('/');

    public bool IsConfigured => false;

    public Task SaveAsync(string storageKey, string contentType, Stream content, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("No media storage is configured (Media:BlobConnectionString).");

    public Task DeleteAsync(string storageKey, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("No media storage is configured (Media:BlobConnectionString).");

    public string PublicUrl(string storageKey) => $"{publicBaseUrl ?? ""}/{storageKey}";
}
