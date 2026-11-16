import { mutateWorkspace, readWorkspace, WorkspaceError } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readWorkspace(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return Response.json({ error: "Send an application/json request." }, { status: 415 });
  }
  try {
    return Response.json(await mutateWorkspace(await request.json()));
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON." }, { status: 400 });
    if (error instanceof WorkspaceError) return Response.json({ error: error.message }, { status: error.status });
    console.error(error);
    return Response.json({ error: "The workspace could not be saved. Try again." }, { status: 500 });
  }
}
