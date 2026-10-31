// Shapes returned by the API (camelCase JSON). Keep in sync with backend/BusinessDirectory.Api/Endpoints.
// Later these come from the generated OpenAPI client in packages/api-client.

export type SubCategory = { slug: string; name: string; searchTerms: string[] };
export type Category = { slug: string; name: string; children: SubCategory[] };
export type Locality = { slug: string; name: string; latitude: number; longitude: number };

/** One row from /api/v1/public/localities/search, for the location autocomplete. */
export type LocalitySuggestion = { slug: string; name: string; cityName: string; state: string };

/** /api/v1/public/localities/nearest: the known area closest to a point, and how far away it is. */
export type NearestLocality = LocalitySuggestion & { distanceMetres: number };

export type ListingDetail = {
  slug: string;
  name: string;
  description: string | null;
  addressLine: string | null;
  pincode: string | null;
  phonePrimary: string;
  phoneWhatsapp: string | null;
  websiteUrl: string | null;
  latitude: number;
  longitude: number;
  citySlug: string;
  cityName: string;
  localitySlug: string;
  localityName: string;
  categorySlug: string;
  categoryName: string;
  url: string;
  /** Logo first, then photos, then video. Media the plan no longer covers is not in this list at all. */
  media: ListingMedia[];
  /**
   * True only while a paid period is actually running. The API derives it by comparing the
   * subscription's expiry against the clock, so a lapsed listing stops showing the badge on the
   * next request — the site never has to work out whether a subscription is still good.
   */
  isVerified: boolean;
  /**
   * The business's own website and social links, in the owner's order. Always empty on a free
   * listing and on a lapsed one: the API does not send them at all rather than relying on the page
   * to hide them.
   */
  links: ListingLink[];
  /**
   * The week's hours, in day order. Free as well as paid — this is for the visitor, not a feature
   * sold to the owner. Empty when nobody has filled them in.
   */
  openingHours: OpeningHours[];
  /**
   * Whether the business is open at this moment, worked out by the API in Hyderabad time so that
   * a visitor in another timezone gets the shop's answer rather than their own phone's. Null when
   * no hours are recorded, which is different from being closed.
   */
  openStatus: OpenStatus | null;
  /**
   * FAQs and content sections the plan currently covers. Like `links`, the API sends none at all
   * on a free or lapsed listing rather than relying on this page to hide them.
   */
  faqs: ListingFaq[];
  contentSections: ListingContentSection[];
  /**
   * What the business offers, the languages it speaks and what it has on site. Free on every
   * plan, unlike links and FAQs: these help the visitor choose.
   */
  attributes: ListingAttribute[];
};

/** `kind` is "offering", "language" or "amenity". */
export type ListingAttribute = { kind: string; label: string };

/** `dayOfWeek` is 0 for Monday through 6 for Sunday. Times are "HH:mm" in Hyderabad. */
export type OpeningHours = {
  dayOfWeek: number;
  dayName: string;
  opens: string;
  closes: string;
};

export type OpenStatus = {
  isOpenNow: boolean;
  /** When it closes, if open now. */
  closesAt: string | null;
  /** When it next opens, if closed now. */
  opensAt: string | null;
  /** "today", "tomorrow", or a weekday name. */
  opensDay: string | null;
};

export type ListingFaq = { question: string; answer: string };

export type ListingContentSection = { heading: string; body: string };

/** One website or social link on a public listing page. The URL is always http or https. */
export type ListingLink = {
  linkType: "website" | "instagram" | "facebook" | "youtube" | "linkedin" | "x" | "other";
  label: string;
  url: string;
};

/** One file on a public listing page. */
export type ListingMedia = {
  kind: "logo" | "photo" | "video";
  url: string;
  width: number | null;
  height: number | null;
};

/** One URL for the sitemap. `lastModified` is only known for listings. */
export type SitemapEntry = { url: string; lastModified: string | null };

/** `truncated` is true when there are more live listings than one sitemap file may hold. */
export type Sitemap = {
  listings: SitemapEntry[];
  localities: SitemapEntry[];
  categories: SitemapEntry[];
  truncated: boolean;
};

/** Flat, search-friendly view of the category tree (sub-categories first, then parents). */
/**
 * A category as the search box knows it, flattened so parents and subcategories sit in one list.
 *
 * `parentSlug` is null for a top-level category and its parent's slug for a subcategory. It is
 * here because a category's page lives under its parent (/shopping/supermarkets-and-groceries):
 * the slug on its own does not say where the page is.
 */
export type SearchCategory = { slug: string; name: string; terms: string[]; parentSlug: string | null };

/** One row from /api/v1/public/listings/search. distanceMetres is null unless lat/lng were sent. */
export type SearchListing = {
  slug: string;
  name: string;
  citySlug: string;
  localitySlug: string;
  localityName: string;
  categorySlug: string;
  categoryName: string;
  distanceMetres: number | null;
  addressLine: string | null;
  phonePrimary: string;
  phoneWhatsapp: string | null;
  url: string;
  /** The uploaded logo, or null when there is none - the card then shows a monogram. */
  logoUrl: string | null;
  /** The first photo, used as the card image when there is no logo. */
  photoUrl: string | null;
};

/** A page of search results. `total` counts every match, not just this page. */
export type SearchResults = {
  items: SearchListing[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/** What the visitor asked for. Mirrors the query string so filters stay shareable. */
export type SearchCriteria = {
  q?: string;
  city?: string;
  locality?: string;
  category?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sort?: "relevance" | "distance" | "name";
  page?: number;
  pageSize?: number;
};

/** Re-exported from the API client so components can import review shapes from one place. */
export type { PublicReview, ReviewSummary } from "./api";

/**
 * One card on a homepage shelf. The same fields as a search result minus the distance (a shelf is
 * not a proximity search), plus whether a paid period is running.
 */
export type HighlightListing = Omit<SearchListing, "distanceMetres"> & {
  /** True while the listing has a paid Verified period. Drives the badge. */
  verified: boolean;
};

/** A named shelf a super admin created, with its own heading. */
export type FeaturedGroup = {
  slug: string;
  title: string;
  subtitle: string | null;
  listings: HighlightListing[];
};

export type Highlights = {
  /** The default Featured shelf: chosen by hand, and not in any named group. */
  featured: HighlightListing[];
  /** Listings with the most real activity (enquiries, favourites, approved reviews) in the window. */
  trending: HighlightListing[];
  /** How many days back "trending" measured, so the heading can say it without hard-coding it. */
  trendingWindowDays: number;
  /**
   * Named shelves, in the order staff chose. Empty when nobody has made one, which is the normal
   * state — the default Featured shelf above is unaffected either way.
   */
  featuredGroups: FeaturedGroup[];
};

/** A published blog post, as the public list shows it. */
export type BlogSummary = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  authorName: string;
  publishedAt: string | null;
  status: string;
};

/** `bodyMarkdown` is the source as written. The site renders it; the API never sends HTML. */
export type BlogPost = BlogSummary & { bodyMarkdown: string };

export type BlogPage = {
  items: BlogSummary[];
  page: number;
  totalPages: number;
  total: number;
};

/**
 * A staff-written override for one page's title, description or indexing.
 *
 * `key` is the page key for a static page and the entity id as text for everything else, matching
 * how `page_meta` addresses a row.
 */
export type PageMetaOverride = {
  entityType: string;
  key: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  noindex: boolean;
};

/** A plan as the public pricing page shows it. `pricePaise` is in paise: ₹399 arrives as 39900. */
export type PublicPlan = {
  slug: string;
  name: string;
  pricePaise: number;
  photoLimit: number;
  videoLimit: number;
  logoLimit: number;
  linkLimit: number;
  faqLimit: number;
  contentSectionLimit: number;
  grantsVerifiedBadge: boolean;
};
