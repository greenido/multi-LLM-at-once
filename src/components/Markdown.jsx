import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Model output is markdown. react-markdown does not render raw HTML unless
 * rehype-raw is added, which it deliberately is not, so model output cannot
 * inject markup.
 */
const COMPONENTS = {
  // Tables and long code lines scroll inside the panel rather than widening it.
  table: ({ node, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
  pre: ({ node, ...props }) => (
    <pre className="overflow-x-auto" {...props} />
  ),
  a: ({ node, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
};

export default function Markdown({ children, className = '' }) {
  return (
    <div className={`prose prose-sm prose-slate max-w-none prose-pre:my-2 prose-pre:bg-slate-100 prose-pre:text-slate-800 prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-table:my-2 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
