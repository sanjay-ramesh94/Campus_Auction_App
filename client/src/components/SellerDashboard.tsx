import React, { useState, useEffect } from 'react';
import type { Auction, User } from '../types';

interface SellerDashboardProps {
  user: User;
  token: string | null;
  onSelectAuction: (id: string) => void;
  onShowToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const SellerDashboard: React.FC<SellerDashboardProps> = ({
  user,
  token,
  onSelectAuction,
  onShowToast,
}) => {
  const [sidebarTab, setSidebarTab] = useState<'sell' | 'my_listings' | 'bids_received' | 'sold'>('sell');
  const [myAuctions, setMyAuctions] = useState<Auction[]>([]);
  const [actionNeeded, setActionNeeded] = useState<Auction[]>([]);

  // Create Listing Form state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Electronics');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState('Good Condition');
  const [startPrice, setStartPrice] = useState<number>(500);
  const [minIncrement, setMinIncrement] = useState<number>(50);
  const [duration, setDuration] = useState('1 Day');
  const [imageUrl, setImageUrl] = useState('');
  const [creating, setCreating] = useState(false);

  // Close Action modal (Approve / Reject)
  const [closingModalAuction, setClosingModalAuction] = useState<Auction | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Handover modal
  const [handoverModalAuction, setHandoverModalAuction] = useState<Auction | null>(null);

  const fetchSellerListings = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/seller/listings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setMyAuctions(data.all || []);
        setActionNeeded(data.actionNeeded || []);
      }
    } catch {}
  };

  useEffect(() => {
    fetchSellerListings();
    const interval = setInterval(fetchSellerListings, 6000);
    return () => clearInterval(interval);
  }, [token]);

  const handleCreateListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !category || startPrice <= 0 || minIncrement <= 0) {
      onShowToast('warning', 'Validation Error', 'Please fill in all listing details with valid numbers');
      return;
    }

    setCreating(true);

    let hours = 24;
    if (duration === '3 Days') hours = 72;
    else if (duration === '7 Days') hours = 168;

    const closesAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

    const sampleImages = [
      imageUrl.trim() || 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=800&q=80',
    ];

    try {
      const res = await fetch('/api/seller/listings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          category,
          description: description.trim(),
          condition,
          startPrice,
          maxPrice: startPrice * 5,
          minIncrement,
          closesAt,
          images: sampleImages,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        onShowToast('success', 'Listing Created! 🎉', `"${title}" is now live for bidding`);
        setTitle('');
        setDescription('');
        setStartPrice(500);
        setMinIncrement(50);
        setImageUrl('');
        setSidebarTab('my_listings');
        fetchSellerListings();
      } else {
        onShowToast('error', 'Error', data.error || 'Failed to create listing');
      }
    } catch {
      onShowToast('error', 'Error', 'Network connection failed');
    } finally {
      setCreating(false);
    }
  };

  const handleApproveReject = async (decision: 'approved' | 'rejected') => {
    if (!closingModalAuction) return;
    try {
      const res = await fetch(`/api/seller/auctions/${closingModalAuction._id}/close-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ decision, reason: rejectReason }),
      });
      if (res.ok) {
        onShowToast('success', 'Decision Saved', `Auction is now ${decision === 'approved' ? 'Reserved' : 'Closed'}`);
        setClosingModalAuction(null);
        setRejectReason('');
        fetchSellerListings();
      }
    } catch {
      onShowToast('error', 'Error', 'Failed to save decision');
    }
  };

  const handleHandover = async (status: 'confirmed' | 'failed') => {
    if (!handoverModalAuction) return;
    try {
      const res = await fetch(`/api/seller/auctions/${handoverModalAuction._id}/handover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        onShowToast('success', 'Handover Recorded', `Status updated to ${status === 'confirmed' ? 'Sold' : 'Pickup Failed'}`);
        setHandoverModalAuction(null);
        fetchSellerListings();
      }
    } catch {
      onShowToast('error', 'Error', 'Failed to record handover');
    }
  };

  return (
    <div className="app-body-container">
      <div className="seller-layout">
        {/* Left Sidebar matching Screen 4 */}
        <aside className="seller-sidebar">
          <button
            className={`seller-menu-btn ${sidebarTab === 'sell' ? 'active' : ''}`}
            onClick={() => setSidebarTab('sell')}
          >
            <span>🏷️</span>
            <span>Sell Item</span>
          </button>
          <button
            className={`seller-menu-btn ${sidebarTab === 'my_listings' ? 'active' : ''}`}
            onClick={() => setSidebarTab('my_listings')}
          >
            <span>📋</span>
            <span>My Listings ({myAuctions.length})</span>
          </button>
          <button
            className={`seller-menu-btn ${sidebarTab === 'bids_received' ? 'active' : ''}`}
            onClick={() => setSidebarTab('bids_received')}
          >
            <span>🔨</span>
            <span>Bids Received {actionNeeded.length > 0 && `(${actionNeeded.length})`}</span>
          </button>
          <button
            className={`seller-menu-btn ${sidebarTab === 'sold' ? 'active' : ''}`}
            onClick={() => setSidebarTab('sold')}
          >
            <span>🤝</span>
            <span>Sold Items</span>
          </button>
        </aside>

        {/* Main Content Area */}
        <main>
          {sidebarTab === 'sell' ? (
            /* Screen 4: Create a New Listing Form */
            <div className="seller-content-card">
              <div style={{ marginBottom: '1.75rem' }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700 }}>
                  Create a New Listing
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                  Fill in the details to list your item for auction (Seller: {user.name}).
                </p>
              </div>

              <form onSubmit={handleCreateListing}>
                {/* 2-Column: Title & Category */}
                <div className="form-grid-2" style={{ marginBottom: '1.25rem' }}>
                  <div>
                    <label className="form-label">Item Title</label>
                    <input
                      type="text"
                      className="input-field"
                      style={{ paddingLeft: '1rem' }}
                      placeholder="e.g. Mechanical Keyboard"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Category</label>
                    <select
                      className="select-field"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="Electronics">Electronics</option>
                      <option value="Bicycles">Bicycles</option>
                      <option value="Furniture">Furniture</option>
                      <option value="Books">Books</option>
                      <option value="Hostel Essentials">Hostel Essentials</option>
                      <option value="Others">Others</option>
                    </select>
                  </div>
                </div>

                {/* Description Textarea */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label className="form-label">Description</label>
                  <textarea
                    className="textarea-field"
                    placeholder="Add item details, condition, accessories included..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                  />
                </div>

                {/* 2-Column: Starting Price & Minimum Increment */}
                <div className="form-grid-2" style={{ marginBottom: '1.25rem' }}>
                  <div>
                    <label className="form-label">Starting Price (₹)</label>
                    <input
                      type="number"
                      className="input-field"
                      style={{ paddingLeft: '1rem' }}
                      placeholder="e.g. 500"
                      value={startPrice}
                      onChange={(e) => setStartPrice(Number(e.target.value))}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Minimum Increment (₹)</label>
                    <input
                      type="number"
                      className="input-field"
                      style={{ paddingLeft: '1rem' }}
                      placeholder="e.g. 50"
                      value={minIncrement}
                      onChange={(e) => setMinIncrement(Number(e.target.value))}
                      required
                    />
                  </div>
                </div>

                {/* 2-Column: Auction Duration & Condition */}
                <div className="form-grid-2" style={{ marginBottom: '1.25rem' }}>
                  <div>
                    <label className="form-label">Auction Duration</label>
                    <select
                      className="select-field"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    >
                      <option value="1 Day">1 Day (24 Hours)</option>
                      <option value="3 Days">3 Days</option>
                      <option value="7 Days">7 Days</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Condition</label>
                    <select
                      className="select-field"
                      value={condition}
                      onChange={(e) => setCondition(e.target.value)}
                    >
                      <option value="Good Condition">Good Condition</option>
                      <option value="Like New">Like New</option>
                      <option value="Fair">Fair / Refurbished</option>
                    </select>
                  </div>
                </div>

                {/* Upload Images Drag-and-Drop / URL */}
                <div style={{ marginBottom: '1.75rem' }}>
                  <label className="form-label">Upload Images (Max 5)</label>
                  <div
                    className="image-upload-box"
                    onClick={() => {
                      const sample = prompt('Enter image URL or press OK to use high-res product photo:', 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=800&q=80');
                      if (sample) setImageUrl(sample);
                    }}
                  >
                    <div className="upload-icon">☁️</div>
                    <div className="upload-text-main">Click to upload or drag and drop</div>
                    <div className="upload-text-sub">PNG, JPG (Max 5MB each)</div>
                  </div>
                  {imageUrl && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#059669' }}>
                      ✓ Image attached: {imageUrl.slice(0, 50)}...
                    </div>
                  )}
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  className="btn-primary-dark"
                  disabled={creating}
                >
                  🏷 List Item
                </button>
              </form>
            </div>
          ) : (
            /* My Listings / Action Needed view */
            <div>
              {/* Action Needed Card */}
              {actionNeeded.length > 0 && (
                <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '14px', padding: '1.25rem', marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#92400e', marginBottom: '0.5rem' }}>
                    ⚡ Action Needed on {actionNeeded.length} Auction(s)
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {actionNeeded.map((a) => (
                      <div
                        key={a._id}
                        style={{ background: '#ffffff', padding: '0.85rem', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{a.title}</div>
                          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            Winning bid: ₹{a.currentPrice} · Status: {a.status}
                          </div>
                        </div>

                        {a.status === 'pending_approval' && (
                          <button
                            className="btn-primary-dark"
                            style={{ height: '36px', width: 'auto', padding: '0 1rem', background: '#10b981' }}
                            onClick={() => setClosingModalAuction(a)}
                          >
                            Review & Approve
                          </button>
                        )}

                        {a.status === 'reserved' && (
                          <button
                            className="btn-primary-dark"
                            style={{ height: '36px', width: 'auto', padding: '0 1rem', background: '#0f172a' }}
                            onClick={() => setHandoverModalAuction(a)}
                          >
                            Confirm Handover
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All Seller Listings */}
              <div className="bids-list">
                {myAuctions.map((a) => {
                  const img = a.images && a.images.length > 0
                    ? a.images[0]
                    : 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80';
                  return (
                    <div
                      key={a._id}
                      className="bid-row-card"
                      onClick={() => onSelectAuction(a._id)}
                    >
                      <div className="bid-row-left">
                        <img src={img} alt={a.title} className="bid-row-thumb" />
                        <div className="bid-row-info">
                          <div className="bid-row-title">{a.title}</div>
                          <div className="bid-row-pricing">
                            <span className="bid-row-cur-bid">Highest Bid: ₹{a.currentPrice || a.startPrice}</span>
                            <span>·</span>
                            <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>Status: {a.status}</span>
                          </div>
                        </div>
                      </div>

                      <div className="bid-row-right">
                        <button
                          className="btn-outline-action"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAuction(a._id);
                          }}
                        >
                          View Auction
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Approve / Reject Modal */}
      {closingModalAuction && (
        <div className="modal-overlay" onClick={() => setClosingModalAuction(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Winning Bid Decision</h3>
              <button className="modal-close-btn" onClick={() => setClosingModalAuction(null)}>×</button>
            </div>
            <p style={{ fontSize: '0.9rem', color: '#475569', marginBottom: '1rem' }}>
              The auction for <strong>{closingModalAuction.title}</strong> has closed.
              <br />
              Winning Bid: <strong>₹{closingModalAuction.currentPrice}</strong>
            </p>
            <div style={{ marginBottom: '1.25rem' }}>
              <label className="form-label">Optional rejection reason:</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Reserve price not reached"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn-primary-dark"
                style={{ background: '#10b981' }}
                onClick={() => handleApproveReject('approved')}
              >
                ✓ Approve Bid (Reserved)
              </button>
              <button
                className="btn-primary-dark"
                style={{ background: '#ef4444' }}
                onClick={() => handleApproveReject('rejected')}
              >
                ✕ Reject Bid
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Handover Modal */}
      {handoverModalAuction && (
        <div className="modal-overlay" onClick={() => setHandoverModalAuction(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Campus Handover Outcome</h3>
              <button className="modal-close-btn" onClick={() => setHandoverModalAuction(null)}>×</button>
            </div>
            <p style={{ fontSize: '0.9rem', color: '#475569', marginBottom: '1.25rem' }}>
              Item: <strong>{handoverModalAuction.title}</strong>
              <br />
              Please record the pickup outcome with the student buyer:
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn-primary-dark"
                style={{ background: '#10b981' }}
                onClick={() => handleHandover('confirmed')}
              >
                🤝 Handover Successful (Sold)
              </button>
              <button
                className="btn-primary-dark"
                style={{ background: '#64748b' }}
                onClick={() => handleHandover('failed')}
              >
                ⚠️ Pickup Failed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
