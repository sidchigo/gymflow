import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getAthleteState, saveAthleteState } from "@/lib/redis";
import { AthleteProfileSchema } from "@/types/agent";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const athleteState = await getAthleteState(session.userId);
  if (!athleteState || !athleteState.profile) {
    return NextResponse.json({ isConfigured: false }, { status: 200 });
  }

  return NextResponse.json({
    isConfigured: true,
    profile: athleteState.profile,
  }, { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const result = AthleteProfileSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: result.error.issues },
      { status: 400 }
    );
  }

  const profile = result.data;

  // Retrieve current state to preserve lifts & events
  let athleteState = await getAthleteState(session.userId);
  if (!athleteState) {
    athleteState = {
      profile,
      lifts: [],
      events: [],
    };
  } else {
    athleteState.profile = profile;
  }

  await saveAthleteState(session.userId, athleteState);

  return NextResponse.json({ profile }, { status: 200 });
}

// Support PUT as well (mirroring POST)
export async function PUT(request: NextRequest): Promise<NextResponse> {
  return POST(request);
}
