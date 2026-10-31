export const BRAND_NAME = "HYDERABAD LINKS";

/**
 * Where people reach a human. Used by the Help &amp; feedback page and the footer.
 * Change this in one place rather than in every page that offers to be contacted.
 */
export const SUPPORT_EMAIL = "hello@hyderabadlinks.com";

/**
 * Social accounts, shown in the footer. Only the ones with a URL are rendered, so an account that
 * does not exist yet simply does not appear — better than a link to an empty profile.
 *
 * Fill these in with the real handles; they are deliberately blank rather than guessed.
 */
/*
 * The real accounts, taken from the original Hyderabad Links site's own footer rather than
 * invented. An empty href is filtered out, so an account that does not exist yet simply does not
 * appear — which is why YouTube and LinkedIn are listed but blank rather than deleted.
 */
export const SOCIAL_LINKS: { label: string; href: string }[] = [
  { label: "Instagram", href: "https://www.instagram.com/hyderabad_links" },
  { label: "Facebook", href: "https://www.facebook.com/hydlinks" },
  { label: "X", href: "https://x.com/hyderabadlinks" },
  { label: "WhatsApp", href: "https://wa.me/918019180101" },
  { label: "YouTube", href: "" },
  { label: "LinkedIn", href: "" },
].filter((link) => link.href !== "");

/** Hyderabad is the only live city for now. The URL scheme already carries the city, so more can be added later. */
export const DEFAULT_CITY = "hyderabad";
export const DEFAULT_CITY_NAME = "Hyderabad";
