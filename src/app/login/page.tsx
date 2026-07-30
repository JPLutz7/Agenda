import { redirect } from "next/navigation";
import { isPasscodeSet, isSignedIn } from "@/lib/auth";
import { setupDorm, signIn } from "@/lib/actions";
import { ActionForm, Field, SubmitButton, fieldClass } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isSignedIn()) redirect("/");
  const firstRun = !isPasscodeSet();

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-3xl font-semibold tracking-tight">Agenda</h1>
      <p className="mt-1 text-sm text-muted">
        {firstRun
          ? "Set this up once, then share the passcode with your roommate."
          : "Enter the dorm passcode."}
      </p>

      <div className="mt-8">
        {firstRun ? (
          <ActionForm action={setupDorm} className="space-y-4">
            <Field label="Your name">
              <input
                name="name_a"
                required
                autoComplete="given-name"
                className={fieldClass}
                placeholder="Joao"
              />
            </Field>
            <Field label="Your roommate's name">
              <input
                name="name_b"
                required
                className={fieldClass}
                placeholder="Roommate"
              />
            </Field>
            <Field label="Dorm passcode">
              <input
                name="passcode"
                type="password"
                required
                minLength={4}
                autoComplete="new-password"
                className={fieldClass}
                placeholder="At least 4 characters"
              />
            </Field>
            <SubmitButton className="w-full">Create the dorm</SubmitButton>
          </ActionForm>
        ) : (
          <ActionForm action={signIn} className="space-y-4">
            <Field label="Passcode">
              <input
                name="passcode"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                className={fieldClass}
              />
            </Field>
            <SubmitButton className="w-full">Sign in</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
