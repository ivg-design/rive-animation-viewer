import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "Auto Updates" };

export default function Updates() {
  return (
    <>
      <h1>Automatic Updates</h1>

      <p>
        Desktop builds include Tauri&apos;s updater plugin. On launch, RAV checks the
        GitHub Releases feed in the background. If a newer, Tauri-signed updater payload
        is available, the runtime strip shows an update chip.
      </p>

      <Image src={asset("/docs/update-chip.webp")} alt="Runtime strip showing UPDATE 2.1.1 chip" width={600} height={40} className="rounded-lg border border-[var(--border-dark)] my-4" />

      <h2>Update Chip States</h2>
      <ul>
        <li><strong>Hidden</strong> &mdash; no update available</li>
        <li><strong>UPDATE &lt;version&gt;</strong> &mdash; newer version ready to install</li>
        <li><strong>UPDATING &lt;version&gt;</strong> &mdash; downloading and installing</li>
        <li><strong>RESTARTING</strong> &mdash; installed, app relaunching</li>
        <li><strong>UPDATE RETRY</strong> &mdash; last check or install failed, retryable</li>
      </ul>

      <h2>How Installation Works</h2>
      <p>
        Clicking the update chip downloads the updater artifact for your platform,
        verifies its Tauri signature with the public key embedded in RAV, installs it,
        and relaunches the app. On macOS, that archive contains the same Developer ID
        signed, notarized, and stapled app as the matching DMG. On Windows, the app-owned
        MCP bridge is shut down first to prevent file locking during update. The NSIS updater
        also installs the dedicated <code>.riv</code> icon, rewrites the document-icon registry
        value, and notifies Explorer after every update.
      </p>

      <h2>Release Feed</h2>
      <p>
        The updater only surfaces a new version after the full multi-platform release
        completes, all native-signing and artifact-parity checks pass, and the merged
        <code>latest.json</code> feed is published. Draft releases are ignored by the
        <code>releases/latest</code> endpoint, so a partially complete release cannot
        advance installed clients.
      </p>
      <p>
        Version 2.5.1 is published through the normal update feed for supported macOS and Windows
        installations.
      </p>

      <h2>Two Trust Layers</h2>
      <p>
        Apple Developer ID signing and notarization let macOS and Gatekeeper trust the
        application. Tauri&apos;s updater <code>.sig</code> authenticates the downloaded
        archive before RAV installs it. They are independent checks and every macOS update
        must pass both.
      </p>

      <h2>Retry Behavior</h2>
      <p>
        Failed updates no longer wait for a manual click. The app retries automatically
        on focus return, visibility change, network reconnection, and a short timer.
      </p>

      <h2>MCP Repair in 2.4.2</h2>
      <p>
        RAV 2.4.2 fixes the packaged MCP lookup regression in 2.4.1. The updater
        keeps <code>rav-mcp</code> beside the application executable, and the
        relaunched app now resolves that exact sibling path and refreshes an existing
        stable MCP launcher symlink automatically.
      </p>
    </>
  );
}
