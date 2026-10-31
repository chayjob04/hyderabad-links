using BusinessDirectory.Api.Listings;

namespace BusinessDirectory.UnitTests;

// Whether a business is open, which is harder than it looks for two reasons: intervals cross
// midnight, and "now" means now in Hyderabad whatever the server's clock says.
//
// Every time below is constructed in UTC and the expected answer worked out by hand in IST, so
// these tests would fail if the offset were dropped rather than silently passing on a machine that
// happens to be set to India.
public class OpeningHoursTests
{
    private const int Monday = 0;
    private const int Tuesday = 1;
    private const int Sunday = 6;

    private static OpeningHours.Interval Open(int day, string from, string to) =>
        new(day, TimeOnly.Parse(from), TimeOnly.Parse(to));

    /// <summary>A UTC instant that is the given IST wall-clock time on a known weekday.</summary>
    private static DateTimeOffset IstMoment(int year, int month, int day, int hour, int minute) =>
        new DateTimeOffset(year, month, day, hour, minute, 0, OpeningHours.IndiaOffset).ToUniversalTime();

    // 2026-10-26 is a Monday; 2026-10-27 a Tuesday; 2026-11-01 a Sunday.
    [Fact]
    public void A_shop_is_open_between_its_hours()
    {
        var week = new[] { Open(Monday, "09:00", "18:00") };

        var status = OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 11, 0));

        Assert.True(status.IsOpenNow);
        Assert.Equal(new TimeOnly(18, 0), status.ClosesAt);
    }

    [Fact]
    public void A_shop_is_closed_before_it_opens_and_says_when_it_will()
    {
        var week = new[] { Open(Monday, "09:00", "18:00") };

        var status = OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 7, 30));

        Assert.False(status.IsOpenNow);
        Assert.Equal(new TimeOnly(9, 0), status.OpensAt);
        Assert.Equal("today", status.OpensDayName);
    }

    [Fact]
    public void Closing_time_is_exclusive()
    {
        // At exactly 18:00 the shop is shut. Treating the boundary as open would tell somebody to
        // set off for a business that is locking its door.
        var week = new[] { Open(Monday, "09:00", "18:00") };

        Assert.False(OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 18, 0)).IsOpenNow);
        Assert.True(OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 17, 59)).IsOpenNow);
    }

    // ------------------------------------------------------------------ crossing midnight
    [Fact]
    public void A_late_night_business_is_open_before_midnight()
    {
        var week = new[] { Open(Monday, "18:00", "02:00") };

        var status = OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 23, 30));

        Assert.True(status.IsOpenNow);
        Assert.Equal(new TimeOnly(2, 0), status.ClosesAt);
    }

    [Fact]
    public void A_late_night_business_is_still_open_after_midnight_on_the_next_day()
    {
        /* The point of the whole design. The interval is stored against Monday, and at 00:30 on
           Tuesday it is Monday's row that keeps the shop open. Looking only at today's rows would
           report a restaurant as closed in the middle of its busiest hour. */
        var week = new[] { Open(Monday, "18:00", "02:00") };

        var status = OpeningHours.StatusAt(week, IstMoment(2026, 10, 27, 0, 30));

        Assert.True(status.IsOpenNow);
        Assert.Equal(new TimeOnly(2, 0), status.ClosesAt);
    }

    [Fact]
    public void A_late_night_business_is_closed_once_the_overnight_interval_ends()
    {
        var week = new[] { Open(Monday, "18:00", "02:00") };

        Assert.False(OpeningHours.StatusAt(week, IstMoment(2026, 10, 27, 2, 30)).IsOpenNow);
    }

    [Fact]
    public void An_overnight_interval_does_not_open_the_shop_early_the_same_day()
    {
        // Monday 18:00-02:00 must not make Monday 01:00 open: that belongs to Sunday's interval,
        // which this listing does not have.
        var week = new[] { Open(Monday, "18:00", "02:00") };

        Assert.False(OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 1, 0)).IsOpenNow);
    }

    // ------------------------------------------------------------------ timezone
    [Fact]
    public void The_answer_is_Hyderabads_not_the_servers()
    {
        /* 05:00 UTC is 10:30 IST, which is inside 09:00-18:00. A server reading the clock without
           converting would call this closed. */
        var week = new[] { Open(Monday, "09:00", "18:00") };
        var utc = new DateTimeOffset(2026, 10, 26, 5, 0, 0, TimeSpan.Zero);

        Assert.True(OpeningHours.StatusAt(week, utc).IsOpenNow);
    }

    [Fact]
    public void A_visitor_in_another_timezone_still_gets_Hyderabads_answer()
    {
        // The same instant expressed with a different offset must give the same answer, because
        // the question is about the shop, not the person asking.
        var week = new[] { Open(Monday, "09:00", "18:00") };
        var utc = new DateTimeOffset(2026, 10, 26, 5, 0, 0, TimeSpan.Zero);
        var sameInstantInNewYork = utc.ToOffset(TimeSpan.FromHours(-4));

        Assert.Equal(
            OpeningHours.StatusAt(week, utc).IsOpenNow,
            OpeningHours.StatusAt(week, sameInstantInNewYork).IsOpenNow);
    }

    // ------------------------------------------------------------------ split shifts and gaps
    [Fact]
    public void A_lunch_break_closes_the_shop_in_between()
    {
        var week = new[] { Open(Monday, "09:00", "13:00"), Open(Monday, "16:00", "20:00") };

        Assert.True(OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 10, 0)).IsOpenNow);
        Assert.False(OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 14, 0)).IsOpenNow);
        Assert.True(OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 17, 0)).IsOpenNow);
    }

    [Fact]
    public void During_a_lunch_break_it_says_when_it_reopens()
    {
        var week = new[] { Open(Monday, "09:00", "13:00"), Open(Monday, "16:00", "20:00") };

        var status = OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 14, 0));

        Assert.Equal(new TimeOnly(16, 0), status.OpensAt);
        Assert.Equal("today", status.OpensDayName);
    }

    [Fact]
    public void A_day_with_no_hours_is_closed_and_points_at_the_next_open_day()
    {
        // Open only on Monday. On Tuesday it is shut until next Monday.
        var week = new[] { Open(Monday, "09:00", "18:00") };

        var status = OpeningHours.StatusAt(week, IstMoment(2026, 10, 27, 12, 0));

        Assert.False(status.IsOpenNow);
        Assert.Equal(new TimeOnly(9, 0), status.OpensAt);
        Assert.Equal("Monday", status.OpensDayName);
    }

    [Fact]
    public void Tomorrow_is_called_tomorrow()
    {
        var week = new[] { Open(Tuesday, "09:00", "18:00") };

        var status = OpeningHours.StatusAt(week, IstMoment(2026, 10, 26, 20, 0));

        Assert.Equal("tomorrow", status.OpensDayName);
    }

    [Fact]
    public void The_week_wraps_round_from_Sunday_to_Monday()
    {
        var week = new[] { Open(Monday, "09:00", "18:00") };

        // 2026-11-01 is a Sunday.
        var status = OpeningHours.StatusAt(week, IstMoment(2026, 11, 1, 12, 0));

        Assert.Equal("tomorrow", status.OpensDayName);
    }

    [Fact]
    public void A_listing_with_no_hours_reports_nothing_rather_than_closed()
    {
        /* "No hours recorded" and "closed right now" are different things, and showing a business
           as Closed because nobody filled the form in would be a lie about a shop that is open. */
        var status = OpeningHours.StatusAt([], IstMoment(2026, 10, 26, 12, 0));

        Assert.False(status.IsOpenNow);
        Assert.Null(status.OpensAt);
        Assert.Null(status.ClosesAt);
    }

    [Fact]
    public void Sunday_is_day_six_and_Monday_is_day_zero()
    {
        Assert.Equal(Monday, OpeningHours.DayIndex(DayOfWeek.Monday));
        Assert.Equal(Sunday, OpeningHours.DayIndex(DayOfWeek.Sunday));
        Assert.Equal("Monday", OpeningHours.DayNames[0]);
        Assert.Equal("Sunday", OpeningHours.DayNames[6]);
    }

    // ------------------------------------------------------------------ validation
    [Fact]
    public void A_sensible_week_is_accepted()
    {
        Assert.Null(OpeningHours.Validate([Open(Monday, "09:00", "18:00"), Open(Tuesday, "09:00", "18:00")]));
    }

    [Fact]
    public void Equal_opening_and_closing_times_are_refused()
    {
        var errors = OpeningHours.Validate([Open(Monday, "09:00", "09:00")]);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("hours"));
    }

    [Fact]
    public void Overlapping_hours_on_one_day_are_refused()
    {
        var errors = OpeningHours.Validate([Open(Monday, "09:00", "14:00"), Open(Monday, "13:00", "18:00")]);

        Assert.NotNull(errors);
        Assert.Contains("Monday", errors["hours"][0]);
    }

    [Fact]
    public void Touching_but_not_overlapping_hours_are_accepted()
    {
        // 09:00-13:00 and 13:00-18:00 do not overlap: closing is exclusive, so there is no moment
        // claimed by both. Refusing this would make a split shift impossible to express.
        Assert.Null(OpeningHours.Validate([Open(Monday, "09:00", "13:00"), Open(Monday, "13:00", "18:00")]));
    }

    [Fact]
    public void An_overnight_interval_does_not_count_as_overlapping_the_morning()
    {
        /* A shop open 09:00-13:00 and again 18:00-02:00 is perfectly ordinary. The overnight
           interval's closing time (02:00) sorts before the morning's opening time, so a naive
           overlap check refuses it -- which is exactly the bug this test exists to prevent. */
        Assert.Null(OpeningHours.Validate([Open(Monday, "09:00", "13:00"), Open(Monday, "18:00", "02:00")]));
    }

    [Fact]
    public void Two_overnight_intervals_in_one_day_are_refused()
    {
        var errors = OpeningHours.Validate([Open(Monday, "18:00", "02:00"), Open(Monday, "20:00", "03:00")]);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("hours"));
    }

    [Fact]
    public void A_day_outside_Monday_to_Sunday_is_refused()
    {
        var errors = OpeningHours.Validate([new OpeningHours.Interval(7, new TimeOnly(9, 0), new TimeOnly(18, 0))]);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("dayOfWeek"));
    }

    [Fact]
    public void More_than_three_sets_of_hours_in_a_day_are_refused()
    {
        var errors = OpeningHours.Validate([
            Open(Monday, "06:00", "08:00"),
            Open(Monday, "09:00", "11:00"),
            Open(Monday, "12:00", "14:00"),
            Open(Monday, "15:00", "17:00"),
        ]);

        Assert.NotNull(errors);
        Assert.Contains("Monday", errors["hours"][0]);
    }

    [Fact]
    public void An_empty_week_is_valid()
    {
        // Clearing the hours is a legitimate thing to do, and must not be refused as invalid.
        Assert.Null(OpeningHours.Validate([]));
    }
}
