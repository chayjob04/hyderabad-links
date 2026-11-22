/**
 * How much of a listing is filled in, section by section.
 *
 * Replaces the "check what's missing" screen, which listed the same gaps on a page of its own --
 * away from the fields it was talking about, so acting on it meant remembering what it said and
 * going somewhere else. The numbers are the same question asked where the answer can be typed.
 *
 * Every figure is counted from the values the API returned. Nothing here is a constant: a section
 * with no fields filled reads 0%, one with all of them reads 100%, and the only way to move it is
 * to fill something in.
 */

/** One thing a section asks for, and whether the listing has it. */
export type CompletionField = {
  /** How the owner would name it, used in the "still to do" line. */
  label: string;
  done: boolean;
  /**
   * Optional fields count towards neither half, so a section is not held below 100% by something
   * nobody has to provide, and not pushed to 100% by its absence either.
   */
  optional?: boolean;
};

export type SectionCompletion = {
  filled: number;
  /** Required fields only, so the percentage is of what is actually being asked for. */
  total: number;
  percent: number;
  /** The required fields still empty, in the order the section asks for them. */
  missing: string[];
};

/**
 * Counts one section.
 *
 * A section with nothing required -- photos on a free plan, for instance, where the feature is not
 * part of the plan at all -- reports 100% rather than dividing by zero: there is nothing outstanding
 * to tell the owner about.
 */
export function completionOf(fields: readonly CompletionField[]): SectionCompletion {
  const required = fields.filter((field) => !field.optional);
  const filled = required.filter((field) => field.done).length;
  const total = required.length;

  return {
    filled,
    total,
    percent: total === 0 ? 100 : Math.round((filled / total) * 100),
    missing: required.filter((field) => !field.done).map((field) => field.label),
  };
}

/**
 * The whole listing, from the sections already counted.
 *
 * Summed from each section's own figures rather than recounted from the fields, so the overall
 * number and the section numbers can never disagree -- and a field counted once in its section is
 * counted once here.
 */
export function overallCompletion(sections: readonly SectionCompletion[]): SectionCompletion {
  const filled = sections.reduce((sum, section) => sum + section.filled, 0);
  const total = sections.reduce((sum, section) => sum + section.total, 0);

  return {
    filled,
    total,
    percent: total === 0 ? 100 : Math.round((filled / total) * 100),
    missing: sections.flatMap((section) => section.missing),
  };
}

/** True when a string field has something in it. Whitespace is not something. */
export const filled = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

/** True when a text field is at least as long as the reviewer needs it to be. */
export const filledTo = (value: string | null | undefined, minimum: number): boolean =>
  typeof value === "string" && value.trim().length >= minimum;
