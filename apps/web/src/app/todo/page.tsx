"use client";

import { useEffect, useReducer, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ListTodo, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseTodos, reduceTodos } from "@/lib/todos";

const storageKey = "kiln-todos";

export default function TodoPage() {
  const [todos, dispatch] = useReducer(reduceTodos, []);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    try {
      dispatch({ type: "restore", todos: parseTodos(window.localStorage.getItem(storageKey)) });
    } catch {
      setStorageError(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(todos));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [loaded, todos]);

  function addTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    dispatch({ type: "add", id: crypto.randomUUID(), text });
    setText("");
  }

  const remaining = todos.filter((todo) => !todo.completed).length;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex w-fit items-center gap-2 rounded-sm text-sm outline-none focus-visible:ring-3"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to dashboard
        </Link>
        <div className="flex items-center gap-3">
          <ListTodo aria-hidden="true" className="size-7" />
          <h1 className="text-2xl font-semibold tracking-tight">To-do list</h1>
        </div>
        <p className="text-muted-foreground text-sm">Keep track of what needs doing. Tasks stay in this browser.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Add a task</CardTitle>
          <CardDescription>Give it a name, then press Enter or Add task.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addTodo} className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="new-task" className="sr-only">New task</label>
            <input
              id="new-task"
              type="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="What needs doing?"
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 min-w-0 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-3 sm:w-auto sm:flex-1"
            />
            <Button type="submit" size="lg" disabled={!text.trim()}>
              <Plus aria-hidden="true" />
              Add task
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="grid-cols-[1fr_auto]">
          <CardTitle>Tasks</CardTitle>
          <Badge variant="secondary">{remaining} left</Badge>
        </CardHeader>
        <CardContent>
          {!loaded ? (
            <p className="text-muted-foreground py-6 text-center text-sm">Loading tasks…</p>
          ) : todos.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">No tasks yet. Add one above to get started.</p>
          ) : (
            <ul className="divide-border divide-y">
              {todos.map((todo) => (
                <li key={todo.id} className="flex items-center gap-3 py-3">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={todo.completed}
                      onChange={() => dispatch({ type: "toggle", id: todo.id })}
                      className="accent-foreground size-5 shrink-0 cursor-pointer"
                    />
                    <span className={todo.completed ? "text-muted-foreground min-w-0 break-words line-through" : "min-w-0 break-words"}>
                      {todo.text}
                    </span>
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${todo.text}`}
                    onClick={() => dispatch({ type: "delete", id: todo.id })}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {storageError && (
            <p role="alert" className="text-destructive pt-3 text-sm">
              Tasks could not be saved in this browser.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
