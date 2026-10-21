/**
 * The maker's credit. Deliberately quiet -- tertiary text, one line -- the way
 * an app's credit sits at the foot of its Settings rather than in the way.
 * Opens in the browser, so following it never navigates the app itself away.
 */
export function MadeBy({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-text-tertiary ${className}`}>
      Made by Mahmudul Khan ·{" "}
      <a
        href="https://www.mahmudulkhan.com"
        target="_blank"
        rel="noopener"
        className="font-medium text-accent-text underline-offset-2 hover:underline"
      >
        mahmudulkhan.com
      </a>
    </p>
  );
}
