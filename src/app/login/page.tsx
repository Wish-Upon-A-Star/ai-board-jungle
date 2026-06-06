import { currentUser } from "@/src/lib/auth";
import { redirect } from "next/navigation";
import AuthClient from "../ui/AuthClient";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect("/");
  return <AuthClient />;
}
