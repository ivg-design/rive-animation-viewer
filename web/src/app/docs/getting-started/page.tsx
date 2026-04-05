import { asset } from "@/lib/config";

export const metadata = { title: "Getting Started" };

export default function GettingStarted() {
  return (
    <>
      <h1>Getting Started</h1>

      <h2>Installation</h2>
      <p>
        RAV is available as a desktop application for macOS (Apple Silicon and Intel) and Windows.
        Download the latest release from the{" "}
        <a href="https://github.com/ivg-design/rive-animation-viewer/releases" target="_blank" rel="noopener noreferrer">
          GitHub Releases
        </a> page.
      </p>

      <h3>macOS</h3>
      <ol>
        <li>Download the <code>.dmg</code> file for your architecture (Apple Silicon or Intel)</li>
        <li>Open the DMG and drag RAV to your Applications folder</li>
        <li>On first launch, right-click the app and select &quot;Open&quot; to bypass Gatekeeper</li>
        <li>RAV registers as the default handler for <code>.riv</code> files &mdash; double-click any <code>.riv</code> to open it</li>
      </ol>

      <h3>Windows</h3>
      <ol>
        <li>Download the <code>.msi</code> installer</li>
        <li>Run the installer and follow the setup wizard</li>
        <li>RAV will be available from the Start menu</li>
      </ol>

      <h3>Browser Mode</h3>
      <p>RAV can also run as a local web server for quick inspection without installing:</p>
      <pre><code>{`git clone https://github.com/ivg-design/rive-animation-viewer.git
cd rive-animation-viewer
npm install
npm start  # Opens browser at http://localhost:1420`}</code></pre>
    </>
  );
}
