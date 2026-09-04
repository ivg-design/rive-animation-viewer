import Image from "next/image";
import { asset } from "@/lib/config";

export const metadata = { title: "Automatic Updates" };

export default function Updates() {
  return (
    <>
      <h1>Automatic Updates</h1>

      <p>
        RAV checks for a new desktop release in the background. When an update is
        available, the runtime strip shows an update chip.
      </p>

      <Image src={asset("/docs/update-chip.webp")} alt="Runtime strip showing an update chip" width={600} height={40} className="rounded-lg border border-[var(--border-dark)] my-4" />

      <h2>Update chip states</h2>
      <ul>
        <li><strong>Hidden</strong> &mdash; RAV is up to date</li>
        <li><strong>UPDATE &lt;version&gt;</strong> &mdash; an update is ready to install</li>
        <li><strong>UPDATING &lt;version&gt;</strong> &mdash; the update is downloading and installing</li>
        <li><strong>RESTARTING</strong> &mdash; installation finished and RAV is relaunching</li>
        <li><strong>UPDATE RETRY</strong> &mdash; the last check or installation did not finish</li>
      </ul>

      <h2>Install an update</h2>
      <ol>
        <li>Select <strong>UPDATE &lt;version&gt;</strong>.</li>
        <li>Leave RAV open while the update downloads and installs.</li>
        <li>RAV relaunches automatically when installation finishes.</li>
      </ol>
      <p>
        Save work in other applications before updating. RAV may briefly stop its MCP
        connection while replacing the desktop app and reconnects after relaunch.
      </p>

      <h2>If an update fails</h2>
      <p>
        Select <strong>UPDATE RETRY</strong>. If the same error returns, download the current
        installer from the RAV home page, quit RAV, and install it manually. Your RAV settings
        remain in the application data folder.
      </p>
    </>
  );
}
