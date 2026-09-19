import type { Metadata } from 'next';
import Link from 'next/link';
import { billingEnabled } from '@/server/env';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'How Companion stores, serves and protects the documents you share: private storage, access controls, expiration, revocation, download restrictions and what view-only can and cannot guarantee.',
  alternates: { canonical: '/security' },
};

/**
 * Deliberately honest. This product handles contracts, investor material and
 * HR files; overstating what a web viewer can guarantee would be worse than
 * saying nothing.
 */
export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12 sm:px-6 sm:py-16">
      <h1 className="text-[30px] leading-tight tracking-[-0.03em] text-ink text-balance">
        How Companion handles your documents
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-muted text-pretty">
        People share contracts, financial models, investor material and HR files through Companion.
        This page explains exactly what we do, and what no document viewer can honestly promise.
      </p>

      <Section title="Storage">
        <p>
          Original files are stored in private object storage. Buckets are never public, and a file
          is never addressable by URL alone. Derived assets — page images, previews, extracted text
          — live under separate prefixes with the same privacy posture.
        </p>
        <p>
          Every transfer is encrypted in transit. Storage is encrypted at rest by the provider.
        </p>
      </Section>

      <Section title="Access control">
        <p>
          Every Companion has an access policy: anyone with the link, a shared password, a specific
          list of people, or visitors who confirm an email address first. The policy is evaluated on
          the server, on <em>every</em> protected request — opening the document, loading a page,
          asking a question, following a citation, downloading a file.
        </p>
        <p>
          That means revoking access, pausing a link or changing a password takes effect immediately,
          including for someone who already has the page open.
        </p>
      </Section>

      <Section title="Expiration and revocation">
        <p>
          You can set an expiry when you share, extend it later, or revoke access entirely. Revoking
          does not delete anything: you can bring the same link back whenever you want.
        </p>
      </Section>

      <Section title="Download restrictions">
        <p>
          When downloads are disabled, recipients read pages rendered on our servers. The original
          file is never sent to their browser, and no link to it is ever issued.
        </p>
        <p className="rounded-[14px] border border-line bg-surface p-4">
          <strong className="font-[520] text-ink">What we will not claim.</strong> Downloads can be
          disabled. No web viewer can prevent screenshots, photographs of a screen, or other
          external capture with absolute certainty. If a document must never be seen by a
          particular person, do not send it to them.
        </p>
      </Section>

      <Section title="Questions and AI processing">
        <p>
          When a recipient asks a question, we search your documents and send only the handful of
          relevant passages to our model provider, along with the question. Your whole document is
          never uploaded to answer a question.
        </p>
        <p>
          We use the OpenAI API under its enterprise data handling terms: API content is not used to
          train models. The API endpoint is configurable, so regional endpoints can be used where
          available.
        </p>
        <p>
          Answers are grounded in your material and cite the page they came from. When the documents
          do not contain an answer, Companion says so rather than inventing one.
        </p>
      </Section>

      <Section title="Protection against reconstruction">
        <p>
          A shared document that cannot be downloaded should not be reconstructible by asking
          questions. Companion enforces this structurally rather than by instruction: requests to
          reproduce a document in full, transcribe it verbatim or walk through it page by page are
          refused before they reach the model, the model only ever receives a bounded set of
          passages, and the length of verbatim quoting is capped per answer and per visitor session.
        </p>
      </Section>

      <Section title="Recipient privacy">
        <p>
          Recipients do not have accounts. By default a visit is anonymous: we store a random
          session identifier, never a raw IP address, and we do not fingerprint browsers.
        </p>
        <p>
          If you turn on identified access, recipients are told plainly that you will be able to see
          who opened the document before they confirm their address.
        </p>
      </Section>

      <Section title="Deletion">
        <p>
          Deleting a Companion stops access immediately and schedules removal of the original files,
          previews, extracted text and search index. Deleting your account cascades the same way.
        </p>
      </Section>

      <Section title="Operational access">
        <p>
          Our own staff can see account and diagnostic information needed to run the service. Viewing
          the content of a customer document requires a deliberate, separately recorded action, and
          every such action is written to an immutable audit log.
        </p>
      </Section>

      <p className="mt-10 text-[13.5px] text-ink-muted">
        Questions about a specific requirement?{' '}
        {billingEnabled() ? (
          <>
            <Link href="/pricing" className="text-accent hover:text-accent-hover">
              See plans
            </Link>{' '}
            or get in touch
          </>
        ) : (
          'Get in touch'
        )}{' '}
        — we would rather answer precisely than generally.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-[18px] text-ink">{title}</h2>
      <div className="mt-2.5 space-y-3 text-[14px] leading-relaxed text-ink-muted text-pretty">
        {children}
      </div>
    </section>
  );
}
