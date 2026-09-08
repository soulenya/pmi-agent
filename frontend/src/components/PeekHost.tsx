/**
 * Renders whatever is peeked over the current page. Lives once, in the shell.
 */
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { useAllTasks } from "@/hooks/useAllWork";
import { usePeekStore } from "@/stores/peekStore";

export function PeekHost() {
  const peek = usePeekStore((s) => s.peek);
  const close = usePeekStore((s) => s.close);
  const { tasks } = useAllTasks();

  if (!peek) return null;
  if (peek.kind === "task") {
    const task = tasks.find((t) => t.id === peek.id && t.source === peek.source);
    if (!task) return null;
    return <TaskDrawer task={task} source={task.source} onClose={close} onDeleted={close} />;
  }
  return null;
}
