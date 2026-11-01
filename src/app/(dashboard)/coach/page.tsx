import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { isDemoMode } from "@/lib/adapters";
import CoachClient from "./coach-client";

interface CoachPageProps {
  searchParams: Promise<{ prompt?: string }>;
}

export default async function CoachPage({ searchParams }: CoachPageProps) {
  const params = await searchParams;
  const initialPrompt = params.prompt;

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

  if (!session && isDemoMode()) {
    session = { userId: "demo-athlete", role: "MEMBER" };
  } else if (!session) {
    redirect("/login");
  }

  return <CoachClient initialPrompt={initialPrompt} />;
}