import { redirect } from "next/navigation";

// Clients receive a direct /project/<link> URL. The root goes to the admin area.
export default function Home() {
  redirect("/admin");
}
