import { completeChore, removeChore, snoozeChore } from "@/lib/actions";
import { SubmitButton } from "@/components/forms";
import { Trash2 } from "lucide-react";

export function CompleteChoreButton({ choreId }: { choreId: number }) {
  return (
    <form action={completeChore.bind(null, choreId)}>
      <SubmitButton variant="quiet" size="sm">
        Done
      </SubmitButton>
    </form>
  );
}

export function SnoozeChoreButton({ choreId }: { choreId: number }) {
  return (
    <form action={snoozeChore.bind(null, choreId)}>
      <SubmitButton variant="danger" size="sm" title="Push back a day">
        +1 day
      </SubmitButton>
    </form>
  );
}

export function RemoveChoreButton({ choreId }: { choreId: number }) {
  return (
    <form action={removeChore.bind(null, choreId)}>
      <SubmitButton variant="danger" size="icon" title="Remove chore">
        <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      </SubmitButton>
    </form>
  );
}
