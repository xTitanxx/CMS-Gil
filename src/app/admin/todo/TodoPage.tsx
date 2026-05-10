"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/app/admin/_shared/PageHeader";
import { Trash2, Plus } from "lucide-react";

interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

export default function TodoPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/todo")
      .then((r) => r.json())
      .then((data: Todo[]) => setTodos(data))
      .finally(() => setLoading(false));
  }, []);

  async function add() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const res = await fetch("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const todo = await res.json() as Todo;
    setTodos((prev) => [...prev, todo]);
  }

  async function toggle(id: string, done: boolean) {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done } : t)));
    await fetch(`/api/todo/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
  }

  async function remove(id: string) {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/todo/${id}`, { method: "DELETE" });
  }

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div className="mx-auto max-w-xl py-10 px-4">
      <PageHeader title="To-Do" subtitle="Notes for future work sessions" className="mb-6" />

      <div className="flex gap-2 mb-8">
        <input
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Add a task..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button
          onClick={add}
          className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      {loading && (
        <p className="text-sm text-gray-400 text-center mt-16">Loading...</p>
      )}

      {!loading && open.length > 0 && (
        <ul className="space-y-2 mb-8">
          {open.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
              <input
                type="checkbox"
                checked={false}
                onChange={() => toggle(t.id, true)}
                className="h-4 w-4 cursor-pointer accent-blue-600"
              />
              <span className="flex-1 text-sm text-gray-800">{t.text}</span>
              <button onClick={() => remove(t.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && done.length > 0 && (
        <>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Done</p>
          <ul className="space-y-2">
            {done.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 opacity-60">
                <input
                  type="checkbox"
                  checked={true}
                  onChange={() => toggle(t.id, false)}
                  className="h-4 w-4 cursor-pointer accent-blue-600"
                />
                <span className="flex-1 text-sm text-gray-500 line-through">{t.text}</span>
                <button onClick={() => remove(t.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {!loading && todos.length === 0 && (
        <p className="text-sm text-gray-400 text-center mt-16">No tasks yet. Add one above.</p>
      )}
    </div>
  );
}
