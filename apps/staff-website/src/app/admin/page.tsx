import { redirect } from "next/navigation";

// The admin site has one job today: moderation. Send people straight there (signing in happens on the way).
export default function HomePage() {
  redirect("/admin/listings");
}
