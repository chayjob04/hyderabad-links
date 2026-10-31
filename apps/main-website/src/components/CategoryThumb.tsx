import Image from "next/image";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { categoryImage } from "@/lib/category-images";

type Props = {
  slug: string;
  name: string;
  className?: string;
};

/**
 * A category's picture, or its drawn icon when there is no picture.
 *
 * The fallback is the point. `category-images.ts` is empty until the original site's image mapping
 * is extracted from its database, and every category page has to look finished in the meantime —
 * so the icon is not a placeholder for a missing image, it is the normal state, and a photograph
 * is an enhancement on top.
 *
 * `next/image` handles the optimisation: it serves WebP where the browser takes it, resizes to the
 * `sizes` hint rather than shipping a 300 KB original to a phone, and reserves the space so the
 * page does not jump when the file arrives.
 */
export function CategoryThumb({ slug, name, className = "" }: Props) {
  const src = categoryImage(slug);

  if (!src) {
    return (
      <span
        aria-hidden="true"
        className={`grid place-items-center rounded-xl bg-brand-50 text-brand-700 ${className}`}
      >
        <CategoryIcon slug={slug} name={name} className="h-7 w-7" />
      </span>
    );
  }

  return (
    <span className={`relative block overflow-hidden rounded-xl bg-brand-50 ${className}`}>
      <Image
        src={src}
        // Decorative: the category's name is already the heading beside it, and repeating it here
        // would make a screen reader say it twice.
        alt=""
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 240px"
        className="object-cover"
      />
    </span>
  );
}
