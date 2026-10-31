namespace BusinessDirectory.Api.Listings;

/// <summary>
/// When a business is open, and whether it is open right now.
///
/// The table (S0019) stores one row per open interval, so a shop that closes for lunch has two
/// rows for Monday and a day with no rows is closed. Everything here works on that shape.
///
/// Two things make this harder than it looks, and both are handled rather than avoided:
///
///   * <b>Intervals cross midnight.</b> A restaurant open 18:00–02:00 has a closing time earlier
///     than its opening time. That interval belongs to Monday but is open during Tuesday's early
///     hours, so answering "is it open now" at 00:30 on Tuesday means looking at Monday's rows.
///   * <b>"Now" means now in Hyderabad.</b> The times are wall-clock, not instants. A visitor in
///     London asking whether a shop is open must get Hyderabad's answer, so every comparison is
///     made after converting to IST rather than against the server's clock.
/// </summary>
public static class OpeningHours
{
    /// <summary>
    /// India has one timezone and does not observe daylight saving, so a fixed offset is correct
    /// and avoids depending on the host having tz data — which differs between Windows and Linux
    /// and has bitten this kind of code before.
    /// </summary>
    public static readonly TimeSpan IndiaOffset = TimeSpan.FromHours(5.5);

    /// <summary>At most this many intervals in one day. Enough for morning, afternoon and evening.</summary>
    public const int MaxIntervalsPerDay = 3;

    /// <summary>Monday is 0, matching the column's CHECK constraint and ISO-8601.</summary>
    public static readonly string[] DayNames =
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    /// <param name="DayOfWeek">0 = Monday … 6 = Sunday.</param>
    /// <param name="Opens">Wall-clock opening time in Hyderabad.</param>
    /// <param name="Closes">
    /// Wall-clock closing time. May be <b>earlier</b> than <paramref name="Opens"/>, which means
    /// the interval runs past midnight into the following day.
    /// </param>
    public sealed record Interval(int DayOfWeek, TimeOnly Opens, TimeOnly Closes)
    {
        /// <summary>Whether this interval runs past midnight, e.g. 18:00–02:00.</summary>
        public bool CrossesMidnight => Closes < Opens;
    }

    /// <summary>What the public page is told. Null <paramref name="OpensAt"/> means "closed now".</summary>
    /// <param name="IsOpenNow">Whether the business is open at the moment of the request.</param>
    /// <param name="ClosesAt">When the current interval ends, if open.</param>
    /// <param name="OpensAt">When the next interval begins, if closed.</param>
    public sealed record Status(bool IsOpenNow, TimeOnly? ClosesAt, TimeOnly? OpensAt, string? OpensDayName);

    /// <summary>The time in Hyderabad, whatever the server's own clock is set to.</summary>
    public static DateTimeOffset NowInIndia(DateTimeOffset utcNow) => utcNow.ToOffset(IndiaOffset);

    /// <summary>Monday-first day index for a date, since .NET's DayOfWeek starts at Sunday.</summary>
    public static int DayIndex(DayOfWeek day) => ((int)day + 6) % 7;

    /// <summary>
    /// What was wrong with a submitted week, or null when it is fine. The whole week is validated
    /// at once because the rules are about the day, not the row: two intervals can each be valid
    /// and still overlap.
    /// </summary>
    public static Dictionary<string, string[]>? Validate(IReadOnlyList<Interval> intervals)
    {
        var errors = new Dictionary<string, string[]>();

        foreach (var interval in intervals)
        {
            if (interval.DayOfWeek is < 0 or > 6)
            {
                errors["dayOfWeek"] = ["Each day must be 0 (Monday) to 6 (Sunday)."];
                return errors;
            }

            if (interval.Opens == interval.Closes)
            {
                errors["hours"] = ["An opening time and a closing time cannot be the same."];
                return errors;
            }
        }

        foreach (var day in intervals.GroupBy(i => i.DayOfWeek))
        {
            if (day.Count() > MaxIntervalsPerDay)
            {
                errors["hours"] = [$"{DayNames[day.Key]} has more than {MaxIntervalsPerDay} sets of hours."];
                return errors;
            }

            /* Overlaps within a day. Only same-day intervals are compared: an interval that runs
               past midnight spills into the *next* day, where its own row would be the thing to
               clash with, and treating that as an overlap would wrongly refuse a shop open
               18:00-02:00 that also opens at 09:00. */
            var sameDay = day.Where(i => !i.CrossesMidnight).OrderBy(i => i.Opens).ToList();
            for (var i = 1; i < sameDay.Count; i++)
            {
                if (sameDay[i].Opens < sameDay[i - 1].Closes)
                {
                    errors["hours"] = [$"{DayNames[day.Key]} has two sets of hours that overlap."];
                    return errors;
                }
            }

            // More than one overnight interval in a day would certainly overlap the next morning.
            if (day.Count(i => i.CrossesMidnight) > 1)
            {
                errors["hours"] = [$"{DayNames[day.Key]} has more than one set of hours running past midnight."];
                return errors;
            }
        }

        return errors.Count > 0 ? errors : null;
    }

    /// <summary>
    /// Whether the business is open at <paramref name="nowUtc"/>, and when it next changes.
    ///
    /// Both today's intervals and yesterday's are considered: an interval that crossed midnight
    /// belongs to yesterday's row but is what keeps the business open at 00:30 today.
    /// </summary>
    public static Status StatusAt(IReadOnlyList<Interval> intervals, DateTimeOffset nowUtc)
    {
        if (intervals.Count == 0)
        {
            return new Status(false, null, null, null);
        }

        var local = NowInIndia(nowUtc);
        var today = DayIndex(local.DayOfWeek);
        var yesterday = (today + 6) % 7;
        var time = TimeOnly.FromTimeSpan(local.TimeOfDay);

        // Still open from an interval that started yesterday and has not closed yet.
        foreach (var interval in intervals.Where(i => i.DayOfWeek == yesterday && i.CrossesMidnight))
        {
            if (time < interval.Closes)
            {
                return new Status(true, interval.Closes, null, null);
            }
        }

        foreach (var interval in intervals.Where(i => i.DayOfWeek == today))
        {
            if (interval.CrossesMidnight)
            {
                // Opened earlier today and runs into tomorrow.
                if (time >= interval.Opens)
                {
                    return new Status(true, interval.Closes, null, null);
                }
            }
            else if (time >= interval.Opens && time < interval.Closes)
            {
                return new Status(true, interval.Closes, null, null);
            }
        }

        return new Status(false, null, NextOpening(intervals, today, time, out var dayName), dayName);
    }

    /// <summary>
    /// The next opening time, searching today onwards and wrapping round the week. Returns null
    /// only when the week is empty, which <see cref="StatusAt"/> has already ruled out.
    /// </summary>
    private static TimeOnly? NextOpening(
        IReadOnlyList<Interval> intervals, int today, TimeOnly time, out string? dayName)
    {
        // Later today first.
        var laterToday = intervals
            .Where(i => i.DayOfWeek == today && i.Opens > time)
            .OrderBy(i => i.Opens)
            .FirstOrDefault();
        if (laterToday is not null)
        {
            dayName = "today";
            return laterToday.Opens;
        }

        // Then each following day, wrapping past Sunday. Seven steps covers the whole week.
        for (var ahead = 1; ahead <= 7; ahead++)
        {
            var day = (today + ahead) % 7;
            var next = intervals.Where(i => i.DayOfWeek == day).OrderBy(i => i.Opens).FirstOrDefault();
            if (next is not null)
            {
                dayName = ahead == 1 ? "tomorrow" : DayNames[day];
                return next.Opens;
            }
        }

        dayName = null;
        return null;
    }
}
