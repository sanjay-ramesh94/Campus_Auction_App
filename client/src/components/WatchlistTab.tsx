import React, { useState, useEffect } from 'react';
import type { WatchItem, WatchStatus } from '../types';

interface WatchlistTabProps {
  token: string;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
  onSelectAuction?: (auctionId: string) => void;
}

export const WatchlistTab: React.FC<WatchlistTabProps> = ({
  token,
  showToast,
  onSelectAuction,
}) => {
  // State
  const [watches, setWatches] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form Fields
  const [keywords, setKeywords] = useState('');
  const [category, setCategory] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [autoBid, setAutoBid] = useState(false);
  const [maxBudget, setMaxBudget] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  // Confirmation Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Browser Push Notification state
  const [pushStatus, setPushStatus] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  // Fetch user watches
  const fetchWatches = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/watches', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setWatches(data.watches || []);
      } else {
        showToast('error', 'Error', data.error || 'Failed to load watches');
      }
    } catch (err: any) {
      console.error('Error fetching watches:', err);
      showToast('error', 'Error', err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatches();
  }, [token]);

  // Handle request for browser push notifications
  const handleRequestPush = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        setPushStatus(perm);
        if (perm === 'granted') {
          showToast('success', 'Alerts Active', 'Browser notifications enabled for watch matches!');
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Form Submission
  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = keywords.trim();
    if (!trimmed && !category) {
      showToast('warning', 'Missing Details', 'Please specify keywords or a category.');
      return;
    }

    if (autoBid) {
      const budgetNum = Number(maxBudget);
      if (!budgetNum || budgetNum <= 0) {
        showToast('warning', 'Invalid Budget', 'Please enter a valid max budget in ₹ for auto-bidding.');
        return;
      }
      // Show confirmation dialog before executing
      setShowConfirmModal(true);
    } else {
      // Standard notification watch
      executeCreateWatch(undefined);
    }
  };

  // Execute create watch API call
  const executeCreateWatch = async (authorizedAt?: string) => {
    setSubmitting(true);
    try {
      const kwList = keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

      const payload: any = {
        keywords: kwList,
        category: category || undefined,
        conditionFilter: conditionFilter || undefined,
        autoBid: Boolean(autoBid),
      };

      if (autoBid) {
        payload.maxBudget = Number(maxBudget);
        payload.authorizedAt = authorizedAt || new Date().toISOString();
      } else if (maxPrice) {
        payload.maxPrice = Number(maxPrice);
      }

      const res = await fetch('/api/watches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.ok) {
        showToast(
          'success',
          autoBid ? '⚡ Auto-Bid Watch Active' : '🔔 Alert Created',
          autoBid
            ? `We will automatically bid up to ₹${payload.maxBudget} when matching items appear.`
            : 'You will receive an alert as soon as a matching item is listed.'
        );
        // Reset form
        setKeywords('');
        setCategory('');
        setConditionFilter('');
        setAutoBid(false);
        setMaxBudget('');
        setMaxPrice('');
        setShowConfirmModal(false);
        fetchWatches();
      } else {
        showToast('error', 'Could Not Create', data.error || 'Failed to save watch.');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle watch active / pause
  const handleToggle = async (watchId: string) => {
    try {
      const res = await fetch(`/api/watches/${watchId}/toggle`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        showToast('info', 'Status Updated', data.message || 'Watch status changed.');
        fetchWatches();
      } else {
        showToast('error', 'Failed', data.error || 'Could not update watch.');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  // Cancel Auto-Bid only (reverts watch to paused notification watch)
  const handleCancelAutoBid = async (watchId: string) => {
    if (!confirm('Cancel the active auto-bid for this watch? The watch will be paused.')) return;
    try {
      const res = await fetch(`/api/watches/${watchId}/autobid`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        showToast('info', 'Auto-Bid Cancelled', data.message || 'Auto-bid has been cancelled.');
        fetchWatches();
      } else {
        showToast('error', 'Failed', data.error || 'Could not cancel auto-bid.');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  // Delete watch entirely
  const handleDelete = async (watchId: string) => {
    if (!confirm('Are you sure you want to delete this watch alert?')) return;
    try {
      const res = await fetch(`/api/watches/${watchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        showToast('info', 'Watch Deleted', 'The watch alert has been removed.');
        setWatches((prev) => prev.filter((w) => w._id !== watchId));
      } else {
        showToast('error', 'Failed', data.error || 'Could not delete watch.');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  // Counts
  const activeCount = watches.filter((w) => (w.status || (w.active ? 'active' : 'paused')) === 'active').length;
  const autoBidCount = watches.filter((w) => w.autoBid && (w.status || (w.active ? 'active' : 'paused')) === 'active').length;

  const renderStatusBadge = (status: WatchStatus | undefined, active: boolean) => {
    const s = status || (active ? 'active' : 'paused');
    switch (s) {
      case 'active':
        return <span className="watch-status-pill status-active">🟢 Active</span>;
      case 'paused':
        return <span className="watch-status-pill status-paused">⏸️ Paused</span>;
      case 'fulfilled':
        return <span className="watch-status-pill status-fulfilled">🏆 Won & Fulfilled</span>;
      case 'expired':
        return <span className="watch-status-pill status-expired">⌛ Expired</span>;
      default:
        return <span className="watch-status-pill status-paused">Paused</span>;
    }
  };

  return (
    <div className="watchlist-tab-container">
      {/* Hero Header */}
      <div className="watchlist-hero">
        <div className="watchlist-hero-text">
          <div className="watchlist-badge">
            <span>⚡</span> Automated Campus Bidding & Alerts
          </div>
          <h2>Never Miss What You Need</h2>
          <p>
            Set saved-search watches for calculators, lab equipment, bikes, or textbooks.
            Optionally authorize an <strong>Auto-Bid Budget</strong> — CampusBid will automatically
            place proxy bids within your limit the moment a student lists a match!
          </p>
        </div>

        {/* Browser Push Permission Quick-Card */}
        <div className="push-permission-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.4rem' }}>🔔</span>
            <div>
              <strong style={{ fontSize: '0.88rem', color: '#f8fafc', display: 'block' }}>Desktop Push Alerts</strong>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                {pushStatus === 'granted' ? 'Notifications active' : 'Get notified even if tab is in background'}
              </span>
            </div>
          </div>
          {pushStatus !== 'granted' ? (
            <button type="button" className="btn-enable-push" onClick={handleRequestPush}>
              Enable Alerts
            </button>
          ) : (
            <span className="push-granted-pill">✓ Enabled</span>
          )}
        </div>
      </div>

      {/* Main Grid: Form on left, Watches on right */}
      <div className="watchlist-main-grid">
        {/* Left Column: Create Form */}
        <div className="watchlist-form-card">
          <div className="form-card-header">
            <h3>+ Create Saved Watch</h3>
            <span className="limits-indicator">
              {activeCount}/10 Active · {autoBidCount}/3 Auto-Bids
            </span>
          </div>

          <form onSubmit={handleSubmitForm} className="create-watch-form">
            <div className="form-group">
              <label>Keywords (comma separated) *</label>
              <input
                type="text"
                className="custom-input"
                placeholder="e.g. scientific calculator, casio, fx-991"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                required
              />
              <span className="input-hint">Matches title and description terms</span>
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>Category (Optional)</label>
                <select
                  className="custom-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Any Category</option>
                  <option value="Electronics">Electronics</option>
                  <option value="Bicycles">Bicycles</option>
                  <option value="Books">Books</option>
                  <option value="Furniture">Furniture</option>
                  <option value="Lab Equipment">Lab Equipment</option>
                  <option value="Sports">Sports</option>
                  <option value="Others">Others</option>
                </select>
              </div>

              <div className="form-group">
                <label>Min Condition (Optional)</label>
                <select
                  className="custom-select"
                  value={conditionFilter}
                  onChange={(e) => setConditionFilter(e.target.value)}
                >
                  <option value="">Any Condition</option>
                  <option value="Brand New">Brand New</option>
                  <option value="Like New">Like New</option>
                  <option value="Good">Good</option>
                  <option value="Fair">Fair</option>
                </select>
              </div>
            </div>

            {/* Auto-Bid Toggle Section */}
            <div className={`autobid-toggle-card ${autoBid ? 'active' : ''}`}>
              <div className="autobid-toggle-header">
                <div className="autobid-toggle-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>⚡</span>
                    <strong>Auto-bid for me when listed</strong>
                  </div>
                  <p>
                    Server will place minimum valid bids automatically, raising only as needed up to your budget.
                  </p>
                </div>
                <label className="switch-toggle">
                  <input
                    type="checkbox"
                    checked={autoBid}
                    onChange={(e) => setAutoBid(e.target.checked)}
                  />
                  <span className="slider round"></span>
                </label>
              </div>

              {autoBid ? (
                <div className="autobid-expanded-fields">
                  <div className="form-group">
                    <label>Maximum Budget Cap (₹) *</label>
                    <div className="input-with-currency">
                      <span className="currency-prefix">₹</span>
                      <input
                        type="number"
                        className="custom-input with-prefix"
                        placeholder="e.g. 400"
                        min="1"
                        value={maxBudget}
                        onChange={(e) => setMaxBudget(e.target.value)}
                        required={autoBid}
                      />
                    </div>
                    <span className="input-hint highlight-hint">
                      🔒 Hard limit: CampusBid will never place a bid exceeding ₹{maxBudget || '0'}.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label>Max Price Alert Filter (₹, optional)</label>
                  <div className="input-with-currency">
                    <span className="currency-prefix">₹</span>
                    <input
                      type="number"
                      className="custom-input with-prefix"
                      placeholder="e.g. 500"
                      min="1"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                    />
                  </div>
                  <span className="input-hint">Only notify if starting price is at or below this amount</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              className={`btn-submit-watch ${autoBid ? 'btn-autobid' : 'btn-standard'}`}
              disabled={submitting || (!keywords.trim() && !category)}
            >
              {submitting
                ? 'Processing...'
                : autoBid
                ? '⚡ Review & Authorize Auto-Bid'
                : '+ Set Watch Alert'}
            </button>
          </form>
        </div>

        {/* Right Column: Watches List */}
        <div className="watchlist-display-panel">
          <div className="display-panel-header">
            <h3>My Saved Watches ({watches.length})</h3>
            <button className="btn-refresh-watches" onClick={fetchWatches} title="Refresh list">
              🔄 Refresh
            </button>
          </div>

          {loading ? (
            <div className="watchlist-loading-state">
              <div className="spinner"></div>
              <span>Loading saved watches...</span>
            </div>
          ) : watches.length === 0 ? (
            <div className="watchlist-empty-state">
              <div className="empty-icon">🔍</div>
              <h4>No watches created yet</h4>
              <p>
                Create your first watch on the left! We'll notify you the instant matching items are
                listed, or auto-bid up to your budget so you don't miss out.
              </p>
            </div>
          ) : (
            <div className="watchlist-cards-stack">
              {watches.map((w) => {
                const isAuto = w.autoBid;
                const status = w.status || (w.active ? 'active' : 'paused');
                const isPaused = status === 'paused';
                const hasActiveBid = Boolean(w.activeAutoBidAuctionId);

                return (
                  <div key={w._id} className={`watch-master-card ${isPaused ? 'paused' : ''} ${isAuto ? 'has-autobid' : ''}`}>
                    {/* Top row */}
                    <div className="card-top-row">
                      <div className="keywords-chip-list">
                        {w.keywords.map((kw, i) => (
                          <span key={i} className="watch-keyword-chip">#{kw}</span>
                        ))}
                        {w.category && <span className="watch-category-badge">{w.category}</span>}
                        {w.conditionFilter && (
                          <span className="watch-condition-badge">Cond: {w.conditionFilter}</span>
                        )}
                      </div>
                      <div className="card-top-status">
                        {renderStatusBadge(w.status, w.active)}
                      </div>
                    </div>

                    {/* Auto-Bid Banner */}
                    {isAuto && (
                      <div className="watch-autobid-info-row">
                        <div className="autobid-badge-label">
                          <span className="lightning-icon">⚡</span>
                          <strong>Auto-Bid Authorized:</strong>
                          <span className="budget-highlight">Max ₹{w.maxBudget?.toLocaleString()}</span>
                        </div>
                        {w.authorizedAt && (
                          <span className="auth-timestamp" title={w.authorizedAt}>
                            Pre-approved: {new Date(w.authorizedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Active Live Auction Callout */}
                    {hasActiveBid && w.activeAutoBidAuctionId && (
                      <div className="active-autobid-callout">
                        <div className="callout-message">
                          <span className="pulse-dot"></span>
                          <strong>Active in Live Auction!</strong>
                          <span>Automated proxy bids are currently live on this listing.</span>
                        </div>
                        <div className="callout-actions">
                          {onSelectAuction && (
                            <button
                              type="button"
                              className="btn-callout-view"
                              onClick={() => onSelectAuction(w.activeAutoBidAuctionId!)}
                            >
                              View Auction →
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-callout-cancel"
                            onClick={() => handleCancelAutoBid(w._id)}
                            title="Cancel active auto-bid without deleting watch"
                          >
                            Cancel Bid
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Price & Meta info */}
                    <div className="card-meta-row">
                      {w.maxPrice && !isAuto && (
                        <span className="meta-info-item">
                          🎯 Alert Price Cap: <strong>₹{w.maxPrice.toLocaleString()}</strong>
                        </span>
                      )}
                      <span className="meta-info-item">
                        📅 Created: {new Date(w.createdAt).toLocaleDateString()}
                      </span>
                      {w.expiresAt && (
                        <span className="meta-info-item">
                          ⏳ Expires: {new Date(w.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                      {w.lastMatchedAt && (
                        <span className="meta-info-item matched">
                          ⚡ Last Matched: {new Date(w.lastMatchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>

                    {/* Card Actions */}
                    <div className="card-actions-bar">
                      <div className="actions-left">
                        {status !== 'fulfilled' && status !== 'expired' && (
                          <button
                            type="button"
                            className={`btn-action-toggle ${isPaused ? 'resume' : 'pause'}`}
                            onClick={() => handleToggle(w._id)}
                          >
                            {isPaused ? '▶ Resume Watch' : '⏸ Pause'}
                          </button>
                        )}
                        {isAuto && hasActiveBid && (
                          <button
                            type="button"
                            className="btn-action-cancel-bid"
                            onClick={() => handleCancelAutoBid(w._id)}
                          >
                            Cancel Active Auto-Bid
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn-action-delete"
                        onClick={() => handleDelete(w._id)}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Auto-Bid */}
      {showConfirmModal && (
        <div className="autobid-modal-overlay">
          <div className="autobid-modal-card">
            <div className="modal-header">
              <div className="modal-icon-wrap">⚡</div>
              <div>
                <h3>Confirm Auto-Bid Authorization</h3>
                <p>CampusBid Pre-Authorized Automated Bidding</p>
              </div>
            </div>

            <div className="modal-body">
              <div className="quote-box">
                <span className="quote-icon">“</span>
                <p>
                  If a <strong>{keywords || category || 'matching item'}</strong> is listed at or under{' '}
                  <strong>₹{maxBudget}</strong>, automatically bid for me, never above{' '}
                  <strong>₹{maxBudget}</strong>.
                </p>
              </div>

              <div className="confirmation-summary-table">
                <div className="summary-row">
                  <span className="row-label">Keywords</span>
                  <span className="row-value">{keywords || '—'}</span>
                </div>
                {category && (
                  <div className="summary-row">
                    <span className="row-label">Category</span>
                    <span className="row-value">{category}</span>
                  </div>
                )}
                {conditionFilter && (
                  <div className="summary-row">
                    <span className="row-label">Min Condition</span>
                    <span className="row-value">{conditionFilter}</span>
                  </div>
                )}
                <div className="summary-row highlight-row">
                  <span className="row-label">Maximum Budget Cap</span>
                  <span className="row-value-budget">₹{Number(maxBudget).toLocaleString()}</span>
                </div>
              </div>

              <div className="safety-guarantee-box">
                <strong>🔒 CampusBid Automated Safety Rules:</strong>
                <ul>
                  <li>Bids start at minimum valid price and increment only as needed.</li>
                  <li>CampusBid will <strong>never</strong> bid higher than ₹{maxBudget}.</li>
                  <li>Limited to 1 active auto-bid per watch and max 3 auto-bids account-wide.</li>
                  <li>You can pause or cancel at any time from this dashboard.</li>
                </ul>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setShowConfirmModal(false)}
                disabled={submitting}
              >
                Back to Edit
              </button>
              <button
                type="button"
                className="btn-modal-confirm"
                onClick={() => executeCreateWatch(new Date().toISOString())}
                disabled={submitting}
              >
                {submitting ? 'Activating...' : '✓ I Authorize — Activate Auto-Bid'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
