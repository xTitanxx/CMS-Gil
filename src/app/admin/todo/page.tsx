"use client";

import { useState, useEffect } from "react";
import { Trash2, Plus } from "lucide-react";

interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

export default function TodoPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("cms-todos");
    if (stored) setTodos(JSON.parse(stored));
  }, []);

  function save(next: Todo[]) {
    setTodos(next);
    localStorage.setItem("cms-todos", JSON.stringify(next));
  }

  function add() {
    const text = input.trim();
    if (!text) return;
    save([
      ...todos,
      { id: crypto.randomUUID(), text, done: false, createdAt: Date.now() },
    ]);
    setInput("");
  }

  function toggle(id: string) {
    save(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }

  function remove(id: string) {
    save(todos.filter((t) => t.id !== id));
  }

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div className="mx-auto max-w-xl py-10 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">To-Do</h1>
      <p className="text-sm text-gray-500 mb-6">Notes for future work sessions</p>

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

      {open.length > 0 && (
        <ul className="space-y-2 mb-8">
          {open.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
              <input
                type="checkbox"
                checked={false}
                onChange={() => toggle(t.id)}
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

      {done.length > 0 && (
        <>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Done</p>
          <ul className="space-y-2">
            {done.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 opacity-60">
                <input
                  type="checkbox"
                  checked={true}
                  onChange={() => toggle(t.id)}
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

      {todos.length === 0 && (
        <p className="text-sm text-gray-400 text-center mt-16">No tasks yet. Add one above.</p>
      )}
    </div>
  );
}
