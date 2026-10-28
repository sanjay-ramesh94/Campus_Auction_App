import React, { useState, useEffect } from 'react';
import type { Auction, Bid, Question } from '../types';

interface SellerDashboardProps {
  token: string;
  onOpenCreateModal: () => void;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const SellerDashboard: React.FC<SellerDashboardProps> = ({
  token,
  onOpenCreateModal,
  showToast,
}) => {
  const [groupedListings, setGroupedListings] = useState<{
    active: Auction[];
    pending_approval: Auction[];
    reserved: Auction[];
    sold: Auction[];
    unsold_closed: Auction[];
  }>({
    active: [],
    pending_approval: [],
    reserved: [],
    sold: [],
    unsold_closed: [],
  });

  const [actionNeeded, setActionNeeded] = useState<Auction[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'pending_approval' | 'reserved' | 'sold' | 'unsold_closed'>('active');
  const [selectedAuction, setSelectedAuction] = useState<Auction | null>(null);
  const [selectedBids, setSelectedBids] = useState<Bid[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<Question[]>([]);
  const [answerInput, setAnswerInput] = useState<{ [qId: string]: string }>({});
  const [rejectReason, setRejectReason] = useState<string>('');
  const [showRejectModal, setShowRejectModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [editForm, setEditForm] = useState({
    title: '',
    category: '',
    condition: '',
    description: '',
    startPrice: 0,
    maxPrice: 0,
    minIncrement: 0,
  });

  const fetchListings = async () => {
    try {
      const res = await fetch('/api/seller/listings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setGroupedListings(data.grouped);
        setActionNeeded(data.actionNeeded);
        if (selectedAuction) {
          const fresh = data.listings.find((l: Auction) => l._id === selectedAuction._id);
          if (fresh) setSelectedAuction(fresh);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchListings();
    const interval = setInterval(fetchListings, 4000);
    return () => clearInterval(interval);
  }, [token]);

  // Load bids & questions when selected auction changes
  useEffect(() => {
    if (!selectedAuction) return;

    fetch(`/api/bids?auctionId=${selectedAuction._id}`)
      .then((r) => r.json())
      .then((d) => d.ok && setSelectedBids(d.bids || []))
      .catch(console.error);

    fetch(`/api/questions?auctionId=${selectedAuction._id}`)
      .then((r) => r.json())
      .then((d) => d.ok && setSelectedQuestions(d.questions || []))
      .catch(console.error);
  }, [selectedAuction?._id, selectedAuction?.version]);

  // Handle Approve / Reject
  const handleCloseAction = async (auctionId: string, decision: 'approved' | 'rejected', reason?: string) => {
    try {
      const res = await fetch(`/api/seller/auctions/${auctionId}/close-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ decision, reason }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(
          decision === 'approved' ? 'success' : 'info',
          decision === 'approved' ? 'Listing Approved!' : 'Outcome Rejected',
          data.message
        );
        setShowRejectModal(false);
        fetchListings();
      } else {
        showToast('error', 'Action Failed', data.error);
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  // Handle Handover confirmation
  const handleHandover = async (auctionId: string, status: 'confirmed' | 'failed') => {
    try {
      const res = await fetch(`/api/seller/auctions/${auctionId}/handover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(
          status === 'confirmed' ? 'success' : 'warning',
          status === 'confirmed' ? 'Handover Confirmed!' : 'Pickup Failed',
          data.message
        );
        fetchListings();
      } else {
        showToast('error', 'Failed', data.error);
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  // Answer Q&A question
  const handleAnswerQuestion = async (qId: string) => {
    const text = answerInput[qId];
    if (!text || text.trim().length === 0) return;

    try {
      const res = await fetch(`/api/seller/questions/${qId}/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ answer: text.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast('success', 'Answer Submitted', 'Buyer has been notified.');
        setAnswerInput((prev) => ({ ...prev, [qId]: '' }));
        if (selectedAuction) {
          const freshQ = await fetch(`/api/questions?auctionId=${selectedAuction._id}`).then((r) => r.json());
          if (freshQ.ok) setSelectedQuestions(freshQ.questions);
        }
      } else {
        showToast('error', 'Error', data.error);
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  // Open Edit Modal
  const openEdit = (a: Auction) => {
    setEditForm({
      title: a.title,
      category: a.category,
      condition: a.condition,
      description: a.description,
      startPrice: a.startPrice,
      maxPrice: a.maxPrice,
      minIncrement: a.minIncrement,
    });
    setShowEditModal(true);
  };

  // Save Edit
  const handleSaveEdit = async () => {
    if (!selectedAuction) return;
    try {
      const res = await fetch(`/api/seller/auctions/${selectedAuction._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (data.ok) {
        showToast('success', 'Listing Updated', 'Changes applied successfully.');
        setShowEditModal(false);
        fetchListings();
      } else {
        showToast('error', 'Update Failed', data.error);
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  // Cancel Auction
  const handleCancelAuction = async () => {
    if (!selectedAuction) return;
    try {
      const res = await fetch(`/api/seller/auctions/${selectedAuction._id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast('info', 'Listing Cancelled', 'Auction has been marked as cancelled.');
        setShowCancelModal(false);
        setCancelReason('');
        fetchListings();
      } else {
        showToast('error', 'Cancellation Failed', data.error);
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  const currentTabList = groupedListings[activeTab] || [];

  return (
    <div className="seller-dashboard">
      {/* 1. Action Needed Highlight Banner */}
      {actionNeeded.length > 0 && (
        <div className="action-needed-section">
          <div className="action-needed-header">
            <span>⚡ Action Required ({actionNeeded.length} Listing{actionNeeded.length > 1 ? 's' : ''})</span>
          </div>
          <div className="action-cards-grid">
            {actionNeeded.map((item) => (
              <div key={item._id} className="action-card">
                <div className="action-card-top">
                  <span className="badge-warning">
                    {item.status === 'pending_approval' ? '⏳ Pending Approval' : '🤝 Handover Ready'}
                  </span>
                  <span className="price-tag">Winning Bid: ₹{item.currentPrice?.toLocaleString()}</span>
                </div>
                <h4 className="action-card-title">{item.title}</h4>
                <p className="action-card-desc">
                  {item.status === 'pending_approval'
                    ? `Auction ended with top bid ₹${item.currentPrice}. Choose to approve or reject.`
                    : `Winning bid approved! Meet the buyer on campus to handover and mark as Sold.`}
                </p>

                <div className="action-card-btns">
                  {item.status === 'pending_approval' ? (
                    <>
                      <button
                        className="btn btn-action"
                        style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }}
                        onClick={() => handleCloseAction(item._id, 'approved')}
                      >
                        ✓ Approve Bid
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem', color: '#f43f5e' }}
                        onClick={() => {
                          setSelectedAuction(item);
                          setShowRejectModal(true);
                        }}
                      >
                        ✕ Reject
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn-action"
                        style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }}
                        onClick={() => handleHandover(item._id, 'confirmed')}
                      >
                        🤝 Confirm Handover
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem', color: '#f43f5e' }}
                        onClick={() => handleHandover(item._id, 'failed')}
                      >
                        Pickup Failed
                      </button>
                    </>
                  )}
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', marginLeft: 'auto' }}
                    onClick={() => setSelectedAuction(item)}
                  >
                    View Details →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. My Listings Section */}
      <div className="dashboard-grid">
        {/* Left Column: Listings & Status Tabs */}
        <div className="seller-left-col">
          <div className="seller-tabs-bar">
            <button
              className={`seller-tab ${activeTab === 'active' ? 'active' : ''}`}
              onClick={() => setActiveTab('active')}
            >
              Active ({groupedListings.active.length})
            </button>
            <button
              className={`seller-tab ${activeTab === 'pending_approval' ? 'active' : ''}`}
              onClick={() => setActiveTab('pending_approval')}
            >
              Pending Approval ({groupedListings.pending_approval.length})
            </button>
            <button
              className={`seller-tab ${activeTab === 'reserved' ? 'active' : ''}`}
              onClick={() => setActiveTab('reserved')}
            >
              Reserved ({groupedListings.reserved.length})
            </button>
            <button
              className={`seller-tab ${activeTab === 'sold' ? 'active' : ''}`}
              onClick={() => setActiveTab('sold')}
            >
              Sold ({groupedListings.sold.length})
            </button>
            <button
              className={`seller-tab ${activeTab === 'unsold_closed' ? 'active' : ''}`}
              onClick={() => setActiveTab('unsold_closed')}
            >
              Unsold / Closed ({groupedListings.unsold_closed.length})
            </button>
          </div>

          <div className="seller-listings-list">
            {currentTabList.length === 0 ? (
              <div className="empty-box">
                <p>No listings in this category.</p>
                {activeTab === 'active' && (
                  <button className="btn btn-primary" style={{ marginTop: '0.5rem' }} onClick={onOpenCreateModal}>
                    + Create Your First Listing
                  </button>
                )}
              </div>
            ) : (
              currentTabList.map((item) => (
                <div
                  key={item._id}
                  className={`seller-listing-item ${selectedAuction?._id === item._id ? 'selected' : ''}`}
                  onClick={() => setSelectedAuction(item)}
                >
                  <div className="item-main">
                    <span className="item-cat">{item.category}</span>
                    <h4 className="item-title">{item.title}</h4>
                    <span className="item-desc">{item.description}</span>
                  </div>

                  <div className="item-meta">
                    <div className="item-price">
                      {item.currentPrice ? `₹${item.currentPrice.toLocaleString()}` : `Start: ₹${item.startPrice}`}
                    </div>
                    <div className="item-bids">{item.bidCount} bid{item.bidCount === 1 ? '' : 's'}</div>
                    <div className="item-status-pill">{item.status.replace('_', ' ').toUpperCase()}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Own Auction Inspection Page */}
        <div className="seller-right-col">
          {selectedAuction ? (
            <div className="own-auction-panel">
              <div className="panel-header-row">
                <div>
                  <span className="card-category">{selectedAuction.category}</span>
                  <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc', marginTop: '0.25rem' }}>
                    {selectedAuction.title}
                  </h3>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                    onClick={() => openEdit(selectedAuction)}
                  >
                    ✏️ Edit
                  </button>
                  {selectedAuction.status === 'active' && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', color: '#f43f5e' }}
                      onClick={() => setShowCancelModal(true)}
                    >
                      ✕ Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Notice that Sellers cannot bid */}
              <div className="seller-readonly-notice">
                <span>🛡️ Seller Mode Active:</span> Bidding controls are hidden. Sellers cannot bid on items.
              </div>

              {/* Stats Bar */}
              <div className="price-display-bar" style={{ marginTop: '0.5rem' }}>
                <div className="price-box">
                  <span className="price-box-label">Current High</span>
                  <span className="price-box-val green">
                    ₹{(selectedAuction.currentPrice || selectedAuction.startPrice).toLocaleString()}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {selectedAuction.leaderId ? `Leader: ${selectedAuction.leaderId.slice(-4)}` : 'No bids yet'}
                  </span>
                </div>

                <div className="price-box">
                  <span className="price-box-label">Status</span>
                  <span className="price-box-val" style={{ textTransform: 'capitalize', fontSize: '1.25rem' }}>
                    {selectedAuction.status.replace('_', ' ')}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {selectedAuction.bidCount} bid{selectedAuction.bidCount === 1 ? '' : 's'} placed
                  </span>
                </div>

                <div className="price-box">
                  <span className="price-box-label">Closing Target</span>
                  <span className="price-box-val timer" style={{ fontSize: '1.15rem' }}>
                    {new Date(selectedAuction.closesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {new Date(selectedAuction.closesAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Q&A Section */}
              <div className="qa-seller-section">
                <div className="section-subheading">
                  Buyer Q&A ({selectedQuestions.length} Question{selectedQuestions.length === 1 ? '' : 's'})
                </div>

                {selectedQuestions.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: '#64748b' }}>No questions received from buyers yet.</p>
                ) : (
                  <div className="qa-list">
                    {selectedQuestions.map((q) => (
                      <div key={q._id} className="qa-item">
                        <div className="qa-question-line">
                          <strong>Q:</strong> {q.text}
                          <span className="qa-asker">by {q.askerName || 'Buyer'}</span>
                        </div>

                        {q.answer ? (
                          <div className="qa-answer-line">
                            <strong>A:</strong> {q.answer}
                          </div>
                        ) : (
                          <div className="qa-answer-form">
                            <input
                              type="text"
                              className="custom-input"
                              placeholder="Type answer to buyer..."
                              value={answerInput[q._id] || ''}
                              onChange={(e) =>
                                setAnswerInput((prev) => ({ ...prev, [q._id]: e.target.value }))
                              }
                            />
                            <button
                              className="btn btn-primary"
                              style={{ padding: '0.45rem 0.85rem', fontSize: '0.75rem' }}
                              onClick={() => handleAnswerQuestion(q._id)}
                            >
                              Post Answer
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bid Audit Trail */}
              <div className="audit-section" style={{ marginTop: '0.5rem' }}>
                <div className="audit-title">Full Bid History ({selectedBids.length})</div>
                <ul className="audit-list">
                  {selectedBids.length === 0 ? (
                    <li style={{ fontSize: '0.8rem', color: '#64748b' }}>No bids recorded yet.</li>
                  ) : (
                    selectedBids.map((b, i) => (
                      <li key={b._id || i} className="audit-item">
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span className={`audit-source ${b.source}`}>{b.source}</span>
                          <span style={{ fontWeight: 700 }}>₹{b.amount.toLocaleString()}</span>
                          <span style={{ color: '#94a3b8' }}>by Bidder #{b.bidderId.slice(-4)}</span>
                        </div>
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {new Date(b.serverTs).toLocaleTimeString()}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          ) : (
            <div className="workspace-panel">
              <div className="workspace-placeholder">
                <div className="placeholder-emoji">📋</div>
                <h3>Select a listing to view</h3>
                <p>Click any item on the left to see questions, approve closing bids, or manage handovers.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rejection Modal */}
      {showRejectModal && selectedAuction && (
        <div className="modal-overlay" onClick={() => setShowRejectModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Reject Winning Bid</h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              Are you sure you want to reject the bid of ₹{selectedAuction.currentPrice}? The listing will be closed.
            </p>
            <div className="form-group">
              <label>Reason (Optional)</label>
              <textarea
                className="form-textarea"
                rows={2}
                placeholder="e.g. Reserve price not reached, item damaged..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowRejectModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ background: '#f43f5e' }}
                onClick={() => handleCloseAction(selectedAuction._id, 'rejected', rejectReason)}
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && selectedAuction && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
              Edit Listing {selectedAuction.bidCount > 0 && '(Bids Placed: Limited Edit)'}
            </h3>
            {selectedAuction.bidCount > 0 ? (
              <p style={{ fontSize: '0.8rem', color: '#f59e0b' }}>
                ⚠️ Bids have already been placed! Only description and photos can be modified. Price and title are locked.
              </p>
            ) : (
              <div className="form-group">
                <label>Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                />
              </div>
            )}

            <div className="form-group">
              <label>Description</label>
              <textarea
                className="form-textarea"
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>

            {selectedAuction.bidCount === 0 && (
              <div className="form-row-3">
                <div className="form-group">
                  <label>Start (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={editForm.startPrice}
                    onChange={(e) => setEditForm({ ...editForm, startPrice: parseInt(e.target.value, 10) })}
                  />
                </div>
                <div className="form-group">
                  <label>Increment (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={editForm.minIncrement}
                    onChange={(e) => setEditForm({ ...editForm, minIncrement: parseInt(e.target.value, 10) })}
                  />
                </div>
                <div className="form-group">
                  <label>Max (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={editForm.maxPrice}
                    onChange={(e) => setEditForm({ ...editForm, maxPrice: parseInt(e.target.value, 10) })}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowEditModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && selectedAuction && (
        <div className="modal-overlay" onClick={() => setShowCancelModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f43f5e' }}>Cancel Listing</h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              Cancelling will end the auction immediately. Any active bidders will receive a cancellation notification.
            </p>
            <div className="form-group">
              <label>Reason for Cancellation *</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Item no longer available"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                required
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowCancelModal(false)}>
                Keep Listing
              </button>
              <button
                className="btn btn-primary"
                style={{ background: '#f43f5e' }}
                disabled={!cancelReason.trim()}
                onClick={handleCancelAuction}
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
