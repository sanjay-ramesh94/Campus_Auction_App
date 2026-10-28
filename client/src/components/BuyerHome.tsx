import React, { useState, useEffect } from 'react';
import type { Auction, Bid, Question, User } from '../types';

interface BuyerHomeProps {
  user: User;
  token: string;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const BuyerHome: React.FC<BuyerHomeProps> = ({ user, token, showToast }) => {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [condition, setCondition] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedAuction, setSelectedAuction] = useState<Auction | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [customBid, setCustomBid] = useState('');
  const [autoBidCap, setAutoBidCap] = useState('');
  const [existingAutoBid, setExistingAutoBid] = useState<number | null>(null);
  const [questionText, setQuestionText] = useState('');
  const [questionWarning, setQuestionWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  const fetchAuctions = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category !== 'All') params.set('category', category);
      if (condition !== 'All') params.set('condition', condition);
      if (sortBy) params.set('sort', sortBy);

      const res = await fetch(`/api/browse?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setAuctions(data.auctions);
        if (selectedAuction) {
          const fresh = data.auctions.find((a: Auction) => a._id === selectedAuction._id);
          if (fresh) setSelectedAuction(fresh);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchAuctions();
    const interval = setInterval(fetchAuctions, 4000);
    return () => clearInterval(interval);
  }, [search, category, condition, sortBy]);

  // Load details, bids & questions when selected auction changes
  useEffect(() => {
    if (!selectedAuction) return;

    fetch(`/api/bids?auctionId=${selectedAuction._id}`)
      .then((r) => r.json())
      .then((d) => d.ok && setBids(d.bids || []))
      .catch(console.error);

    fetch(`/api/questions?auctionId=${selectedAuction._id}`)
      .then((r) => r.json())
      .then((d) => d.ok && setQuestions(d.questions || []))
      .catch(console.error);

    fetch(`/api/auto-bids?auctionId=${selectedAuction._id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.autoBid) {
          setExistingAutoBid(d.autoBid.maxAmount);
          setAutoBidCap(String(d.autoBid.maxAmount));
        } else {
          setExistingAutoBid(null);
          setAutoBidCap('');
        }
      })
      .catch(console.error);
  }, [selectedAuction?._id, selectedAuction?.version, token]);

  // Countdown updater
  useEffect(() => {
    if (!selectedAuction) return;
    const update = () => {
      setTimeLeft(Math.max(0, new Date(selectedAuction.closesAt).getTime() - Date.now()));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [selectedAuction?.closesAt]);

  const currentPrice = selectedAuction?.currentPrice ?? selectedAuction?.startPrice ?? 0;
  const nextMin = selectedAuction?.currentPrice === null
    ? selectedAuction.startPrice
    : Math.min((selectedAuction?.currentPrice || 0) + (selectedAuction?.minIncrement || 50), selectedAuction?.maxPrice || 999999);

  const isCritical = timeLeft > 0 && timeLeft <= 30000;
  const isWinning = selectedAuction?.leaderId === user.id;
  const isLocked = selectedAuction ? currentPrice >= selectedAuction.maxPrice : false;

  // Place Bid
  const handlePlaceBid = async (amount: number) => {
    if (!selectedAuction || loading || timeLeft <= 0 || isLocked) return;
    setLoading(true);

    try {
      const res = await fetch('/api/bids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          auctionId: selectedAuction._id,
          amount,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        showToast('success', 'Bid Accepted!', `You placed ₹${amount.toLocaleString()} on "${selectedAuction.title}"`);
        if (data.extendedDeadline) {
          showToast('warning', '🛡️ Anti-Sniping Triggered!', 'Deadline extended by +60 seconds!');
        }
        if (data.autoBidsPlaced && data.autoBidsPlaced.length > 0) {
          showToast('info', '🤖 Auto-Bid Reaction!', `${data.autoBidsPlaced.length} proxy bid(s) placed.`);
        }
        setCustomBid('');
        fetchAuctions();
      } else {
        showToast('error', 'Bid Rejected', data.error || data.reason || 'Failed to place bid');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Configure Auto-Bid
  const handleSetAutoBid = async () => {
    if (!selectedAuction) return;
    const maxVal = parseInt(autoBidCap, 10);
    if (!maxVal || maxVal <= currentPrice) {
      showToast('warning', 'Invalid Ceiling', `Auto-bid cap must be greater than current price (₹${currentPrice})`);
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
          auctionId: selectedAuction._id,
          maxAmount: maxVal,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setExistingAutoBid(maxVal);
        showToast('success', 'Auto-Bid Set!', `We'll bid only as much as needed to keep you ahead up to ₹${maxVal.toLocaleString()}.`);
      } else {
        showToast('error', 'Error', data.error);
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  // Ask Question
  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAuction || !questionText.trim()) return;
    setQuestionWarning(null);

    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          auctionId: selectedAuction._id,
          text: questionText.trim(),
        }),
      });

      const data = await res.json();
      if (res.status === 409 && data.duplicate) {
        setQuestionWarning('An identical question has already been asked! Check the Q&A list below.');
        return;
      }

      if (data.ok) {
        showToast('success', 'Question Posted', 'The seller has been notified.');
        setQuestionText('');
        setQuestions((prev) => [data.question, ...prev]);
      } else {
        showToast('error', 'Error', data.error);
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  return (
    <div className="buyer-home-layout">
      {/* Search and Filters Bar */}
      <div className="browse-filters-bar">
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input"
            placeholder="Search laptops, books, cycles, calculators..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <select className="filter-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="All">All Categories</option>
            <option value="Electronics">Electronics</option>
            <option value="Bicycles">Bicycles</option>
            <option value="Books">Books</option>
            <option value="Dorm">Dorm</option>
            <option value="Music">Music</option>
          </select>

          <select className="filter-select" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="All">All Conditions</option>
            <option value="Like New">Like New</option>
            <option value="Good">Good</option>
            <option value="Fair">Fair</option>
          </select>

          {/* Closing soon chip */}
          <button
            type="button"
            className={`chip-filter ${sortBy === 'closing_soon' ? 'active' : ''}`}
            onClick={() => setSortBy(sortBy === 'closing_soon' ? 'newest' : 'closing_soon')}
          >
            ⏰ Closing Soon
          </button>
        </div>
      </div>

      {/* Main Grid: Left Listings Cards, Right Selected Auction Console */}
      <div className="buyer-grid">
        <div className="buyer-listings-col">
          <div className="catalog-header-line">
            <h3>Active Campus Auctions ({auctions.length})</h3>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Authoritative server clock</span>
          </div>

          {auctions.length === 0 ? (
            <div className="empty-catalog-card">
              <p>No listings match your search filters.</p>
            </div>
          ) : (
            <div className="buyer-cards-grid">
              {auctions.map((a) => {
                const price = a.currentPrice ?? a.startPrice;
                const isSelected = selectedAuction?._id === a._id;
                const itemTimeLeft = Math.max(0, new Date(a.closesAt).getTime() - Date.now());
                const itemCritical = itemTimeLeft > 0 && itemTimeLeft <= 30000;
                const itemWinning = a.leaderId === user.id;

                return (
                  <div
                    key={a._id}
                    className={`buyer-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedAuction(a)}
                  >
                    <div className="card-top">
                      <span className="card-category">{a.category}</span>
                      {itemCritical && <span className="anti-snipe-badge">🛡️ &lt;30s</span>}
                    </div>

                    <h4 className="buyer-card-title">{a.title}</h4>
                    <p className="buyer-card-desc">{a.description}</p>

                    <div className="card-stats">
                      <div>
                        <div className="card-stat-label">Current Price</div>
                        <div className="card-stat-val price">₹{price.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="card-stat-label">Closes In</div>
                        <div className={`card-stat-val ${itemCritical ? 'timer-critical' : ''}`}>
                          {itemTimeLeft <= 0
                            ? 'Ended'
                            : `${Math.floor(itemTimeLeft / 60000)}m ${Math.floor((itemTimeLeft % 60000) / 1000)}s`}
                        </div>
                      </div>
                      <div>
                        <div className="card-stat-label">Bids</div>
                        <div className="card-stat-val">{a.bidCount}</div>
                      </div>
                    </div>

                    <div className="card-footer" style={{ marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        Min Inc: ₹{a.minIncrement}
                      </span>
                      {a.leaderId && (
                        <span className={`leader-tag ${itemWinning ? 'winning' : ''}`}>
                          {itemWinning ? '👑 You are Winning' : 'Outbid'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Interactive Bidding Console */}
        <div className="buyer-console-col">
          {selectedAuction ? (
            <div className="workspace-panel">
              <div className="detail-header">
                <div>
                  <span className="card-category">{selectedAuction.category} · {selectedAuction.condition}</span>
                  <h2 className="card-title" style={{ fontSize: '1.4rem' }}>{selectedAuction.title}</h2>
                  <p className="card-desc">{selectedAuction.description}</p>
                </div>
                {isCritical && (
                  <span className="anti-snipe-badge">
                    🛡️ Anti-Sniping Window (&lt;30s)
                  </span>
                )}
              </div>

              {/* Price & Timer Grid */}
              <div className="price-display-bar">
                <div className="price-box">
                  <span className="price-box-label">Current Bid</span>
                  <span className="price-box-val green">₹{currentPrice.toLocaleString()}</span>
                  <span style={{ fontSize: '0.75rem', color: isWinning ? '#10b981' : '#94a3b8' }}>
                    {isWinning ? '👑 You are winning!' : 'You are not the leader'}
                  </span>
                </div>

                <div className="price-box">
                  <span className="price-box-label">Time Remaining</span>
                  <span className={`price-box-val ${isCritical ? 'timer-critical' : 'timer'}`}>
                    {timeLeft <= 0
                      ? 'Closed'
                      : `${Math.floor(timeLeft / 60000)}m ${Math.floor((timeLeft % 60000) / 1000)}s`}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Server authoritative clock
                  </span>
                </div>

                <div className="price-box">
                  <span className="price-box-label">Next Valid Bid</span>
                  <span className="price-box-val">
                    {isLocked ? 'LOCKED' : `₹${nextMin.toLocaleString()}`}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Max Buyout: ₹{selectedAuction.maxPrice.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Transactional Bidding Controls */}
              <div className="bidding-controls">
                {isLocked ? (
                  <div className="locked-banner">
                    ⚠️ Maximum buyout price reached (₹{selectedAuction.maxPrice}). Bidding is locked!
                  </div>
                ) : (
                  <>
                    <div className="quick-row">
                      <button
                        className="btn btn-action"
                        disabled={loading || timeLeft <= 0}
                        onClick={() => handlePlaceBid(nextMin)}
                      >
                        Bid Next Min: ₹{nextMin.toLocaleString()}
                      </button>

                      <div className="quick-chips">
                        {[50, 100, 250].map((inc) => (
                          <button
                            key={inc}
                            className="chip"
                            disabled={loading || timeLeft <= 0}
                            onClick={() => handlePlaceBid(currentPrice + inc)}
                          >
                            +₹{inc}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Custom Bid Input */}
                    <form
                      className="custom-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const val = parseInt(customBid, 10);
                        if (val) handlePlaceBid(val);
                      }}
                    >
                      <div className="input-wrap">
                        <span className="currency-affix">₹</span>
                        <input
                          type="number"
                          className="custom-input"
                          placeholder={`Custom amount (min ₹${nextMin})`}
                          min={nextMin}
                          max={selectedAuction.maxPrice}
                          value={customBid}
                          onChange={(e) => setCustomBid(e.target.value)}
                          disabled={loading || timeLeft <= 0}
                        />
                      </div>
                      <button
                        className="btn btn-primary"
                        type="submit"
                        disabled={loading || !customBid || timeLeft <= 0}
                      >
                        {loading ? 'Submitting...' : 'Place Bid'}
                      </button>
                    </form>
                  </>
                )}

                {/* Auto-Bid Proxy Card */}
                <div className="autobid-section">
                  <div className="autobid-title">
                    <span>🤖 Auto-Bid Proxy Limit</span>
                  </div>
                  <p className="autobid-desc">
                    We'll bid only as much as needed to keep you ahead, up to your maximum ceiling.
                  </p>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <div className="input-wrap">
                      <span className="currency-affix">₹</span>
                      <input
                        type="number"
                        className="custom-input"
                        placeholder="Max budget (e.g. 2500)"
                        value={autoBidCap}
                        onChange={(e) => setAutoBidCap(e.target.value)}
                      />
                    </div>
                    <button className="btn btn-secondary" onClick={handleSetAutoBid}>
                      {existingAutoBid ? 'Update Cap' : 'Set Cap'}
                    </button>
                  </div>

                  {existingAutoBid && (
                    <div style={{ fontSize: '0.75rem', color: '#10b981' }}>
                      ✅ Active Proxy: You are covered up to ₹{existingAutoBid.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              {/* Ask Question & Existing Questions */}
              <div className="qa-seller-section">
                <div className="section-subheading">Ask the Seller a Question</div>
                {questionWarning && (
                  <div className="auth-error-banner" style={{ marginBottom: '0.5rem' }}>
                    <span>⚠️</span> {questionWarning}
                  </div>
                )}
                <form onSubmit={handleAskQuestion} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="custom-input"
                    placeholder="Ask about condition, campus pickup location..."
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value)}
                  />
                  <button className="btn btn-primary" type="submit" disabled={!questionText.trim()}>
                    Ask
                  </button>
                </form>

                {/* Q&A List */}
                <div className="qa-list" style={{ marginTop: '0.75rem' }}>
                  {questions.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: '#64748b' }}>No questions asked yet.</p>
                  ) : (
                    questions.map((q) => (
                      <div key={q._id} className="qa-item">
                        <div className="qa-question-line">
                          <strong>Q:</strong> {q.text}
                        </div>
                        {q.answer ? (
                          <div className="qa-answer-line">
                            <strong>Seller Answer:</strong> {q.answer}
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#f59e0b' }}>Awaiting seller response...</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Live Bid History */}
              <div className="audit-section">
                <div className="audit-title">Live Public Bid History ({bids.length})</div>
                <ul className="audit-list">
                  {bids.length === 0 ? (
                    <li style={{ fontSize: '0.8rem', color: '#64748b' }}>No bids placed yet.</li>
                  ) : (
                    bids.map((b, idx) => (
                      <li key={b._id || idx} className="audit-item">
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span className={`audit-source ${b.source}`}>{b.source}</span>
                          <span style={{ fontWeight: 700 }}>₹{b.amount.toLocaleString()}</span>
                          <span style={{ color: '#94a3b8' }}>
                            {b.bidderId === user.id ? 'You' : `Bidder #${b.bidderId.slice(-4)}`}
                          </span>
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
                <div className="placeholder-emoji">🏷️</div>
                <h3>Select an item to inspect & bid</h3>
                <p>Browse campus listings on the left to see live prices, proxy bidding, and seller Q&A.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
