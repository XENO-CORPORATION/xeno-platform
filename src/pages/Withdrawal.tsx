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
import MarketingPage from '../components/marketing/MarketingPage';

const PROVIDER = {
  name: 'Emilian-Vasile Cristea',
  street: 'Hauptstraße 112',
  city: '97909 Stadtprozelten',
  country: 'Deutschland',
  email: 'support@xenostudio.ai',
  phone: '+49 1515 3602959',
};

const Block: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-[16px] border border-white/[0.07] bg-[#101010] p-[clamp(18px,1.8vw,28px)] space-y-4">
    {children}
  </div>
);

const Withdrawal: React.FC = () => (
  <MarketingPage eyebrow="Legal" title="Widerrufsbelehrung" subtitle={"Gesetzliche Muster-Widerrufsbelehrung gemäß Art. 246a § 1 Abs. 2 EGBGB, Anlage 1 · Model withdrawal instructions for consumers"}>
      <div className="legal-prose">
      <div className="space-y-10">
        {/* ── German: the operative version ───────────────────────────────── */}
        <section>
          <h2>Widerrufsrecht</h2>
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
              <p>Telefon: {PROVIDER.phone}</p>
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
          <h2>Folgen des Widerrufs</h2>
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
          <h2>
            Vorzeitiges Erlöschen des Widerrufsrechts
          </h2>
          <Block>
            <p>
              Ihr Widerrufsrecht bei einem Vertrag über die Bereitstellung von digitalen Inhalten,
              die nicht auf einem körperlichen Datenträger geliefert werden, erlischt gemäß
              § 356 Abs. 5 BGB, wenn wir mit der Ausführung des Vertrags begonnen haben, nachdem Sie
            </p>
            <ol>
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
          <h2>Muster-Widerrufsformular</h2>
          <p>
            Anlage 2 zu Art. 246a § 1 Abs. 2 Satz 1 Nr. 1 EGBGB. Wenn Sie den Vertrag widerrufen
            wollen, füllen Sie bitte dieses Formular aus und senden Sie es zurück — die Verwendung ist
            freiwillig.
          </p>
          <Block>
            <p>An:</p>
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
              <p>(*) Unzutreffendes streichen.</p>
            </div>
          </Block>
        </section>

        {/* ── English, clearly marked as non-operative ────────────────────── */}
        <section>
          <h2>In English</h2>
          <div className="p-6 bg-white/[0.02] border border-white/[0.06] rounded-xl text-white/70 leading-relaxed space-y-4">
            <p>
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

        <p>
          See also the{' '}
          <Link to="/terms" className="text-white/70 underline underline-offset-2">Terms of Service</Link>,{' '}
          <Link to="/refunds" className="text-white/70 underline underline-offset-2">Refund Policy</Link>{' '}
          and{' '}
          <Link to="/impressum" className="text-white/70 underline underline-offset-2">Impressum</Link>.
          The refund policy may be more generous than this statutory right; it is never less.
        </p>
      </div>
    </div>
  </MarketingPage>
);

export default Withdrawal;
