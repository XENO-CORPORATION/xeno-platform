import React from 'react';
import { Link } from 'react-router-dom';
import MarketingPage from '../components/marketing/MarketingPage';

/**
 * Impressum — legally required provider identification under § 5 DDG
 * (Digitale-Dienste-Gesetz) for a German business. Operator is a sole proprietor
 * (Einzelunternehmen), so the natural person's name + address are shown, as
 * required. Reachable from the footer of every page (Anbieterkennzeichnung).
 *
 * NOTE: standard template — have it verified by a Steuerberater/Rechtsanwalt.
 *
 * The USt-IdNr is DE463398455, assigned by the Bundeszentralamt für Steuern on
 * 2026-07-02 and confirmed VALID against the EU VIES register before being
 * published here. That check mattered: the notification arrived as a
 * W-IdNr-Mitteilung, and a Wirtschafts-Identifikationsnummer shares the DE +
 * 9-digit format WITHOUT being a VAT ID — publishing one as the other would be
 * wrong on a legally required page. VIES only validates real VAT IDs.
 *
 * § 5 Abs. 1 Nr. 6 DDG requires it to be shown ONCE HELD, so the previous
 * 'ist beantragt' wording was not merely stale, it was non-compliant.
 */
const Impressum: React.FC = () => {
  return (
    <MarketingPage eyebrow="Legal" title="Impressum" subtitle={"Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz) · Anbieterkennzeichnung für xenostudio.ai"}>
      <div className="legal-prose">
          <section>
            <h2>Diensteanbieter</h2>
            <div className="p-6 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <p>Emilian-Vasile Cristea</p>
              <p>Einzelunternehmen</p>
              <p>
                Hauptstraße 112<br />
                97909 Stadtprozelten<br />
                Deutschland
              </p>
            </div>
          </section>

          <section>
            <h2>Kontakt</h2>
            <ul>
              <li>Telefon: +49 1515 3602959</li>
              <li>
                E-Mail:{' '}
                <a href="mailto:support@xenostudio.ai" className="text-[#e8e3dc] hover:underline">
                  support@xenostudio.ai
                </a>
              </li>
              <li>
                Kontaktformular:{' '}
                <Link to="/contact" className="text-[#e8e3dc] hover:underline">
                  xenostudio.ai/contact
                </Link>
              </li>
            </ul>
          </section>

          <section>
            <h2>Umsatzsteuer-Identifikationsnummer</h2>
            <p>
              Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz:
              <br />
              <span className="text-white/80 font-medium">DE463398455</span>
            </p>
          </section>

          <section>
            <h2>Umsatzsteuer</h2>
            <p>
              Als Kleinunternehmer im Sinne von § 19 Abs. 1 Umsatzsteuergesetz wird keine
              Umsatzsteuer berechnet und daher auch nicht in Rechnungen ausgewiesen.
            </p>
          </section>

          <section>
            <h2>
              Redaktionell verantwortlich
            </h2>
            <p>
              Verantwortlich für journalistisch-redaktionelle Inhalte gemäß § 18 Abs. 2 MStV:
            </p>
            <p>
              Emilian-Vasile Cristea, Anschrift wie oben.
            </p>
          </section>

          <section>
            <h2>Verbraucherstreitbeilegung</h2>
            <p>
              Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
              Verbraucherschlichtungsstelle im Sinne des Verbraucherstreitbeilegungsgesetzes (VSBG)
              teilzunehmen.
            </p>
          </section>

          <section>
            <h2>Haftung für Inhalte</h2>
            <p>
              Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten
              nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir als
              Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde
              Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige
              Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der Nutzung von
              Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt.
            </p>
          </section>

          <section>
            <h2>Haftung für Links</h2>
            <p>
              Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen
              Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr
              übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder
              Betreiber der Seiten verantwortlich.
            </p>
          </section>

          <section>
            <h2>Urheberrecht</h2>
            <p>
              Die durch den Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen
              dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art
              der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen
              Zustimmung des jeweiligen Autors bzw. Erstellers.
            </p>
          </section>
      </div>
    </MarketingPage>
  );
};

export default Impressum;
