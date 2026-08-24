import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Impressum — legally required provider identification under § 5 DDG
 * (Digitale-Dienste-Gesetz) for a German business. Operator is a sole proprietor
 * (Einzelunternehmen), so the natural person's name + address are shown, as
 * required. Reachable from the footer of every page (Anbieterkennzeichnung).
 *
 * NOTE: standard template — have it verified by a Steuerberater/Rechtsanwalt, and
 * add the USt-IdNr line once the Bundeszentralamt für Steuern assigns it.
 */
const Impressum: React.FC = () => {
  return (
    <div className="min-h-screen h-full bg-[#08080a] text-white font-['Inter',sans-serif] flex flex-col">
      {/* Simple Header */}
      <header className="border-b border-white/[0.05]">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <img src="/logo.svg" alt="Xeno" className="w-8 h-8 rounded-lg object-contain invert" />
            <span className="text-lg font-semibold text-white">Xeno Studio</span>
          </Link>
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Home
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-4xl mx-auto px-6 py-12 lg:py-16 w-full">
        <div className="mb-12">
          <h1 className="text-4xl lg:text-5xl font-bold mb-4">Impressum</h1>
          <p className="text-white/40 text-sm">
            Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz) · Anbieterkennzeichnung für xenostudio.ai
          </p>
        </div>

        <div className="prose prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Diensteanbieter</h2>
            <div className="p-6 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <p className="text-white/80 font-medium">Emilian-Vasile Cristea</p>
              <p className="text-white/60 mt-1">Einzelunternehmen</p>
              <p className="text-white/60 mt-2">
                Hauptstraße 112<br />
                97909 Stadtprozelten<br />
                Deutschland
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Kontakt</h2>
            <ul className="list-none text-white/60 space-y-2">
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
            <h2 className="text-2xl font-semibold mb-4 text-white">Umsatzsteuer-Identifikationsnummer</h2>
            <p className="text-white/60 leading-relaxed">
              Eine Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz ist beantragt
              und wird nach Zuteilung durch das Bundeszentralamt für Steuern an dieser Stelle ergänzt.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">
              Redaktionell verantwortlich
            </h2>
            <p className="text-white/60 leading-relaxed">
              Verantwortlich für journalistisch-redaktionelle Inhalte gemäß § 18 Abs. 2 MStV:
            </p>
            <p className="text-white/60 leading-relaxed mt-2">
              Emilian-Vasile Cristea, Anschrift wie oben.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Verbraucherstreitbeilegung</h2>
            <p className="text-white/60 leading-relaxed">
              Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
              Verbraucherschlichtungsstelle im Sinne des Verbraucherstreitbeilegungsgesetzes (VSBG)
              teilzunehmen.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Haftung für Inhalte</h2>
            <p className="text-white/60 leading-relaxed">
              Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten
              nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir als
              Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde
              Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige
              Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der Nutzung von
              Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Haftung für Links</h2>
            <p className="text-white/60 leading-relaxed">
              Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen
              Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr
              übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder
              Betreiber der Seiten verantwortlich.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">Urheberrecht</h2>
            <p className="text-white/60 leading-relaxed">
              Die durch den Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen
              dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art
              der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen
              Zustimmung des jeweiligen Autors bzw. Erstellers.
            </p>
          </section>
        </div>
      </main>

      {/* Simple Footer */}
      <footer className="border-t border-white/[0.05]">
        <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/30">
            © {new Date().getFullYear()} Emilian-Vasile Cristea · XENO Studio. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-sm text-white/40">
            <Link to="/impressum" className="hover:text-white transition-colors">Impressum</Link>
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Impressum;
