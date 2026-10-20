import { z } from "zod";

const todoSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  completed: z.boolean(),
});

export type Todo = z.infer<typeof todoSchema>;

type TodoAction =
  | { type: "restore"; todos: Todo[] }
  | { type: "add"; id: string; text: string }
  | { type: "toggle"; id: string }
  | { type: "delete"; id: string };

export function reduceTodos(todos: Todo[], action: TodoAction): Todo[] {
  switch (action.type) {
    case "restore":
      return action.todos;
    case "add": {
      const text = action.text.trim();
      return text ? [...todos, { id: action.id, text, completed: false }] : todos;
    }
    case "toggle":
      return todos.map((todo) =>
        todo.id === action.id ? { ...todo, completed: !todo.completed } : todo,
      );
    case "delete":
      return todos.filter((todo) => todo.id !== action.id);
  }
}

export function parseTodos(value: string | null): Todo[] {
  if (!value) return [];

  try {
    const result = z.array(todoSchema).safeParse(JSON.parse(value));
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}
