import { describe, expect, it } from "vitest";
import { parseTodos, reduceTodos, type Todo } from "@/lib/todos";

const initialTodos: Todo[] = [
  { id: "first", text: "Buy milk", completed: false },
  { id: "second", text: "Read a book", completed: true },
];

describe("todo actions", () => {
  it("restores saved tasks", () => {
    expect(reduceTodos([], { type: "restore", todos: initialTodos })).toEqual(initialTodos);
  });

  it("adds a trimmed task without changing existing tasks", () => {
    expect(reduceTodos(initialTodos, { type: "add", id: "third", text: "  Walk the dog  " })).toEqual([
      ...initialTodos,
      { id: "third", text: "Walk the dog", completed: false },
    ]);
    expect(initialTodos).toHaveLength(2);
  });

  it("does not add an empty task", () => {
    expect(reduceTodos(initialTodos, { type: "add", id: "third", text: " \n " })).toBe(initialTodos);
  });

  it("toggles completion in both directions without changing other tasks", () => {
    const completed = reduceTodos(initialTodos, { type: "toggle", id: "first" });
    expect(completed).toEqual([{ ...initialTodos[0], completed: true }, initialTodos[1]]);
    expect(reduceTodos(completed, { type: "toggle", id: "first" })).toEqual(initialTodos);
  });

  it("deletes only the selected task", () => {
    expect(reduceTodos(initialTodos, { type: "delete", id: "first" })).toEqual([initialTodos[1]]);
  });
});

describe("saved todos", () => {
  it("restores valid tasks", () => {
    expect(parseTodos(JSON.stringify(initialTodos))).toEqual(initialTodos);
  });

  it("starts empty when storage is missing, malformed, or has the wrong shape", () => {
    expect(parseTodos(null)).toEqual([]);
    expect(parseTodos("{")).toEqual([]);
    expect(parseTodos('[{"id":"first","text":"Buy milk","completed":"yes"}]')).toEqual([]);
  });
});
