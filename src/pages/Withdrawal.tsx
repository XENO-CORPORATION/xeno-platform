/**
 * Widerrufsbelehrung + Muster-Widerrufsformular — Art. 246a § 1 Abs. 2 EGBGB,
 * Anlage 1 and Anlage 2.
 *
 * ── WHY THIS PAGE IS DIFFERENT FROM THE REST OF THE SITE ────────────────────
 *
 * 🔴 The wording is STATUTORY. Using the model instruction correctly and with the
 * blanks properly filled carries a safe harbour (Gesetzlichkeitsfiktion,
 * Art. 246a § 1 Abs. 2 Satz 2 EGBGB): a trader who reproduces it is deemed to
 * have instructed the consumer correctly.
 *
 * That protection is the whole point of not improvising here, and it is fragile
 * in one specific way: it survives filling the blanks and it does NOT survive
 * "improving" the sentences. So do not reword this page for tone, do not shorten
 * it to fit a layout, and do not let a copy pass rewrite it. If something reads
 * awkwardly in English, that is because it is a translation of a German legal
 * text and the German is the operative version.
 *
 * ⚠️ An UNFILLED blank breaks the safe harbour outright — an instruction that
 * still says "[Name/Anschrift einsetzen]" has instructed nobody. Every blank
 * below is filled from the Impressum, and a gate asserts none of the placeholder
 * markers survive.
 *
 * ── THE DIGITAL-CONTENT PART, WHICH IS THE ONE THAT MATTERS HERE ────────────
 *
 * § 356 Abs. 5 BGB: for digital content not supplied on a physical medium, the
 * right of withdrawal expires EARLY if the trader began performance after the
 * consumer expressly consented and acknowledged losing the right. That is what
 * the checkout dialog captures, and this page has to say so — otherwise the
 * instruction would promise a right the checkout then quietly removes.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const PROVIDER = {
  name: 'Emilian-Vasile Cristea',
  street: 'Hauptstraße 112',
  city: '97909 Stadtprozelten',
  country: 'Deutschland',
  email: 'support@xenostudio.ai',
  phone: '+49 1515 3602959',
};

const Block: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="p-6 bg-white/[0.02] border border-white/[0.06] rounded-xl text-white/70 leading-relaxed space-y-4">
    {children}
  </div>
);

const Withdrawal: React.FC = () => (
  <div className="min-h-screen h-full bg-[#08080a] text-white font-['Inter',sans-serif] flex flex-col">
    <header className="border-b border-white/[0.05]">
      <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.svg" alt="Xeno" className="w-8 h-8 rounded-lg object-contain invert" />
          <span className="text-lg font-semibold text-white">Xeno Studio</span>
        </Link>
        <Link to="/" className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors">
          <ArrowLeft size={16} />
          Back to Home
        </Link>
      </div>
    </header>

    <main className="flex-1 max-w-4xl mx-auto px-6 py-12 lg:py-16 w-full">
      <div className="mb-10">
        <h1 className="text-4xl lg:text-5xl font-bold mb-4">Widerrufsbelehrung</h1>
        <p className="text-white/40 text-sm">
          Gesetzliche Muster-Widerrufsbelehrung gemäß Art. 246a § 1 Abs. 2 EGBGB, Anlage 1 ·
          Model withdrawal instructions for consumers
        </p>
      </div>

      <div className="space-y-10">
        {/* ── German: the operative version ───────────────────────────────── */}
        <section>
          <h2 className="text-2xl font-semibold mb-4 text-white">Widerrufsrecht</h2>
          <Block>
            <p>
              Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu
              widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.
            </p>
            <p>
              Um Ihr Widerrufsrecht auszuüben, müssen Sie uns
            </p>
            <div className="pl-4 border-l border-white/[0.12] text-white/80">
              <p>{PROVIDER.name}</p>
              <p>{PROVIDER.street}</p>
              <p>{PROVIDER.city}</p>
              <p>{PROVIDER.country}</p>
              <p className="mt-2">Telefon: {PROVIDER.phone}</p>
              <p>E-Mail: {PROVIDER.email}</p>
            </div>
            <p>
              mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine
              E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können
              dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben
              ist.
            </p>
            <p>
              Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung
              des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.
            </p>
          </Block>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-white">Folgen des Widerrufs</h2>
          <Block>
            <p>
              Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen
              erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten,
              die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns
              angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens
              binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren
              Widerruf dieses Vertrags bei uns eingegangen ist.
            </p>
            <p>
              Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der
              ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich
              etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte
              berechnet.
            </p>
          </Block>
        </section>

        {/* 🔴 The clause that actually applies to this product. */}
        <section>
          <h2 className="text-2xl font-semibold mb-4 text-white">
            Vorzeitiges Erlöschen des Widerrufsrechts
          </h2>
          <Block>
            <p>
              Ihr Widerrufsrecht bei einem Vertrag über die Bereitstellung von digitalen Inhalten,
              die nicht auf einem körperlichen Datenträger geliefert werden, erlischt gemäß
              § 356 Abs. 5 BGB, wenn wir mit der Ausführung des Vertrags begonnen haben, nachdem Sie
            </p>
            <ol className="list-decimal list-inside space-y-2 text-white/70">
              <li>
                ausdrücklich zugestimmt haben, dass wir mit der Ausführung des Vertrags vor Ablauf der
                Widerrufsfrist beginnen, und
              </li>
              <li>
                Ihre Kenntnis davon bestätigt haben, dass Sie durch Ihre Zustimmung mit Beginn der
                Ausführung des Vertrags Ihr Widerrufsrecht verlieren.
              </li>
            </ol>
            <p>
              Beide Erklärungen werden im Bestellvorgang ausdrücklich abgefragt und zusammen mit dem
              genauen Wortlaut und dem Zeitpunkt Ihrer Zustimmung gespeichert. Wenn Sie Ihr
              Widerrufsrecht behalten möchten, schließen Sie den Kauf bitte nicht ab, sondern wenden
              Sie sich an{' '}
              <a href={`mailto:${PROVIDER.email}`} className="text-white underline underline-offset-2">
                {PROVIDER.email}
              </a>
              . Wir richten Ihnen dann einen späteren Zugang ein.
            </p>
          </Block>
        </section>

        {/* ── Anlage 2 ────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-2xl font-semibold mb-4 text-white">Muster-Widerrufsformular</h2>
          <p className="text-white/50 text-sm mb-4">
            Anlage 2 zu Art. 246a § 1 Abs. 2 Satz 1 Nr. 1 EGBGB. Wenn Sie den Vertrag widerrufen
            wollen, füllen Sie bitte dieses Formular aus und senden Sie es zurück — die Verwendung ist
            freiwillig.
          </p>
          <Block>
            <p className="text-white/50 text-sm">An:</p>
            <div className="pl-4 border-l border-white/[0.12] text-white/80">
              <p>{PROVIDER.name}</p>
              <p>{PROVIDER.street}</p>
              <p>{PROVIDER.city}</p>
              <p>{PROVIDER.country}</p>
              <p>E-Mail: {PROVIDER.email}</p>
            </div>
            <div className="space-y-3 text-white/70">
              <p>
                Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den
                Kauf der folgenden Waren (*) / die Erbringung der folgenden Dienstleistung (*)
              </p>
              <p>__________________________________________________</p>
              <p>Bestellt am (*) / erhalten am (*): _______________________</p>
              <p>Name des/der Verbraucher(s): ___________________________</p>
              <p>Anschrift des/der Verbraucher(s): ______________________</p>
              <p>__________________________________________________</p>
              <p>Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)</p>
              <p>Datum: _______________</p>
              <p className="text-white/40 text-sm pt-2">(*) Unzutreffendes streichen.</p>
            </div>
          </Block>
        </section>

        {/* ── English, clearly marked as non-operative ────────────────────── */}
        <section>
          <h2 className="text-2xl font-semibold mb-4 text-white">In English</h2>
          <div className="p-6 bg-white/[0.02] border border-white/[0.06] rounded-xl text-white/70 leading-relaxed space-y-4">
            <p className="text-white/50 text-sm">
              ⚠️ A convenience translation. The German text above is the legally binding version,
              because it reproduces the statutory model instruction. Where the two differ, the German
              governs.
            </p>
            <p>
              You have the right to withdraw from this contract within{' '}
              <strong className="text-white/90">14 days</strong> without giving any reason. The period
              begins on the day the contract is concluded. To exercise it, tell us clearly — a letter
              or an email to{' '}
              <a href={`mailto:${PROVIDER.email}`} className="text-white underline underline-offset-2">
                {PROVIDER.email}
              </a>{' '}
              is enough. Sending your notice before the deadline is sufficient.
            </p>
            <p>
              If you withdraw, we refund every payment received from you without undue delay and at
              the latest within 14 days of being told, using the same means of payment you used. You
              are never charged a fee for the refund.
            </p>
            <p>
              <strong className="text-white/90">For digital content the right ends early.</strong>{' '}
              Because the software and platform are made available immediately, we ask you at
              checkout to request that immediate access and to confirm you understand it ends your
              right of withdrawal. Both are recorded together with the exact wording and the time. If
              you would rather keep the right, do not complete checkout — email us and we will arrange
              delayed access.
            </p>
          </div>
        </section>

        <p className="text-white/40 text-sm">
          See also the{' '}
          <Link to="/terms" className="text-white/70 underline underline-offset-2">Terms of Service</Link>,{' '}
          <Link to="/refunds" className="text-white/70 underline underline-offset-2">Refund Policy</Link>{' '}
          and{' '}
          <Link to="/impressum" className="text-white/70 underline underline-offset-2">Impressum</Link>.
          The refund policy may be more generous than this statutory right; it is never less.
        </p>
      </div>
    </main>

    <footer className="border-t border-white/[0.05]">
      <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-sm text-white/30">© {new Date().getFullYear()} Xeno Studio. All rights reserved.</p>
        <div className="flex items-center gap-6 text-sm text-white/40">
          <Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link>
          <Link to="/terms" className="hover:text-white transition-colors">Terms</Link>
          <Link to="/impressum" className="hover:text-white transition-colors">Impressum</Link>
        </div>
      </div>
    </footer>
  </div>
);

export default Withdrawal;
