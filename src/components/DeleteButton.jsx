import { useEffect, useState } from 'react';

/**
 * Deleting takes two clicks: the first turns ✕ into "Delete?", the second
 * deletes. Nothing here can be undone, and the ✕ sits right next to the thing
 * people click to open. Left alone, it goes back to ✕.
 */
export default function DeleteButton({ label, onDelete }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      onClick={() => (armed ? onDelete() : setArmed(true))}
      onBlur={() => setArmed(false)}
      aria-label={armed ? `Confirm deleting ${label}` : `Delete ${label}`}
      className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition ${
        armed ? 'bg-red-600 text-white hover:bg-red-700' : 'text-slate-300 hover:bg-slate-100 hover:text-red-600'
      }`}
    >
      {armed ? 'Delete?' : '✕'}
    </button>
  );
}
