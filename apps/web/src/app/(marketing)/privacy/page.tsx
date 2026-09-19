import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What Companion collects from senders and recipients, how document content is used, and how long data is kept.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12 sm:px-6 sm:py-16">
      <h1 className="text-[30px] leading-tight tracking-[-0.03em] text-ink">Privacy</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
        This page describes what Companion collects and why. It is written to be read, not to be
        survived.
      </p>

      <Section title="Senders">
        <p>
          We store your email address, your name if you give one, your workspace, your documents and
          the settings you choose. We use them to run the service and to bill you.
        </p>
      </Section>

      <Section title="Recipients">
        <p>
          Recipients do not have accounts. When someone opens a shared link we create a random
          session identifier stored in a cookie scoped to that link. We record which documents and
          pages were opened and what was asked, so the sender can see how their material was used.
        </p>
        <p>
          We do not store raw IP addresses. Where we need to limit abuse we store a salted hash that
          rotates daily and cannot be reversed or used to follow someone across days.
        </p>
        <p>
          If the sender enabled identified access, the recipient is told before confirming their
          email that the sender will see who opened the document.
        </p>
      </Section>

      <Section title="Document content">
        <p>
          Your documents are used to render them for recipients and to answer questions about them.
          They are not used to train models, and they are not shared with other customers.
        </p>
        <p>
          When a question is asked, only the passages relevant to that question are sent to our
          model provider. We do not log document content in our application logs.
        </p>
      </Section>

      <Section title="Sub-processors">
        <p>
          We use OpenAI for question answering and document indexing, Stripe for payments, and a
          cloud infrastructure provider for hosting, storage and database services.
        </p>
      </Section>

      <Section title="Retention">
        <p>
          Documents are kept while their Companion exists. Deleting a Companion stops access
          immediately and schedules removal of the files and index. Analytics events are retained
          while the Companion exists and are deleted with it.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can export, correct or delete your data. Deleting your account removes your workspace,
          your Companions and the documents in them.
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
