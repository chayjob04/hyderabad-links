using BusinessDirectory.Api.Endpoints;

namespace BusinessDirectory.UnitTests;

// What an owner may write into a FAQ or a content section, and what a blog post must have.
//
// The allowance itself cannot be tested here — it needs real rows and a real subscription, so it
// is asserted in database/sqlserver/checks/listing_content_smoke.sql. What is testable without a
// database is the shape of what gets stored, which is the part that reaches a public page.
public class ListingContentValidationTests
{
    private const string GoodQuestion = "Do you deliver?";
    private const string GoodAnswer = "Yes, within five kilometres, for orders over 300 rupees.";

    [Fact]
    public void A_complete_faq_is_accepted()
    {
        Assert.Null(OwnerListingContentEndpoints.Validate(
            GoodQuestion, "question", OwnerListingContentEndpoints.MaxQuestionLength,
            GoodAnswer, "answer", OwnerListingContentEndpoints.MaxAnswerLength));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_blank_question_is_refused(string question)
    {
        var errors = OwnerListingContentEndpoints.Validate(
            question.Trim(), "question", OwnerListingContentEndpoints.MaxQuestionLength,
            GoodAnswer, "answer", OwnerListingContentEndpoints.MaxAnswerLength);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("question"));
    }

    [Fact]
    public void A_blank_answer_is_refused()
    {
        var errors = OwnerListingContentEndpoints.Validate(
            GoodQuestion, "question", OwnerListingContentEndpoints.MaxQuestionLength,
            "", "answer", OwnerListingContentEndpoints.MaxAnswerLength);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("answer"));
    }

    [Fact]
    public void An_answer_longer_than_the_column_is_refused_rather_than_truncated()
    {
        // The column is nvarchar(2000). Refusing beats cutting a sentence in half on a public page,
        // and beats a 500 from the database.
        var errors = OwnerListingContentEndpoints.Validate(
            GoodQuestion, "question", OwnerListingContentEndpoints.MaxQuestionLength,
            new string('a', OwnerListingContentEndpoints.MaxAnswerLength + 1),
            "answer", OwnerListingContentEndpoints.MaxAnswerLength);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("answer"));
    }

    [Fact]
    public void Exactly_at_the_limit_is_accepted()
    {
        Assert.Null(OwnerListingContentEndpoints.Validate(
            GoodQuestion, "question", OwnerListingContentEndpoints.MaxQuestionLength,
            new string('a', OwnerListingContentEndpoints.MaxAnswerLength),
            "answer", OwnerListingContentEndpoints.MaxAnswerLength));
    }

    [Fact]
    public void Both_problems_are_reported_at_once()
    {
        // One round trip, so an owner is not told about the question, fixes it, and only then
        // learns the answer was wrong too.
        var errors = OwnerListingContentEndpoints.Validate(
            "", "question", OwnerListingContentEndpoints.MaxQuestionLength,
            "", "answer", OwnerListingContentEndpoints.MaxAnswerLength);

        Assert.NotNull(errors);
        Assert.Equal(2, errors.Count);
    }

    [Fact]
    public void A_content_section_follows_the_same_rules_with_its_own_limits()
    {
        Assert.Null(OwnerListingContentEndpoints.Validate(
            "About us", "heading", OwnerListingContentEndpoints.MaxHeadingLength,
            "We have been serving Madhapur since 2011.", "body", OwnerListingContentEndpoints.MaxBodyLength));

        var errors = OwnerListingContentEndpoints.Validate(
            new string('h', OwnerListingContentEndpoints.MaxHeadingLength + 1),
            "heading", OwnerListingContentEndpoints.MaxHeadingLength,
            "Body", "body", OwnerListingContentEndpoints.MaxBodyLength);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("heading"));
    }
}

// What a blog post needs before it can be saved, and how a page override is addressed.
public class BlogAndSeoValidationTests
{
    [Fact]
    public void A_post_needs_a_title_and_a_body()
    {
        Assert.Null(BlogEndpoints.Validate("Best biryani in Madhapur", "Some words."));

        var noTitle = BlogEndpoints.Validate("", "Some words.");
        Assert.NotNull(noTitle);
        Assert.True(noTitle.ContainsKey("title"));

        var noBody = BlogEndpoints.Validate("A title", "");
        Assert.NotNull(noBody);
        Assert.True(noBody.ContainsKey("bodyMarkdown"));
    }

    [Fact]
    public void A_title_longer_than_the_column_is_refused()
    {
        var errors = BlogEndpoints.Validate(new string('t', BlogEndpoints.MaxTitleLength + 1), "Body");

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("title"));
    }

    // ------------------------------------------------------------------ SEO addressing
    [Fact]
    public void A_listing_override_is_addressed_by_id()
    {
        Assert.True(AdminSeoEndpoints.TryAddress("listing", "42", out var id, out var key, out _));
        Assert.Equal(42, id);
        Assert.Null(key);
    }

    [Fact]
    public void A_static_page_is_addressed_by_key_with_an_id_of_zero()
    {
        // S0021's CHECK requires exactly this arrangement, so getting it wrong here would be a
        // constraint violation at runtime rather than a tidy 400.
        Assert.True(AdminSeoEndpoints.TryAddress("static", "terms", out var id, out var key, out _));
        Assert.Equal(0, id);
        Assert.Equal("terms", key);
    }

    [Fact]
    public void A_static_page_nobody_renders_is_refused()
    {
        Assert.False(AdminSeoEndpoints.TryAddress("static", "not-a-page", out _, out _, out var error));
        Assert.NotNull(error);
    }

    [Theory]
    [InlineData("listing", "0")]
    [InlineData("listing", "-1")]
    [InlineData("category", "abc")]
    public void An_entity_without_a_usable_id_is_refused(string entityType, string key)
    {
        Assert.False(AdminSeoEndpoints.TryAddress(entityType, key, out _, out _, out var error));
        Assert.NotNull(error);
    }

    [Fact]
    public void An_unknown_entity_type_is_refused()
    {
        Assert.False(AdminSeoEndpoints.TryAddress("segment", "1", out _, out _, out var error));
        Assert.NotNull(error);
    }

    [Fact]
    public void Every_offered_entity_type_can_be_addressed()
    {
        // The list the API advertises and the list it accepts must be the same list.
        foreach (var type in AdminSeoEndpoints.EntityTypes)
        {
            var key = type == "static" ? AdminSeoEndpoints.StaticPageKeys[0] : "1";
            Assert.True(AdminSeoEndpoints.TryAddress(type, key, out _, out _, out _), type);
        }
    }
}
