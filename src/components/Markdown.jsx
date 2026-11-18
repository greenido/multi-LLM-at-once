import { Suspense, lazy } from 'react';

// The markdown parser is most of the bundle and nothing needs it until the
// first answer arrives, so it loads on its own, after the page.
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer.jsx'));

/** Model output as markdown; the plain text stands in for the moment it takes to load. */
export default function Markdown({ children, className = '' }) {
  return (
    <Suspense fallback={<p className={`whitespace-pre-wrap text-sm ${className}`}>{children}</p>}>
      <MarkdownRenderer className={className}>{children}</MarkdownRenderer>
    </Suspense>
  );
}
