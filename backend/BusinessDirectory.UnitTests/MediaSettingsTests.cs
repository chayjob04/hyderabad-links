using BusinessDirectory.Api.Media;
using Microsoft.Extensions.Configuration;

namespace BusinessDirectory.UnitTests;

// Which storage service a deployment uses, and what counts as a usable configuration.
//
// Worth testing because the failure this guards against is silent: a half-configured provider that
// builds anyway accepts an upload, stores nothing, and leaves a gallery of broken images. Every case
// below either produces working storage or refuses with a reason.
//
// No real credential appears here. Every value is an obvious test string.
public class MediaSettingsTests
{
    private static MediaSettings Load(params (string Key, string? Value)[] settings) =>
        MediaSettings.Load(new ConfigurationBuilder()
            .AddInMemoryCollection(settings.Select(s => new KeyValuePair<string, string?>(s.Key, s.Value)))
            .Build());

    /// <summary>A complete R2 configuration, so each test can leave out exactly the one thing it is about.</summary>
    private static (string, string?)[] R2 =>
    [
        ("Media:Provider", "r2"),
        ("Media:R2AccountId", "testaccountid"),
        ("Media:R2AccessKeyId", "test_access_key_id"),
        ("Media:R2SecretAccessKey", "test_secret_access_key"),
        ("Media:BucketName", "listing-media"),
        ("Media:PublicBaseUrl", "https://media.example.test"),
    ];

    /// <summary>The same configuration with one key left out, for the cases that replace it.</summary>
    private static IEnumerable<(string, string?)> Without(string key) => R2.Where(s => s.Item1 != key);

    [Fact]
    public void Nothing_is_configured_by_default()
    {
        var settings = Load();

        Assert.Equal(MediaProvider.None, settings.Provider);
        Assert.False(settings.IsUsable);
        Assert.Null(settings.ConnectionString);
        Assert.Null(settings.AccountId);
        Assert.Null(settings.AccessKeyId);
        Assert.Null(settings.SecretAccessKey);
    }

    [Fact]
    public void A_complete_r2_configuration_is_usable()
    {
        var settings = Load(R2);

        Assert.Equal(MediaProvider.R2, settings.Provider);
        Assert.True(settings.IsUsable);
        Assert.Null(settings.ConfigurationError);
    }

    [Theory]
    [InlineData("Media:R2AccountId")]
    [InlineData("Media:R2AccessKeyId")]
    [InlineData("Media:R2SecretAccessKey")]
    [InlineData("Media:PublicBaseUrl")]
    public void Every_r2_setting_is_required_and_the_missing_one_is_named(string omitted)
    {
        // PublicBaseUrl is in this list on purpose. It is optional on Azure, where a container has a
        // URL of its own, but R2 serves nothing publicly from the S3 endpoint -- so without it every
        // upload would record an address that resolves to nothing.
        var settings = Load([.. R2.Where(s => s.Item1 != omitted)]);

        Assert.False(settings.IsUsable);
        Assert.NotNull(settings.ConfigurationError);
        Assert.Contains(omitted.Split(':')[1], settings.ConfigurationError);
    }

    [Fact]
    public void An_r2_credential_on_its_own_is_enough_to_pick_r2()
    {
        // Inferred rather than defaulted: someone who sets an R2 key and forgets Media:Provider gets
        // an error naming what is missing, not a silent fallback to no storage at all.
        var settings = Load(("Media:R2AccessKeyId", "test_access_key_id"));

        Assert.Equal(MediaProvider.R2, settings.Provider);
        Assert.False(settings.IsUsable);
    }

    [Fact]
    public void A_blob_connection_string_on_its_own_still_means_azure()
    {
        // The compatibility case that matters: a deployment configured before R2 existed here must
        // keep working without being edited.
        var settings = Load(("Media:BlobConnectionString", "UseDevelopmentStorage=true"));

        Assert.Equal(MediaProvider.Azure, settings.Provider);
        Assert.True(settings.IsUsable);
        Assert.Equal("listing-media", settings.BucketName);
    }

    [Fact]
    public void Azure_does_not_need_a_public_base_url()
    {
        var settings = Load(("Media:Provider", "azure"), ("Media:BlobConnectionString", "UseDevelopmentStorage=true"));

        Assert.True(settings.IsUsable);
        Assert.Null(settings.PublicBaseUrl);
    }

    [Fact]
    public void An_explicit_provider_wins_over_the_credentials_that_are_present()
    {
        // Setting the provider is how a deployment is moved from one service to the other while both
        // sets of credentials are still in place, so the explicit value has to decide.
        var settings = Load([.. Without("Media:Provider"), ("Media:Provider", "azure"), ("Media:BlobConnectionString", "UseDevelopmentStorage=true")]);

        Assert.Equal(MediaProvider.Azure, settings.Provider);
        Assert.True(settings.IsUsable);
    }

    [Fact]
    public void An_explicit_provider_with_no_credentials_fails_loudly_instead_of_falling_back()
    {
        // The important one. Azure credentials are present, but the deployment asked for R2: it gets
        // an error about R2, never a quiet switch to the service it did not choose.
        var settings = Load(("Media:Provider", "r2"), ("Media:BlobConnectionString", "UseDevelopmentStorage=true"));

        Assert.Equal(MediaProvider.R2, settings.Provider);
        Assert.False(settings.IsUsable);
        Assert.Contains("R2AccountId", settings.ConfigurationError);
    }

    [Fact]
    public void A_misspelled_provider_is_refused_rather_than_guessed()
    {
        var failure = Assert.Throws<InvalidOperationException>(() => Load(("Media:Provider", "cloudfalre")));

        Assert.Contains("'r2', 'azure' or 'none'", failure.Message);
    }

    [Fact]
    public void Storage_can_be_switched_off_while_the_credentials_stay_in_place()
    {
        var settings = Load([.. Without("Media:Provider"), ("Media:Provider", "none")]);

        Assert.Equal(MediaProvider.None, settings.Provider);
        Assert.False(settings.IsUsable);
    }

    [Fact]
    public void The_bucket_name_falls_back_to_the_azure_container_setting()
    {
        // An existing deployment sets Media:ContainerName. Both names are read so moving to R2 does
        // not mean renaming a setting that already works.
        var settings = Load(("Media:Provider", "r2"), ("Media:ContainerName", "existing-container"));

        Assert.Equal("existing-container", settings.BucketName);
    }

    [Fact]
    public async Task Uploads_are_refused_when_nothing_is_configured_but_existing_urls_still_render()
    {
        // D10's shape applied to a configuration gap: refuse the new thing, keep showing the old. A
        // gallery uploaded while storage worked must not blank out because a key was rotated badly.
        var storage = new UnconfiguredMediaStorage(new ConfigurationBuilder()
            .AddInMemoryCollection([new KeyValuePair<string, string?>("Media:PublicBaseUrl", "https://media.example.test")])
            .Build());

        Assert.False(storage.IsConfigured);
        Assert.Equal("https://media.example.test/listings/1/photo.jpg", storage.PublicUrl("listings/1/photo.jpg"));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            storage.SaveAsync("k", "image/jpeg", Stream.Null, CancellationToken.None));
    }
}
