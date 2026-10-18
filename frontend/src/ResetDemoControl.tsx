import { useRef, useState } from "react";
import { api } from "./api";
export default function ResetDemoControl({
  revision,
  disabled,
  onBusy,
  onFailure,
}: {
  revision: number;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onFailure: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [request, setRequest] = useState<{
    expectedBaselineRevision: number;
    clientRequestId: string;
    confirm: "RESET DEMO";
  } | null>(null);
  const [error, setError] = useState("");
  return (
    <>
      <button
        className="button secondary"
        disabled={disabled || pending.current}
        onClick={() => {
          setRequest({
            expectedBaselineRevision: revision,
            clientRequestId: crypto.randomUUID(),
            confirm: "RESET DEMO",
          });
          setError("");
          dialog.current?.showModal();
        }}
      >
        Reload sample data
      </button>
      <dialog
        ref={dialog}
        className="command-confirm-dialog"
        aria-labelledby="reset-demo-title"
      >
        <h2 id="reset-demo-title">Reload sample data in this workspace?</h2>
        <p>
          This replaces this workspace's model, cases, runs and analyst changes
          with the supplied sample records, anchored to the current time. This
          cannot be undone here.
        </p>
        <p>Nothing is sent to partners or operational systems.</p>
        {error && <p role="alert">{error}</p>}
        <div className="command-toolbar-actions">
          <button
            className="button secondary"
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={
              disabled ||
              pending.current ||
              !request ||
              revision !== request.expectedBaselineRevision
            }
            onClick={async () => {
              if (
                !request ||
                pending.current ||
                disabled ||
                revision !== request.expectedBaselineRevision
              )
                return;
              pending.current = true;
              onBusy(true);
              try {
                await api("/v1/demo/reset", request);
                window.location.assign("/?mode=command&view=command");
              } catch (e) {
                const message =
                  (e instanceof Error ? e.message : String(e)) +
                  " Reload and inspect the workspace before attempting another reset.";
                setError(message);
                onFailure(message);
              } finally {
                pending.current = false;
                onBusy(false);
              }
            }}
          >
            Confirm reload sample data
          </button>
        </div>
      </dialog>
    </>
  );
}
