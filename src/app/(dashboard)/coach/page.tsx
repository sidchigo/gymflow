import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import CoachClient from "./coach-client";

export default async function CoachPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("gymflow_session")?.value;
  let session = null;

  if (sessionToken) {
    try {
      session = await verifySessionToken(sessionToken);
    } catch {
      // Token invalid
    }
  }

  if (!session) {
    redirect("/login");
  }

  return <CoachClient />;
}
