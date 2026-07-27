import { completeChore, removeChore, snoozeChore } from "@/lib/actions";
import { SubmitButton } from "@/components/forms";

export function CompleteChoreButton({ choreId }: { choreId: number }) {
  return (
    <form action={completeChore.bind(null, choreId)}>
      <SubmitButton variant="quiet">Done</SubmitButton>
    </form>
  );
}

export function SnoozeChoreButton({ choreId }: { choreId: number }) {
  return (
    <form action={snoozeChore.bind(null, choreId)}>
      <SubmitButton variant="danger" title="Push back a day" className="px-2">
        +1d
      </SubmitButton>
    </form>
  );
}

export function RemoveChoreButton({ choreId }: { choreId: number }) {
  return (
    <form action={removeChore.bind(null, choreId)}>
      <SubmitButton variant="danger" title="Remove chore" className="px-2">
        ✕
      </SubmitButton>
    </form>
  );
}
