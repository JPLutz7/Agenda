import { completeChore, removeChore, snoozeChore } from "@/lib/actions";
import { SubmitButton } from "@/components/forms";
import { TickButton } from "@/components/tick-button";
import { Trash2 } from "lucide-react";

/**
 * Marking a chore done, as a tick box.
 *
 * It was a grey "Done" slab on the right of every row, which made three chores
 * read as three buttons with some text beside them. A circle on the left is the
 * shape everyone already knows for "not done yet", it sits where the eye starts
 * rather than where it ends, and it leaves the row's full width to the words.
 */
export function CompleteChoreTick({
  choreId,
  title,
}: {
  choreId: number;
  title: string;
}) {
  return (
    <form action={completeChore.bind(null, choreId)} className="shrink-0">
      <TickButton label={`Mark "${title}" done`} />
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
