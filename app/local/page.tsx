import { redirect } from "next/navigation";

/** Hyper-Local lab now lives on the home page. */
export default function LocalPage() {
  redirect("/");
}
