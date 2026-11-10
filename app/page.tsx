import { redirect } from "next/navigation";

// Private instance: no public landing page (it advertised the upstream project
// and its sponsor). Visitors go to the dashboard, which sends them to /login
// when they are not signed in.
export default function Home() {
  redirect("/dashboard");
}
