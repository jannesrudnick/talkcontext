import type { Metadata } from "next";

export const metadata: Metadata = { title: "Datenschutzerklärung – qey" };

export default function Datenschutz() {
  return (
    <article lang="de" className="legal">
      <h1>Datenschutzerklärung</h1>

      <h2>1. Verantwortlicher</h2>
      <p>
        Jannes Rudnick
        <br />
        Dresdner Landstraße 50
        <br />
        01705 Freital
        <br />
        E-Mail: <a href="mailto:kontakt@jannesrudnick.com">kontakt@jannesrudnick.com</a>
      </p>
      <p>
        Diese Datenschutzerklärung gilt für die Website qey (diese Landingpage) und beschreibt außerdem, wie die
        Browser-Erweiterung qey mit Daten umgeht.
      </p>

      <h2>2. Das Wichtigste vorab</h2>
      <ul>
        <li>Diese Website setzt keine Cookies und verwendet keine Analyse- oder Tracking-Werkzeuge.</li>
        <li>Es gibt keine Formulare, keine Nutzerkonten und keinen Newsletter.</li>
        <li>
          Schriftarten werden von unserem eigenen Server ausgeliefert; beim Aufruf werden keine Verbindungen zu Google
          oder anderen Drittanbietern aufgebaut.
        </li>
        <li>Personenbezogene Daten fallen nur in den Server-Logfiles unseres Hosters an (siehe Abschnitt 3).</li>
      </ul>

      <h2>3. Hosting bei Vercel</h2>
      <p>
        Diese Website wird bei Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA („Vercel“) gehostet. Beim
        Aufruf der Website verarbeitet Vercel automatisch Informationen, die Ihr Browser übermittelt, insbesondere:
      </p>
      <ul>
        <li>IP-Adresse</li>
        <li>Datum und Uhrzeit des Zugriffs</li>
        <li>aufgerufene Seite bzw. Datei</li>
        <li>Referrer-URL (die zuvor besuchte Seite)</li>
        <li>verwendeter Browser und Betriebssystem (User-Agent)</li>
      </ul>
      <p>
        Diese Daten sind technisch erforderlich, um die Website auszuliefern sowie ihre Stabilität und Sicherheit zu
        gewährleisten (z. B. zur Abwehr von Angriffen). Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser
        berechtigtes Interesse liegt in einer sicheren, schnellen und zuverlässigen Bereitstellung der Website. Die
        Daten werden nicht mit anderen Datenquellen zusammengeführt und von Vercel nur so lange gespeichert, wie es für
        diese Zwecke erforderlich ist.
      </p>
      <p>
        Vercel verarbeitet die Daten in unserem Auftrag auf Grundlage eines Vertrags zur Auftragsverarbeitung (Art. 28
        DSGVO). Dabei können Daten in die USA übermittelt werden. Vercel ist unter dem EU-U.S. Data Privacy Framework
        zertifiziert; die Übermittlung erfolgt auf Grundlage des Angemessenheitsbeschlusses der Europäischen Kommission
        (Art. 45 DSGVO). Weitere Informationen:{" "}
        <a href="https://vercel.com/legal/privacy-notice">Datenschutzerklärung von Vercel</a>.
      </p>

      <h2>4. Externe Links</h2>
      <p>
        Die Website verlinkt auf das Repository bei GitHub (GitHub, Inc., USA). Daten werden an GitHub erst übermittelt,
        wenn Sie einen solchen Link anklicken; dann gilt die Datenschutzerklärung von GitHub.
      </p>

      <h2>5. Kontakt per E-Mail</h2>
      <p>
        Wenn Sie uns per E-Mail kontaktieren, verarbeiten wir Ihre Angaben (z. B. Name, E-Mail-Adresse, Inhalt der
        Anfrage), um Ihr Anliegen zu bearbeiten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO bzw. Art. 6 Abs. 1 lit.
        b DSGVO, wenn Ihre Anfrage auf einen Vertrag abzielt. Die Daten werden gelöscht, sobald Ihr Anliegen erledigt
        ist und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.
      </p>

      <h2>6. Browser-Erweiterung qey</h2>
      <p>
        Die Erweiterung ist Open-Source-Software, die Sie selbst installieren und betreiben. Wir erhalten dabei keine
        Daten.
      </p>
      <ul>
        <li>
          Aufnahmen (Session-Replay, DOM-Protokoll, Konsole, Netzwerk, Screenshots, Audio und Transkript) werden
          ausschließlich lokal im Browser gespeichert.
        </li>
        <li>
          Die Übergabe an Claude Code erfolgt an einen MCP-Server auf Ihrem eigenen Rechner (127.0.0.1) und legt die
          Aufnahme dort lokal ab.
        </li>
        <li>
          Nur wenn Sie in den Einstellungen selbst einen OpenAI-API-Schlüssel hinterlegen, wird die Tonspur zur
          Transkription an OpenAI übermittelt. Dafür gelten Ihre Vereinbarung mit OpenAI und deren
          Datenschutzbestimmungen. Ohne Schlüssel erfolgt die Transkription lokal im Browser.
        </li>
      </ul>
      <p>
        Wenn Sie mit qey Websites aufnehmen, auf denen personenbezogene Daten Dritter sichtbar sind, sind Sie für deren
        Verarbeitung selbst verantwortlich.
      </p>

      <h2>7. Ihre Rechte</h2>
      <p>Sie haben im Rahmen der gesetzlichen Bestimmungen jederzeit das Recht auf</p>
      <ul>
        <li>Auskunft über Ihre gespeicherten personenbezogenen Daten (Art. 15 DSGVO),</li>
        <li>Berichtigung (Art. 16 DSGVO) und Löschung (Art. 17 DSGVO),</li>
        <li>Einschränkung der Verarbeitung (Art. 18 DSGVO),</li>
        <li>Datenübertragbarkeit (Art. 20 DSGVO),</li>
        <li>
          Widerspruch gegen Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO aus Gründen, die sich aus Ihrer
          besonderen Situation ergeben (Art. 21 DSGVO),
        </li>
        <li>Beschwerde bei einer Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO).</li>
      </ul>
      <p>Wenden Sie sich dazu einfach per E-Mail an uns.</p>

      <h2>8. SSL-/TLS-Verschlüsselung</h2>
      <p>
        Diese Website nutzt aus Sicherheitsgründen eine SSL- bzw. TLS-Verschlüsselung. Eine verschlüsselte Verbindung
        erkennen Sie an „https://“ und dem Schloss-Symbol in der Adresszeile Ihres Browsers.
      </p>

      <p className="text-sm text-zinc-500">Stand: Oktober 2026</p>
    </article>
  );
}
