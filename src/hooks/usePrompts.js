import { useCallback, useEffect, useState } from 'react';
import { createPrompt, deletePrompt, listPrompts } from '../lib/history.js';

/** Saved system prompts and questions, kept on the server. */
export function usePrompts() {
  const [prompts, setPrompts] = useState([]);

  useEffect(() => {
    listPrompts()
      .then(setPrompts)
      .catch((error) => console.error('Could not read saved prompts:', error));
  }, []);

  const savePrompt = useCallback(async (kind, name, text) => {
    const prompt = await createPrompt({ kind, name, text });
    // In the order the server lists them, so nothing moves on the next load.
    setPrompts((current) =>
      [...current, prompt].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    );
  }, []);

  const removePrompt = useCallback(async (id) => {
    try {
      await deletePrompt(id);
      setPrompts((current) => current.filter((prompt) => prompt.id !== id));
    } catch (error) {
      console.error('Could not delete the prompt:', error);
    }
  }, []);

  return { prompts, savePrompt, removePrompt };
}
