/** Company credit: small and quiet, so people know who built Better Me. */
export const COMPANY = {
  name: 'Trillionaire Designs',
  url: 'https://trillionairedesigns.co.ke',
  domain: 'trillionairedesigns.co.ke',
};

export function Credit({ className = '' }: { className?: string }) {
  return (
    <p className={'credit ' + className}>
      Built by{' '}
      <a href={COMPANY.url} target="_blank" rel="noopener noreferrer" aria-label={`Built by ${COMPANY.name} (opens ${COMPANY.domain})`}>
        {COMPANY.name}
      </a>
    </p>
  );
}
