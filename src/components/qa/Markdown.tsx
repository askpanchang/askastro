import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders model output. Raw HTML is never rendered (react-markdown escapes it
 * by default and no rehype-raw is used); unsafe link protocols are stripped by
 * the default URL transform.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: c, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
