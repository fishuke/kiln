import { redirect } from "next/navigation";

/** People, roles and keys moved to Team settings and user Settings. */
export default function Users() {
  redirect("/team");
}
