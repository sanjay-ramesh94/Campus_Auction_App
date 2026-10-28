import React, { useState, useEffect } from 'react';
import type { Auction, User, LiveBidParticipant, Question } from '../types';

interface LiveAuctionDetailProps {
  auctionId: string;
  user: User;
  token: string | null;
  onBackToListings: () => void;
  onShowToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const LiveAuctionDetail: React.FC<LiveAuctionDetailProps> = ({
  auctionId,
  user,
  token,
  onBackToListings,
  onShowToast,
}) => {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [seller, setSeller] = useState<{ id: string; name: string; yearBranch: string; verified: boolean } | null>(null);
  const [participants, setParticipants] = useState<LiveBidParticipant[]>([]);
  const [uniqueCount, setUniqueCount] = useState<number>(8);
  const [currentHighestBid, setCurrentHighestBid] = useState<number>(800);

  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);
  const [bidAmount, setBidAmount] = useState<number>(0);
  const [bidding, setBidding] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Active avatar popover
  const [activePopoverId, setActivePopoverId] = useState<string | null>(null);

  // Q&A
  const [questions, setQuestions] = useState<Question[]>([]);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [similarQuestion, setSimilarQuestion] = useState<string | null>(null);
  const [answeringQId, setAnsweringQId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');

  // Auto-bid proxy
  const [showAutoBid, setShowAutoBid] = useState(false);
  const [autoBidMax, setAutoBidMax] = useState<number>(0);

  const [timeLeft, setTimeLeft] = useState<{ m: number; s: number; formatted: string }>({
    m: 27,
    s: 4,
    formatted: '27m 4s',
  });

  // Fetch auction details
  const fetchDetails = async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/auctions/${auctionId}`, { headers });
      const data = await res.json();

      if (data.ok && data.auction) {
        setAuction(data.auction);
        if (data.seller) setSeller(data.seller);
        if (data.participants) setParticipants(data.participants);
        if (data.uniqueCount) setUniqueCount(data.uniqueCount);
        if (data.currentHighestBid) setCurrentHighestBid(data.currentHighestBid);

        const cur = data.auction.currentPrice || data.auction.startPrice;
        const nextMin = cur + data.auction.minIncrement;
        setBidAmount(nextMin);
        setAutoBidMax(nextMin + data.auction.minIncrement * 3);
      }
    } catch {
      onShowToast('error', 'Fetch Error', 'Failed to load auction details');
    }
  };

  const fetchQuestions = async () => {
    try {
      const res = await fetch(`/api/questions?auctionId=${auctionId}`);
      const data = await res.json();
      if (data.ok) setQuestions(data.questions || []);
    } catch {}
  };

  useEffect(() => {
    fetchDetails();
    fetchQuestions();
    const interval = setInterval(fetchDetails, 6000);
    return () => clearInterval(interval);
  }, [auctionId, token]);

  // Countdown timer
  useEffect(() => {
    if (!auction?.closesAt) return;

    const updateTimer = () => {
      const diff = new Date(auction.closesAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft({ m: 0, s: 0, formatted: 'Closed' });
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / 1000 / 60) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      let str = '';
      if (days > 0) str = `${days}d ${hours}h`;
      else if (hours > 0) str = `${hours}h ${minutes}m`;
      else str = `${minutes}m ${seconds}s`;

      setTimeLeft({ m: minutes, s: seconds, formatted: str });
    };

    updateTimer();
    const t = setInterval(updateTimer, 1000);
    return () => clearInterval(t);
  }, [auction?.closesAt]);

  if (!auction) {
    return (
      <div className="app-body-container" style={{ textAlign: 'center', padding: '4rem' }}>
        <p style={{ color: '#64748b', fontSize: '1.1rem' }}>Loading auction details...</p>
      </div>
    );
  }

  const curPrice = auction.currentPrice || auction.startPrice;
  const minValidBid = curPrice + auction.minIncrement;
  const isLeader = auction.leaderId && auction.leaderId === user.id;
  const isSeller = user.role === 'seller';
  const isClosed = auction.status !== 'active';

  const images = auction.images && auction.images.length > 0
    ? auction.images
    : ['https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=800&q=80'];

  // Quick increment chip
  const handleQuickChip = (increment: number) => {
    setBidAmount(curPrice + increment);
  };

  // Place Bid action
  const handlePlaceBidSubmit = async () => {
    if (user.role === 'seller') {
      onShowToast('error', 'Seller Restricted', 'Sellers cannot place bids on any auction');
      return;
    }
    if (bidAmount < minValidBid) {
      onShowToast('warning', 'Invalid Bid', `Minimum valid bid is ₹${minValidBid}`);
      return;
    }

    setBidding(true);
    setShowConfirmModal(false);

    try {
      const res = await fetch('/api/bids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Idempotency-Key': `bid-${auction._id}-${user.id}-${Date.now()}`,
        },
        body: JSON.stringify({
          auctionId: auction._id,
          amount: bidAmount,
        }),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        onShowToast('success', 'Bid Placed! 🎉', `You are now the highest bidder at ₹${bidAmount}`);
        fetchDetails();
      } else {
        onShowToast('error', 'Bid Rejected', data.error || data.reason || 'Failed to place bid');
      }
    } catch {
      onShowToast('error', 'Network Error', 'Could not reach bidding server');
    } finally {
      setBidding(false);
    }
  };

  // Auto-bid proxy setup
  const handleSaveAutoBid = async () => {
    if (autoBidMax < minValidBid) {
      onShowToast('warning', 'Invalid Limit', `Auto-bid maximum must be at least ₹${minValidBid}`);
      return;
    }
    try {
      const res = await fetch('/api/auto-bids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          auctionId: auction._id,
          maxAmount: autoBidMax,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        onShowToast('success', 'Auto-Bid Configured! 🤖', `Proxy will bid up to ₹${autoBidMax} to keep you leading`);
        setShowAutoBid(false);
      } else {
        onShowToast('error', 'Error', data.error || 'Failed to set auto-bid');
      }
    } catch {
      onShowToast('error', 'Network Error', 'Could not reach server');
    }
  };

  // Q&A Question text duplicate check
  const handleQuestionInput = (text: string) => {
    setNewQuestionText(text);
    if (text.length > 3) {
      const match = questions.find((q) => q.text.toLowerCase().includes(text.toLowerCase().trim()));
      setSimilarQuestion(match ? match.text : null);
    } else {
      setSimilarQuestion(null);
    }
  };

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestionText.trim()) return;

    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          auctionId: auction._id,
          text: newQuestionText.trim(),
        }),
      });
      await res.json();
      if (res.ok) {
        onShowToast('success', 'Question Submitted', 'The seller has been notified');
        setNewQuestionText('');
        fetchQuestions();
      }
    } catch {
      onShowToast('error', 'Error', 'Failed to submit question');
    }
  };

  const handleAnswerQuestion = async (qId: string) => {
    if (!answerText.trim()) return;
    try {
      const res = await fetch(`/api/seller/questions/${qId}/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ answer: answerText.trim() }),
      });
      if (res.ok) {
        onShowToast('success', 'Answer Submitted', 'Your reply is now visible on the auction page');
        setAnsweringQId(null);
        setAnswerText('');
        fetchQuestions();
      }
    } catch {
      onShowToast('error', 'Error', 'Failed to submit answer');
    }
  };

  return (
    <div className="app-body-container">
      {/* Breadcrumb Navigation */}
      <div className="breadcrumb-nav">
        <span className="clickable" onClick={onBackToListings}>Listings</span>
        <span>&gt;</span>
        <span className="clickable" onClick={onBackToListings}>{auction.category}</span>
        <span>&gt;</span>
        <span style={{ color: '#0f172a', fontWeight: 600 }}>{auction.title}</span>
      </div>

      {/* 2-Column Detail Layout */}
      <div className="auction-detail-layout">
        {/* Left Column: Gallery & Details */}
        <div>
          {/* Main Photo */}
          <div className="detail-gallery-main">
            <img src={images[activeImageIdx] || images[0]} alt={auction.title} />
          </div>

          {/* 4 Thumbnails Carousel underneath */}
          <div className="detail-thumbnails-row">
            {images.slice(0, 4).map((imgUrl, i) => (
              <div
                key={i}
                className={`detail-thumb-item ${activeImageIdx === i ? 'active' : ''}`}
                onClick={() => setActiveImageIdx(i)}
              >
                <img src={imgUrl} alt={`Thumbnail ${i + 1}`} />
              </div>
            ))}
          </div>

          {/* Item Metadata Card */}
          <div className="detail-meta-card">
            <div>
              <div className="meta-col-label">Item Condition</div>
              <div className="meta-col-val">{auction.condition || 'Good Condition'}</div>
            </div>
            <div style={{ borderLeft: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', padding: '0 1.5rem' }}>
              <div className="meta-col-label">Category</div>
              <div className="meta-col-val">{auction.category}</div>
            </div>
            <div>
              <div className="meta-col-label">Posted On</div>
              <div className="meta-col-val">Oct 25, 2026</div>
            </div>
          </div>
        </div>

        {/* Right Column: Title, Seller, Metrics & Bidding */}
        <div>
          {/* Header & Favorite */}
          <div className="detail-info-header">
            <h1 className="detail-title">{auction.title}</h1>
            <button
              className="detail-fav-btn"
              onClick={() => setIsFavorite(!isFavorite)}
              title="Add to Watchlist"
            >
              {isFavorite ? '❤️' : '🤍'}
            </button>
          </div>

          {/* Seller Card */}
          <div className="detail-seller-card">
            <div className="detail-seller-avatar">
              {seller ? seller.name[0] : 'R'}
            </div>
            <div>
              <div className="detail-seller-name">{seller ? seller.name : 'Rahul S.'}</div>
              <div className="detail-seller-sub">{seller ? seller.yearBranch : '3rd Year - CSE'}</div>
            </div>
            <div className="verified-badge">
              <span>✓</span> Verified Student
            </div>
          </div>

          {/* Description */}
          <p className="detail-description">{auction.description}</p>

          {/* 4-Column Auction Metrics Card */}
          <div className="detail-metrics-card">
            <div>
              <div className="metric-col-title">Current Price</div>
              <div className="metric-col-val price">₹{curPrice.toLocaleString()}</div>
              <div className={`metric-subtext ${isLeader ? 'leading' : ''}`}>
                {isLeader ? '✓ You are leading' : 'Not the current leader'}
              </div>
            </div>

            <div>
              <div className="metric-col-title">Bids</div>
              <div className="metric-col-val">{auction.bidCount}</div>
              <div className="metric-subtext">{auction.bidCount} total placed</div>
            </div>

            <div>
              <div className="metric-col-title">Min Increment</div>
              <div className="metric-col-val">₹{auction.minIncrement}</div>
              <div className="metric-subtext">Per step</div>
            </div>

            <div>
              <div className="metric-col-title">Time Remaining</div>
              <div className="metric-col-val timer">⏱ {timeLeft.formatted}</div>
              <div className="metric-subtext">Live countdown</div>
            </div>
          </div>

          {/* ============================================================
              IMAGE 2 FEATURE: LIVE BID PARTICIPANTS COMPONENT
              ============================================================ */}
          <div className="live-participants-card">
            <div className="live-participants-header">
              <div>
                <div className="live-participants-title">Live Bid Participants</div>
                <div className="live-participants-subtitle">
                  {auction.title} · {auction.category}
                </div>
              </div>
              <div className="live-badge-pill">
                <span className="live-dot-pulse" />
                <span>LIVE</span>
              </div>
            </div>

            {/* Circular Avatars Row */}
            <div className="participants-avatars-row">
              {participants.slice(0, 5).map((p, idx) => {
                const colorClass = p.isYou
                  ? 'avatar-you'
                  : idx === 0
                  ? 'avatar-ak'
                  : idx === 1
                  ? 'avatar-rk'
                  : idx === 2
                  ? 'avatar-mp'
                  : 'avatar-sj';

                const isPopoverOpen = activePopoverId === p.id;

                return (
                  <div
                    key={p.id}
                    className="participant-avatar-wrapper"
                    onClick={() => setActivePopoverId(isPopoverOpen ? null : p.id)}
                  >
                    <div className={`participant-avatar-circle ${colorClass}`}>
                      {p.initials}
                    </div>
                    <div className="participant-avatar-label">
                      {p.isYou ? 'You' : p.name.split(' ')[0]}
                    </div>

                    {/* Popover on click */}
                    {isPopoverOpen && (
                      <div className="participant-popover" onClick={(e) => e.stopPropagation()}>
                        <div className="popover-arrow" />
                        <div className="popover-name">{p.name} {p.isYou ? '(You)' : ''}</div>
                        <div className="popover-branch">{p.yearBranch}</div>
                        <div className="popover-bid-row">
                          <span style={{ color: '#cbd5e1' }}>Highest: ₹{p.highestBid}</span>
                          <span className={`popover-status-badge ${p.status}`}>
                            {p.status === 'leading' ? 'Leading' : 'Outbid'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* +3 More circle */}
              <div
                className="participant-avatar-wrapper"
                onClick={() =>
                  onShowToast(
                    'info',
                    'Active Bidders',
                    `${uniqueCount} registered campus students are participating in this live auction.`
                  )
                }
              >
                <div className="participant-avatar-circle avatar-more">+3</div>
                <div className="participant-avatar-label">More</div>
              </div>
            </div>

            {/* Divider line */}
            <div className="live-participants-divider" />

            {/* Footer Summary */}
            <div className="live-participants-footer">
              <div className="participants-count-block">
                <div className="count-label">Unique participants</div>
                <div className="count-val">{uniqueCount} students</div>
              </div>

              <div className="highest-bid-block">
                <div className="highest-label">Current highest bid</div>
                <div className="highest-val">₹{currentHighestBid.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Bidding Console (Buyer Only) */}
          {!isSeller && !isClosed ? (
            <div className="detail-bid-box">
              <div className="bid-box-title">Place a Bid</div>

              {/* Quick Increment Chips */}
              <div className="quick-chips-row">
                <button
                  type="button"
                  className="quick-chip-btn"
                  onClick={() => handleQuickChip(50)}
                >
                  + ₹50
                </button>
                <button
                  type="button"
                  className="quick-chip-btn"
                  onClick={() => handleQuickChip(100)}
                >
                  + ₹100
                </button>
                <button
                  type="button"
                  className="quick-chip-btn"
                  onClick={() => handleQuickChip(250)}
                >
                  + ₹250
                </button>
                <button
                  type="button"
                  className="quick-chip-btn"
                  onClick={() => handleQuickChip(500)}
                >
                  + ₹500
                </button>
              </div>

              {/* Bid Amount Input */}
              <div className="bid-input-row">
                <span className="bid-currency-symbol">₹</span>
                <input
                  type="number"
                  className="bid-input-amount"
                  placeholder={`Enter amount (min ₹${minValidBid})`}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(Number(e.target.value))}
                />
              </div>

              {/* Main Emerald Green Button */}
              <button
                type="button"
                className="btn-place-bid"
                disabled={bidding || bidAmount < minValidBid}
                onClick={() => setShowConfirmModal(true)}
              >
                🔨 Place Bid
              </button>

              <div className="bid-disclaimer">
                You will be asked to confirm before placing the bid.
              </div>

              {/* Auto-bid toggle */}
              <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '0.82rem', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => setShowAutoBid(!showAutoBid)}
                >
                  {showAutoBid ? '▲ Hide Auto-Bid Proxy' : '🤖 Set Auto-Bid Proxy Limit'}
                </button>
              </div>

              {showAutoBid && (
                <div style={{ marginTop: '0.85rem', padding: '1rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Auto-Bid Proxy (Maximum Willingness to Pay)
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.65rem' }}>
                    We'll bid only as much as needed to keep you ahead, up to your ceiling.
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="number"
                      className="input-field"
                      style={{ height: '40px' }}
                      value={autoBidMax}
                      onChange={(e) => setAutoBidMax(Number(e.target.value))}
                    />
                    <button
                      type="button"
                      className="btn-primary-dark"
                      style={{ height: '40px', width: 'auto', padding: '0 1rem' }}
                      onClick={handleSaveAutoBid}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : isSeller ? (
            <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '10px', color: '#92400e', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
              ℹ️ <strong>Seller Mode:</strong> As a registered seller, bidding is disabled for you. You can review buyer offers, track countdowns, and answer questions.
            </div>
          ) : (
            <div style={{ padding: '1rem', background: '#f1f5f9', borderRadius: '10px', color: '#64748b', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
              🔒 <strong>Auction Closed:</strong> Bidding for this listing has concluded.
            </div>
          )}

          {/* Q&A Section */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '1.25rem', marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.85rem' }}>Questions & Answers</h3>

            {/* Existing Questions */}
            {questions.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '1rem' }}>
                No questions asked yet. Have an inquiry about condition, pickup, or accessories?
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.25rem' }}>
                {questions.map((q) => (
                  <div key={q._id} style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a' }}>
                      Q: {q.text}
                    </div>
                    {q.answer ? (
                      <div style={{ fontSize: '0.82rem', color: '#059669', marginTop: '0.35rem', background: '#ecfdf5', padding: '0.45rem', borderRadius: '6px' }}>
                        <strong>A:</strong> {q.answer}
                      </div>
                    ) : isSeller ? (
                      answeringQId === q._id ? (
                        <div style={{ marginTop: '0.5rem' }}>
                          <input
                            type="text"
                            className="input-field"
                            placeholder="Type your reply..."
                            value={answerText}
                            onChange={(e) => setAnswerText(e.target.value)}
                            style={{ height: '36px', marginBottom: '0.4rem' }}
                          />
                          <button className="btn-primary-dark" style={{ height: '34px' }} onClick={() => handleAnswerQuestion(q._id)}>
                            Submit Answer
                          </button>
                        </div>
                      ) : (
                        <button
                          style={{ marginTop: '0.4rem', background: 'none', border: 'none', color: '#0f172a', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}
                          onClick={() => setAnsweringQId(q._id)}
                        >
                          💬 Answer this question
                        </button>
                      )
                    ) : (
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                        Awaiting seller response
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Ask Question Form */}
            {!isSeller && (
              <form onSubmit={handleAskQuestion}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Ask seller a question about this item..."
                    value={newQuestionText}
                    onChange={(e) => handleQuestionInput(e.target.value)}
                  />
                </div>
                {similarQuestion && (
                  <div style={{ fontSize: '0.75rem', color: '#b45309', background: '#fef3c7', padding: '0.4rem 0.6rem', borderRadius: '6px', marginTop: '0.4rem' }}>
                    ⚠️ Similar question found: "{similarQuestion}"
                  </div>
                )}
                <button
                  type="submit"
                  className="btn-primary-dark"
                  style={{ marginTop: '0.5rem', height: '40px' }}
                  disabled={!newQuestionText.trim()}
                >
                  Submit Question
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="modal-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Confirm Your Bid</h3>
              <button className="modal-close-btn" onClick={() => setShowConfirmModal(false)}>×</button>
            </div>
            <p style={{ fontSize: '0.92rem', color: '#475569', marginBottom: '1.25rem' }}>
              You are about to place a binding bid of <strong>₹{bidAmount.toLocaleString()}</strong> on:
              <br />
              <strong style={{ color: '#0f172a' }}>{auction.title}</strong>
              <br /><br />
              If you win, you agree to coordinate campus pickup with the seller.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn-primary-dark"
                style={{ background: '#10b981' }}
                onClick={handlePlaceBidSubmit}
              >
                Confirm ₹{bidAmount.toLocaleString()} Bid
              </button>
              <button
                className="btn-primary-dark"
                style={{ background: '#f1f5f9', color: '#0f172a' }}
                onClick={() => setShowConfirmModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
