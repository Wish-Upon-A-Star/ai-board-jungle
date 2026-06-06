import { currentUser } from "@/src/lib/auth";
import { redirect } from "next/navigation";
import BoardClient from "./ui/BoardClient";

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <BoardClient user={user} />;
}
