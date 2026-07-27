import "server-only";
import { redirect } from "next/navigation";
import { isSignedIn } from "./auth";

/** Every page behind the passcode starts with this. */
export async function requireSignedIn(): Promise<void> {
  if (!(await isSignedIn())) redirect("/login");
}
