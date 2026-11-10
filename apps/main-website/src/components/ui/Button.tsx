import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * The site's button looks. `primary` is the teal action, `ghost` the outlined one, `cta` the wide
 * call-to-action used in the owner banner, and `inverse` the same wide shape turned inside out for
 * use *on* a dark background.
 *
 * `inverse` exists because the obvious alternative does not work. Passing
 * `tone="cta" className="bg-white text-brand-800"` looks like it should override the tone, but
 * Tailwind resolves two conflicting utilities by their order in the generated stylesheet, not by
 * the order they appear in the class attribute — so `text-white` from the tone kept winning over
 * `text-brand-800` from the override, and the button rendered white text on a white pill:
 * invisible until hover, where the tone's `hover:bg-brand-800` darkened the background and the
 * white text suddenly appeared. A tone of its own has no conflict to lose.
 */
export type ButtonTone = "primary" | "ghost" | "cta" | "inverse";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-extrabold transition-colors disabled:opacity-60";

const tones: Record<ButtonTone, string> = {
  primary: "bg-brand-700 px-6 py-3 text-white hover:bg-brand-800",
  ghost: "border border-brand-200 bg-white px-6 py-3 text-brand-700 hover:border-brand-700 hover:bg-brand-50",
  cta: "bg-brand-700 px-7 py-4 text-base text-white hover:bg-brand-800",
  inverse: "bg-white px-7 py-4 text-base text-brand-800 hover:bg-brand-100",
};

export function buttonClass(tone: ButtonTone = "primary", extra = "") {
  return `${base} ${tones[tone]} ${extra}`.trim();
}

/** A button that submits or acts. For navigation use `ButtonLink`, so it stays a real link. */
export function Button({
  tone = "primary",
  className = "",
  children,
  ...props
}: { tone?: ButtonTone } & ComponentProps<"button">) {
  return (
    <button className={buttonClass(tone, className)} {...props}>
      {children}
    </button>
  );
}

export function ButtonLink({
  tone = "primary",
  className = "",
  children,
  ...props
}: { tone?: ButtonTone; children: ReactNode } & ComponentProps<typeof Link>) {
  return (
    <Link className={buttonClass(tone, className)} {...props}>
      {children}
    </Link>
  );
}
