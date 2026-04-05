import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "Auto Updates" };

export default function Updates() {
  return (
    <>
      <h1>Automatic Updates</h1>

      <p>
        Desktop builds include Tauri&apos;s updater plugin. On launch, RAV checks the
        GitHub Releases feed in the background. If a newer signed release is available,
        the runtime strip shows an update chip.
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
        Clicking the update chip downloads the signed updater artifact for your platform,
        installs it, and relaunches the app. On Windows, the app-owned MCP bridge is shut
        down first to prevent file locking during update.
      </p>

      <h2>Release Feed</h2>
      <p>
        The updater only surfaces a new version after the full multi-platform release
        completes and the merged <code>latest.json</code> feed is published. A partially
        complete GitHub release is not enough for the in-app updater to advance.
      </p>

      <h2>Retry Behavior</h2>
      <p>
        Failed updates no longer wait for a manual click. The app retries automatically
        on focus return, visibility change, network reconnection, and a short timer.
      </p>
    </>
  );
}
