import { Dashboard } from "../components/dashboard";
import { readWorkspace } from "../lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const workspace = await readWorkspace();
  return <Dashboard initialWorkspace={workspace} initialNow={Date.now()} />;
}
