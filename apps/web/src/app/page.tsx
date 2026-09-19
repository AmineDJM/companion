import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BRAND } from '@companion/shared';
import { CreateFlow, HowItWorks } from '../components/create-flow';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import { AskGlyph } from '../components/ui/logo';
import { ClockIcon, ChartIcon, EyeOffIcon, ShieldIcon } from '../components/ui/icons';
import { getAuthContext } from '../server/auth/session';

export const metadata: Metadata = {
  title: 'Companion — Share Documents That Can Answer Questions',
  description: BRAND.description,
  alternates: { canonical: '/' },
};

export const dynamic = 'force-dynamic';

/**
 * The homepage *is* the product.
 *
 * A visitor sees the proposition and the dropzone above the fold. There is no
 * marketing detour, no hero carousel and no "sign up to get started" gate — the
 * account is requested only once the upload has real value behind it.
 */
export default async function HomePage() {
  const auth = await getAuthContext().catch(() => null);
  if (auth) redirect('/app/companions');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader user={null} />

      <main id="main" className="flex-1">
        <section className="mx-auto max-w-3xl px-5 pb-6 pt-10 sm:px-6 sm:pt-16">
          <h1 className="text-balance text-[30px] leading-[1.12] text-ink sm:text-[38px]">
            Share the documents.
            <br />
            <span className="text-ink-muted">Keep the control.</span>
          </h1>
          <p className="mt-3.5 max-w-xl text-pretty text-[15px] leading-relaxed text-ink-muted">
            Drop anything you want to share. Companion turns it into one intelligent, controlled
            link — and the people you send it to never need an account.
          </p>

          <div className="mt-8">
            <CreateFlow authenticated={false} />
          </div>

          <HowItWorks className="mt-10 border-t border-line pt-8" />
        </section>

        <section className="mx-auto max-w-5xl px-5 py-12 sm:px-6" aria-labelledby="benefits">
          <h2 id="benefits" className="sr-only">
            What Companion gives you
          </h2>
          <ul className="grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
            <Benefit
              icon={<AskGlyph size={16} />}
              title="Ask anything"
              body="Recipients read normally, and ask a question whenever they need one. Answers cite the exact page."
            />
            <Benefit
              icon={<EyeOffIcon size={17} />}
              title="Disable downloads"
              body="Share a document to read without handing over the original file."
            />
            <Benefit
              icon={<ClockIcon size={17} />}
              title="Expire or revoke anytime"
              body="Set an expiry, extend it later, or cut off access the moment you change your mind."
            />
            <Benefit
              icon={<ChartIcon size={17} />}
              title="See what people ask"
              body="Know which documents were read, which pages mattered, and what nobody could find."
            />
          </ul>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-5xl gap-8 px-5 py-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
            <div>
              <h2 className="text-balance text-[24px] leading-tight text-ink">
                The same link, even after you change your mind.
              </h2>
              <p className="mt-3 max-w-lg text-pretty text-[14.5px] leading-relaxed text-ink-muted">
                Replace a document, add a file, extend the expiry, turn downloads off, change the
                password. The link you already sent keeps working — and always shows the current
                version.
              </p>
              <Link
                href="/security"
                className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-[500] text-accent transition-colors hover:text-accent-hover"
              >
                <ShieldIcon size={16} />
                How we handle your documents
              </Link>
            </div>

            <div className="surface-panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <span className="size-2 rounded-full bg-line-strong" />
                <span className="size-2 rounded-full bg-line-strong" />
                <span className="size-2 rounded-full bg-line-strong" />
                <span className="ml-2 font-mono text-[11.5px] text-ink-subtle">
                  companion.app/x8K2pz
                </span>
              </div>
              <div className="space-y-2.5 p-4">
                <div className="h-2 w-3/4 rounded-full bg-surface-sunken" />
                <div className="h-2 w-full rounded-full bg-surface-sunken" />
                <div className="h-2 w-5/6 rounded-full bg-surface-sunken" />
                <div className="h-2 w-2/3 rounded-full bg-surface-sunken" />
                <div className="mt-5 flex items-center gap-2 rounded-[12px] border border-line bg-canvas px-3.5 py-2.5">
                  <AskGlyph size={13} className="text-accent" />
                  <span className="text-[13px] text-ink-subtle">Ask anything…</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 py-12 sm:px-6" aria-labelledby="faq">
          <h2 id="faq" className="text-[20px] text-ink">
            Common questions
          </h2>
          <dl className="mt-6 divide-y divide-line">
            <Faq
              question="Do the people I send it to need an account?"
              answer="No. They open the link and see the document. There is no sign-up, no wall and no app to install."
            />
            <Faq
              question="Can I stop someone downloading the file?"
              answer="Yes. With downloads disabled, recipients can read, navigate and ask questions, but the original file is never exposed to the browser. No web viewer can prevent a screenshot, and we do not claim otherwise."
            />
            <Faq
              question="What happens if I update a document?"
              answer="Replace it and the link stays exactly the same. Recipients see the new version immediately, and answers come from the new content."
            />
            <Faq
              question="What can I upload?"
              answer="PDF, Word, PowerPoint, Excel, CSV, text, images and ZIP archives — one file, a hundred files, or a folder dropped straight in."
            />
          </dl>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function Benefit({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li>
      <span className="flex size-9 items-center justify-center rounded-[11px] bg-accent-soft text-accent">
        {icon}
      </span>
      <h3 className="mt-3.5 text-[14.5px] font-[520] text-ink">{title}</h3>
      <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}

function Faq({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="py-4">
      <dt className="text-[14.5px] font-[520] text-ink">{question}</dt>
      <dd className="mt-1.5 text-pretty text-[13.5px] leading-relaxed text-ink-muted">{answer}</dd>
    </div>
  );
}
