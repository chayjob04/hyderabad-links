using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;

namespace BusinessDirectory.Api.Media;

/// <summary>
/// Cloudflare R2, over its S3-compatible API.
///
/// **No R2 SDK exists for .NET, and none is needed.** R2 speaks S3, so the AWS S3 client talks to it
/// unchanged once it is pointed at the account's endpoint. Three settings make that work, and each is
/// a deliberate departure from an AWS default:
///
///   * <c>ServiceURL</c> replaces region-based endpoint discovery. R2 has one host per account.
///   * <c>ForcePathStyle</c>, because R2 addresses a bucket as <c>/bucket/key</c> on that host rather
///     than as a subdomain of it.
///   * <c>AuthenticationRegion = "auto"</c>, which is the literal region R2 expects in a signature.
///     R2 has no regions; "auto" is the string, not a placeholder for one.
///
/// Two more exist because an S3-compatible store is not S3. They are explained where they are set.
///
/// Reads never come through here. Every file in the bucket is a photo on a public listing page, so
/// browsers fetch them straight from the bucket's public domain — which is why
/// <c>Media:PublicBaseUrl</c> is required for R2 and the S3 endpoint is used only for writes.
/// </summary>
public sealed class R2MediaStorage : IMediaStorage, IDisposable
{
    private readonly IAmazonS3 client;
    private readonly string bucket;
    private readonly string publicBaseUrl;
    private readonly ILogger<R2MediaStorage> logger;

    public R2MediaStorage(MediaSettings settings, ILogger<R2MediaStorage> logger)
    {
        if (settings.ConfigurationError is { } error)
        {
            // Constructed only after Program.cs has checked this, so reaching it is a bug rather than
            // a misconfiguration. Throwing beats building a client that cannot work.
            throw new InvalidOperationException(error);
        }

        this.logger = logger;
        bucket = settings.BucketName;
        publicBaseUrl = settings.PublicBaseUrl!.TrimEnd('/');

        var config = new AmazonS3Config
        {
            ServiceURL = $"https://{settings.AccountId}.r2.cloudflarestorage.com",
            ForcePathStyle = true,
            AuthenticationRegion = "auto",

            /*
             * The AWS SDK adds a CRC32 checksum to every upload by default, and validates one on every
             * download. Both are sent as a trailer in an `aws-chunked` body, which R2 does not accept;
             * the upload fails with a signature or encoding error that says nothing about checksums.
             *
             * "WhenRequired" keeps the checksum for the operations that genuinely need one and drops it
             * elsewhere. Nothing is lost: the body is still signed (see UseChunkEncoding below), so a
             * corrupted or tampered upload is already rejected by the signature.
             */
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
        };

        client = new AmazonS3Client(
            new BasicAWSCredentials(settings.AccessKeyId, settings.SecretAccessKey), config);
    }

    public bool IsConfigured => true;

    /// <summary>
    /// Proves at startup that the credentials work and the bucket is there, by asking for one key.
    /// A read, so it changes nothing and is safe to run on every boot.
    ///
    /// It deliberately does **not** create a missing bucket, which is where this differs from the
    /// Azure path. A new R2 bucket is private and has no public hostname until a custom domain or the
    /// r2.dev subdomain is bound to it in the Cloudflare dashboard — so creating one here would
    /// produce a bucket that accepts uploads and serves nothing, and a typo in the name would quietly
    /// make a second one. The owner creates the bucket and binds its domain; this checks their work.
    /// </summary>
    public async Task VerifyBucketAsync(CancellationToken cancellationToken)
    {
        var probe = await client.ListObjectsV2Async(
            new ListObjectsV2Request { BucketName = bucket, MaxKeys = 1 }, cancellationToken);

        logger.LogInformation(
            "Cloudflare R2 is reachable. Bucket: {Bucket} | public base: {PublicBaseUrl} | objects seen: {Seen}",
            bucket, publicBaseUrl, probe.KeyCount);
    }

    public async Task SaveAsync(string storageKey, string contentType, Stream content, CancellationToken cancellationToken)
    {
        var request = new PutObjectRequest
        {
            BucketName = bucket,
            Key = storageKey,

            // The type we read from the bytes, never what the uploader claimed and never a guess from
            // the extension. It is stored with the object, so the browser is told the same thing.
            ContentType = contentType,
            InputStream = content,

            /*
             * R2 does not accept `aws-chunked` request bodies, which is how the SDK streams by default.
             * Off, the body is sent whole and signed over its SHA-256 — the stream is seekable (ASP.NET
             * has already buffered the form file), so hashing it costs a rewind, not a second copy in
             * memory. Payload signing stays on; this changes the framing, not the authentication.
             */
            UseChunkEncoding = false,
        };

        // A storage key is never reused, so a file can be cached as long as a browser likes.
        request.Headers.CacheControl = "public, max-age=31536000, immutable";

        await client.PutObjectAsync(request, cancellationToken);
    }

    /// <summary>
    /// Removes the object. S3 delete is idempotent — a key that was never there answers the same way
    /// as one that was — so a retry, or a second attempt after a half-failed upload, is safe.
    /// </summary>
    public Task DeleteAsync(string storageKey, CancellationToken cancellationToken) =>
        client.DeleteObjectAsync(
            new DeleteObjectRequest { BucketName = bucket, Key = storageKey }, cancellationToken);

    public string PublicUrl(string storageKey) => $"{publicBaseUrl}/{storageKey}";

    public void Dispose() => client.Dispose();
}
