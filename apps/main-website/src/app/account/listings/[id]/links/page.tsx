import { notFound, redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

/**
 * Website and social links used to be a screen of its own, reached from a row of links across the top of every listing
 * screen. It is a section of the listing editor now, so this route sends you there -- a bookmark or
 * a link in an old email still works, and there is one place to edit each thing rather than two
 * that could drift apart.
 */
export default async function Page({ params }: Props) {
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();
  redirect(`/account/listings/${id}/edit`);
}
