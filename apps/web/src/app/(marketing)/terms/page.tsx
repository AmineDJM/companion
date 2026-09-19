import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms that apply to using Companion.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12 sm:px-6 sm:py-16">
      <h1 className="text-[30px] leading-tight tracking-[-0.03em] text-ink">Terms of service</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
        These terms apply when you use Companion. They are summarised plainly; a formal agreement is
        available on request for business customers.
      </p>

      <Section title="Your account">
        <p>
          You are responsible for what you share and for keeping your credentials safe. Do not use
          Companion to share material you do not have the right to share.
        </p>
      </Section>

      <Section title="Your content">
        <p>
          You keep all rights to the documents you upload. You grant us only the permissions needed
          to store them, render them for the recipients you choose, and answer questions about them.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          Do not use Companion to distribute malware, to infringe others&rsquo; rights, or to share
          material that is unlawful. We may suspend an account that does.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          We work to keep the service available and to process documents reliably, but we do not
          guarantee uninterrupted availability on plans without a written service level agreement.
        </p>
      </Section>

      <Section title="Billing">
        <p>
          Paid plans renew automatically until cancelled. You can cancel at any time from your
          billing settings; access continues until the end of the period you have paid for.
        </p>
      </Section>

      <Section title="Limitations">
        <p>
          Companion can disable downloads, but no web viewer can prevent screenshots or other
          external capture. Answers are generated from your documents and can contain mistakes;
          check anything that matters against the cited source.
        </p>
      </Section>

      <Section title="Ending the agreement">
        <p>
          You can delete your account at any time. We may end the agreement if these terms are
          breached, and will give notice where we reasonably can.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-[18px] text-ink">{title}</h2>
      <div className="mt-2.5 space-y-3 text-[14px] leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}
