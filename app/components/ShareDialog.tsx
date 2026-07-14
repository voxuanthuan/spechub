import type { DocumentShare } from "../lib/types.js";
import { CloseIcon, CopyIcon, RefreshIcon, ShareIcon, TrashIcon } from "./icons/index.js";

interface ShareDialogProps {
  open: boolean;
  title: string;
  share: DocumentShare | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onPublish: () => void;
  onCopy: () => void;
  onUnshare: () => void;
}

export function ShareDialog({
  open,
  title,
  share,
  loading,
  error,
  onClose,
  onPublish,
  onCopy,
  onUnshare
}: ShareDialogProps) {
  return (
    <div className="modal-backdrop" data-open={open} onClick={(event) => event.target === event.currentTarget && !loading && onClose()}>
      <div className="modal share-modal" role="dialog" aria-modal="true" aria-label="Share document">
        <div className="modal-bar">
          <div className="mb-title">
            <b>Share for review</b>
            <span>{title}</span>
          </div>
          <button className="modal-close" type="button" title="Close" aria-label="Close sharing" disabled={loading} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="share-body">
          <div className="share-notice">
            <ShareIcon />
            <p>Anyone with the unlisted link can read this snapshot. Review the document for secrets before publishing.</p>
          </div>
          {share ? (
            <>
              <label className="field">
                <span>Public review link</span>
                <div className="share-link">
                  <input readOnly value={share.url} aria-label="Public review link" />
                  <button className="btn" type="button" disabled={loading} onClick={onCopy}>
                    <CopyIcon />
                    Copy
                  </button>
                </div>
              </label>
              <p className="settings-hint">Published {new Date(share.updatedAt).toLocaleString()}</p>
              <div className="share-actions">
                <button className="btn danger" type="button" disabled={loading} onClick={onUnshare}>
                  <TrashIcon />
                  Unshare
                </button>
                <button className="btn primary" type="button" disabled={loading} onClick={onPublish}>
                  <RefreshIcon />
                  {loading ? "Updating..." : "Update snapshot"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="settings-hint">Publishing uploads only the title, public document metadata, and current content. Local paths are not included.</p>
              <div className="share-actions">
                <button className="btn" type="button" disabled={loading} onClick={onClose}>Cancel</button>
                <button className="btn primary" type="button" disabled={loading} onClick={onPublish}>
                  <ShareIcon />
                  {loading ? "Publishing..." : "Publish snapshot"}
                </button>
              </div>
            </>
          )}
          {error ? <div className="settings-error">{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
