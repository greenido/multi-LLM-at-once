const LINKS = [
  { label: 'Source Code', href: 'https://github.com/greenido/multi-LLM-at-once' },
  { label: 'Contact', href: 'https://x.com/greenido' },
];

const itemClass =
  'rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900';

export default function Navbar({ onExport, onCopyAll }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-3">
        <span className="mr-auto whitespace-nowrap text-lg font-semibold tracking-tight">⛄️ Multi LLMs Tool</span>

        <button type="button" onClick={onExport} className={itemClass}>
          Export
        </button>
        <button type="button" onClick={onCopyAll} className={itemClass}>
          Copy All
        </button>
        {LINKS.map((link) => (
          <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className={itemClass}>
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
